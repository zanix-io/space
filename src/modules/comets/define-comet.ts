import type { CometBoundaryComponent, CometComponent, CometProps } from 'typings/comet.ts'
import type { SpaceChildren } from 'typings/renderable.ts'
import { InternalError } from '@zanix/errors'
import {
  COMET_EXPORT_ATTR,
  COMET_ID_ATTR,
  COMET_MEDIA_ATTR,
  COMET_MODULE_ATTR,
  COMET_PERSIST_ATTR,
  COMET_PROPS_ATTR,
  COMET_STRATEGY_ATTR,
} from './marker.ts'
import { hashSourceKey, normalizeSourceKey, resolveCometModuleUrl } from './comet-manifest.ts'
import { getCometElementFactory } from './element-factory.ts'
import type { CometElementFactory } from './element-factory.ts'
import { stringifyForWire } from '../render/serialization-codec.ts'
import { getCometCssHrefs } from '../render/css-manifest.ts'
import { getActiveRenderer } from '../router/active-renderer.ts'

/**
 * Marks a component as a "Comet" — eligible for selective hydration, at the granularity of each
 * individual point of use (`<Counter comet="visible" />`), not just by file location. Server-side,
 * this always renders the component's real HTML (a Comet's content is never withheld from the
 * initial response, regardless of strategy — `comet="only"` is the one exception, see below) and
 * wraps it in a small marker carrying everything `hydrateComets` (the client-side counterpart)
 * needs to hydrate it later: the strategy, the module to import, this instance's own props, and
 * which export of that module is the component.
 *
 * A comet file needs three things, all enforced or computed here rather than left to the author to
 * get right by hand:
 * - `'use comet'` as the file's first statement — how `cometPlugin` (`@zanix/space/vite`) finds
 *   this file and forces it into its own build output chunk, the same directive-prologue mechanism
 *   `'use client'` uses in React Server Components, for the same reason (a single-file check a
 *   bundler plugin can run before it even resolves the module's own imports).
 * - `Component` exported under its own name (`export function Counter() {}`, not a default
 *   export) — `defineComet` reads `Component.name` to know which export the client should grab
 *   after dynamically importing this same module; the wrapped component below is what becomes the
 *   default export instead, so the two never collide.
 * - `sourceUrl` — always `import.meta.url`, written at this exact call site (inside the comet's own
 *   file — calling `defineComet` from anywhere else captures the wrong file's identity). This is
 *   what lets `resolveCometModuleUrl` correlate this source file to whatever hashed URL its client
 *   build produced, via the manifest `cometPlugin` writes during that build.
 *
 * This module is authored WITHOUT JSX, deliberately, and must stay that way. JSX here compiles
 * against this package's own fixed `jsxImportSource: 'react'` regardless of which renderer an app
 * runs, which made every element this boundary produced React-shaped — silently unrenderable by
 * `preact-render-to-string`, and the cause of a real defect where Comets disappeared entirely
 * under `--renderer=preact`. Elements are built through `getCometElementFactory()` instead, which
 * resolves the active renderer's own `createElement` at render time. See `element-factory.ts`'s
 * own module doc for the full account.
 *
 * Its SIGNATURE is renderer-neutral for the same reason, and was not always: it named React's own
 * `ComponentType`/`ReactElement`, so a `--renderer=preact` app — whose Comets this function renders
 * correctly at runtime — could not call it without an `as unknown as ComponentType<...>` cast (see
 * {@linkcode CometComponent}). Both types are structural now, so each renderer's own components
 * type-check here directly, and neither renderer is the default.
 *
 * @param Component - The component to make hydratable. Must be a named function/const (not
 * anonymous) — its own `.name` is how the client knows what to import back out of this module.
 * Typed as {@linkcode CometComponent}: a React component, a Preact component, or a class component
 * of either, with its own props still inferred (see that type's own doc).
 * @param sourceUrl - This file's own `import.meta.url`. Never a value computed or passed in from
 * anywhere else.
 * @returns A component accepting `Component`'s own props plus `CometProps` — use it exactly like
 * the original component, adding `comet`/`cometMedia` at any call site that needs to override the
 * default (`'load'`). Usable directly in either renderer's own JSX (see
 * {@linkcode CometBoundaryComponent}).
 * @throws {InternalError} If `Component` has no name (e.g. an anonymous arrow function) — there
 * would be nothing for the client to import back out of this module.
 *
 * @example
 * ```tsx
 * // comets/counter.tsx
 * 'use comet'
 * import { defineComet } from '@zanix/space/comet'
 *
 * export function Counter({ initial }: { initial: number }) {/* ... *\/ }
 * export default defineComet(Counter, import.meta.url)
 * ```
 */
