import type { ComponentType } from 'react'
import type { CometProps } from 'typings/comet.ts'
import { InternalError } from '@zanix/errors'
import {
  COMET_EXPORT_ATTR,
  COMET_ID_ATTR,
  COMET_MEDIA_ATTR,
  COMET_MODULE_ATTR,
  COMET_PROPS_ATTR,
  COMET_STRATEGY_ATTR,
} from './marker.ts'
import { resolveCometModuleUrl } from './comet-manifest.ts'

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
 * @param Component - The component to make hydratable. Must be a named function/const (not
 * anonymous) — its own `.name` is how the client knows what to import back out of this module.
 * @param sourceUrl - This file's own `import.meta.url`. Never a value computed or passed in from
 * anywhere else.
 * @returns A component accepting `Component`'s own props plus `CometProps` — use it exactly like
 * the original component, adding `comet`/`cometMedia` at any call site that needs to override the
 * default (`'load'`).
 * @throws {InternalError} If `Component` has no name (e.g. an anonymous arrow function) — there
 * would be nothing for the client to import back out of this module.
 *
 * @example
 * ```tsx
 * // comets/counter.tsx
 * 'use comet'
 * import { defineComet } from '@zanix/space'
 *
 * export function Counter({ initial }: { initial: number }) {/* ... *\/ }
 * export default defineComet(Counter, import.meta.url)
 * ```
 */
export function defineComet<P extends object>(
  Component: ComponentType<P>,
  sourceUrl: string,
): ComponentType<P & CometProps> {
  const exportName = Component.name
  if (!exportName) {
    throw new InternalError(
      'defineComet() requires a named component — an anonymous function has nothing for the ' +
        'client to import back out of this module.',
      { meta: { sourceUrl } },
    )
  }

  function CometBoundary(props: P & CometProps) {
    const { comet = 'load', cometMedia, ...rest } = props
    const componentProps = rest as P

    if (comet === 'none') return <Component {...componentProps} />

    return (
      <div
        // `display: contents` so this boundary never breaks a parent `display: grid`/`flex` layout
        // by inserting an extra box between it and its real children — overridable by any more
        // specific consumer CSS that genuinely needs a real box here.
        style={{ display: 'contents' }}
        {...{
          [COMET_ID_ATTR]: sourceUrl,
          [COMET_STRATEGY_ATTR]: comet,
          [COMET_MEDIA_ATTR]: cometMedia,
          [COMET_MODULE_ATTR]: resolveCometModuleUrl(sourceUrl),
          [COMET_EXPORT_ATTR]: exportName,
          [COMET_PROPS_ATTR]: JSON.stringify(componentProps),
        }}
      >
        {
          /* `comet="only"` mounts fresh on the client (createRoot, never hydrateRoot) — rendering
        the real component here too would just be thrown away and risk a hydration mismatch. */
        }
        {comet === 'only' ? null : <Component {...componentProps} />}
      </div>
    )
  }

  return CometBoundary
}
