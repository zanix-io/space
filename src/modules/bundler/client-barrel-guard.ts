import type { Plugin } from 'vite'
import { InternalError } from '@zanix/errors'

/**
 * Fails a client build that pairs an app's declared renderer with the wrong client barrel.
 *
 * `@zanix/space/client` exports React's `hydrateComets` (`hydrateRoot`/`createRoot` from
 * `react-dom/client`); `@zanix/space/client/preact` exports Preact's (`hydrate`/`render` from
 * `preact`). An app imports exactly one, and which one is correct is decided entirely by
 * `spacePlugin({ renderer })` — the same flag that selects the SSR renderer.
 *
 * Getting that pairing wrong is not a theoretical hazard. Measured in a real browser: a Preact app
 * that imports the React barrel serves perfect SSR HTML, keeps all 26 comet boundaries in the DOM,
 * renders every component's content — and every Comet is completely inert. Clicks do nothing.
 * There is no console error, no uncaught page error, and no unhandled promise rejection. The page
 * looks finished and is dead, which is the same silent failure class as the `defineComet` defect
 * this package fixed alongside this guard.
 *
 * ## Why a build-time check, and not a runtime assertion
 *
 * A runtime assertion would need the client to know which renderer produced the page.
 * `getActiveRenderer()` cannot supply that: it is a server-side value set by `defineSpaceApp`
 * during startup, so in a browser that module is a fresh instance reporting the `'react'` default
 * no matter what rendered the response. Making it available would mean stamping the renderer into
 * every response and reading it back — real bytes on every page, to catch in production, in a
 * user's browser, an error the build can catch for free before anything ships.
 *
 * ## Why not detect it from the built output
 *
 * Because it is not there to detect. `@preact/preset-vite` aliases `react`/`react-dom` to
 * `preact/compat`, so the mismatched build produces 40.2KB with no React in it at all — within
 * 0.4KB of the correct Preact build (39.8KB). Bundle-content inspection cannot see this; the
 * module graph can, because Space's own two hydrate modules are distinct files no aliasing
 * touches.
 *
 * The check therefore runs where the renderer is already known and the graph is already being
 * walked, and costs a string comparison per module — the same layer, and the same reasoning, as
 * the `'server-only'` import guard (`server-only-directive.ts`).
 *
 * @module
 */

/** React's hydrate module — what `@zanix/space/client` pulls in. */
const REACT_HYDRATE_SUFFIX = '/client/hydrate-comets.ts'
/** Preact's — what `@zanix/space/client/preact` pulls in. */
const PREACT_HYDRATE_SUFFIX = '/client/hydrate-comets-preact.ts'

/**
 * Strips a module id down to a comparable path — drops Rollup/Vite query suffixes (`?v=`,
 * `?import`, …) and the `\0`-prefixed virtual-module marker, so a real id matches whether it
 * arrived as a local path, a `file://` URL or a JSR URL. Only the trailing path segments are ever
 * compared, which is what makes this work across all three forms without knowing any of them.
 */
function normalizeId(id: string): string {
  const withoutNullByte = id.startsWith('\0') ? id.slice(1) : id
  const queryIndex = withoutNullByte.indexOf('?')
  return queryIndex === -1 ? withoutNullByte : withoutNullByte.slice(0, queryIndex)
}

/**
 * Build-time guard against a renderer/client-barrel mismatch — see this module's own doc for the
 * measured failure it prevents and why it lives here rather than at runtime.
 *
 * Composed automatically by {@linkcode spacePlugin}, which already knows `renderer`; there is no
 * reason to add it to a `plugins` array by hand.
 *
 * @param renderer - The app's declared renderer, exactly as `spacePlugin({ renderer })` received
 * it.
 * @returns A Vite plugin that throws during the client build if the other renderer's hydrate
 * module reaches the graph. Never affects the SSR environment, and adds nothing to the output.
 */
export function clientBarrelGuardPlugin(renderer: 'react' | 'preact'): Plugin {
  const wrongSuffix = renderer === 'preact' ? REACT_HYDRATE_SUFFIX : PREACT_HYDRATE_SUFFIX
  const wrongBarrel = renderer === 'preact' ? '@zanix/space/client' : '@zanix/space/client/preact'
  const rightBarrel = renderer === 'preact' ? '@zanix/space/client/preact' : '@zanix/space/client'

  return {
    name: 'zanix-space:client-barrel-guard',
    // Client only. The SSR environment never loads either hydrate module, and a `deno test` or
    // tooling build that happens to touch both is not an app shipping the wrong one.
    applyToEnvironment(environment) {
      return environment.name === 'client'
    },
    transform(_code, id) {
      if (!normalizeId(id).endsWith(wrongSuffix)) return null
      throw new InternalError(
        `@zanix/space: this app declares \`renderer: '${renderer}'\`, but its client entry ` +
          `imports \`${wrongBarrel}\` — the ${
            renderer === 'preact' ? 'React' : 'Preact'
          } client barrel.\n\n` +
          `Import \`${rightBarrel}\` instead.\n\n` +
          'This is a build error on purpose. The mismatch does not fail at runtime: the page ' +
          'server-renders correctly, every comet boundary and all its content appear in the DOM, ' +
          'and nothing throws — but no Comet is ever interactive, with no error in the console. ' +
          `The offending module reached the client graph at: ${normalizeId(id)}`,
        {
          code: 'SPACE_BUNDLER_CLIENT_BARREL_MISMATCH',
          meta: { renderer, wrongBarrel, rightBarrel, moduleId: normalizeId(id) },
        },
      )
    },
  }
}