export function defineComet<P extends object>(
  Component: CometComponent<P>,
  sourceUrl: string,
): CometBoundaryComponent<P & CometProps> {
  const exportName = Component.name
  if (!exportName) {
    throw new InternalError(
      'defineComet() requires a named component — an anonymous function has nothing for the ' +
        'client to import back out of this module.',
      { meta: { sourceUrl } },
    )
  }

  function CometBoundary(props: P & CometProps): SpaceChildren {
    const { comet = 'load', cometMedia, persist, ...rest } = props
    const componentProps = rest as P

    // The active renderer's own `createElement` — resolved per render, not per module load, so a
    // renderer switched after this comet was defined (exactly what `defineSpaceApp` does at
    // startup, and what a test does between cases) is always honoured.
    //
    // The ONE cast in this function, and it re-states nothing: `CometElementFactory` declares its
    // return as `unknown` because no single type describes both renderers' element values (see
    // `element-factory.ts`), and what comes back is by construction exactly one element — i.e. a
    // `SpaceChildren`. Narrowing it here, at the single point where that erasure happens, is what
    // lets `CometBoundary` (and therefore `defineComet`'s own public return type) be
    // `SpaceChildren` instead of leaking `any` to whoever calls a comet outside JSX. Parameters are
    // taken from the factory's own type rather than repeated, so the cast cannot drift from it.
    const h = getCometElementFactory() as (
      ...args: Parameters<CometElementFactory>
    ) => SpaceChildren

    if (comet === 'none') return h(Component, componentProps)

    // This comet's OWN CSS (its `.module.css` imports, correlated at build time — see
    // `cssPlugin`'s own doc) — `[]` when it has none, or in dev (Vite's own dev-time module graph
    // already injects a loaded comet's CSS Module client-side with zero help needed here).
    const cometCssRefs = getCometCssHrefs(sourceUrl)
    // React 19 hoists AND dedupes (by `href`) a `precedence`-managed `<link>` declared anywhere in
    // the tree into the real `<head>` — the same mechanism `theme.resolve`'s own `<style>`
    // placement already relies on — so rendering it right here, at this comet's own position, is
    // enough; React moves it. Preact has no hoisting at all (same contract `themeStyle`'s own doc
    // already documents), so its `<link>` renders wherever declared — exactly here, the same
    // "wherever placed IS its final position" contract already established for `themeStyle` under
    // this renderer. One accepted, documented consequence: a comet used twice on the same PREACT
    // page repeats its own `<link>` (React would dedupe it automatically) — harmless, since it's
    // the same URL and CSS rules are idempotent to reapply, not a correctness gap, just one more
    // already-reduced capability this renderer has relative to React.
    const precedence = getActiveRenderer() === 'react' ? 'space' : undefined

    // A Comet's own props cross the server/client boundary as plain JSON — the same contract
    // `renderToResponse`'s own `initialState` option follows (see `initial-state-global.ts`'s own
    // module doc for the full contract: supported types, exact behavior for every unsupported
    // one). Unlike that page-level state, an unserializable prop here throws a clear,
    // Space-authored error naming the offending Comet, rather than a graceful 500 — a Comet's
    // props are evaluated as part of a normal render pass, where an uncaught throw is already the
    // correct, pre-existing way errors propagate (the same Suspense/error-boundary machinery any
    // other render error goes through), so this stays consistent with that instead of inventing a
    // second, Comet-specific graceful-failure path alongside it.
    let serializedProps: string
    try {
      // `encodeForWire` only when the app opted in (`defineSpaceApp({ serialization })`) — with the
      // codec off this is the same bare `JSON.stringify` it has always been, producing the same
      // bytes. See `serialization-codec.ts` for what the enabled path adds and why it is scoped to
      // exactly three types.
      serializedProps = stringifyForWire(componentProps)
    } catch (error) {
      throw new InternalError(
        `Comet "${exportName}"'s own props are not JSON-serializable — a Comet's props cross ` +
          "the server/client boundary as plain JSON (see CometProps' own doc). Remove or " +
          'replace whatever value caused this (a circular reference, a function, a class ' +
          'instance carrying non-JSON state, ...) before passing it to this Comet.',
        { meta: { sourceUrl, exportName }, cause: error },
      )
    }

    const cssLinks = cometCssRefs.map((ref) => {
      const href = typeof ref === 'string' ? ref : ref.href
      const media = typeof ref === 'string' ? undefined : ref.media
      return h('link', { key: href, rel: 'stylesheet', href, media, precedence })
    })

    return h(
      'div',
      {
        // `display: contents` (so this boundary never breaks a parent `display: grid`/`flex`
        // layout by inserting an extra box between it and its real children) comes from
        // `builtin-css.ts`'s own stylesheet rule, targeting this same `COMET_ID_ATTR` selector —
        // never an inline `style` prop here. See that module's own doc for why: a strict
        // `style-src` with no `'unsafe-inline'` silently drops an inline `style` ATTRIBUTE
        // (nonces don't cover it), which would otherwise leave every Comet boundary as a real,
        // unstyled box in production for any app using the framework's own default CSP.
        // A hash of the source path, never the raw path itself — see `hashSourceKey`'s own doc
        // for why: the raw value would leak the server's local filesystem layout into every
        // page's public HTML.
        [COMET_ID_ATTR]: hashSourceKey(normalizeSourceKey(sourceUrl)),
        [COMET_STRATEGY_ATTR]: comet,
        [COMET_MEDIA_ATTR]: cometMedia,
        [COMET_MODULE_ATTR]: resolveCometModuleUrl(sourceUrl),
        [COMET_EXPORT_ATTR]: exportName,
        [COMET_PERSIST_ATTR]: persist,
        [COMET_PROPS_ATTR]: serializedProps,
      },
      cssLinks,
      // `comet="only"` mounts fresh on the client (createRoot, never hydrateRoot) — rendering the
      // real component here too would just be thrown away and risk a hydration mismatch.
      comet === 'only' ? null : h(Component, componentProps),
    )
  }

  return CometBoundary
}
