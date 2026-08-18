/// <reference lib="dom" />
import { createElement, hydrate, render } from 'preact'
import type { CometStrategy } from 'typings/comet.ts'
import logger from '@zanix/logger'
import {
  COMET_EXPORT_ATTR,
  COMET_ID_ATTR,
  COMET_MEDIA_ATTR,
  COMET_MODULE_ATTR,
  COMET_PERSIST_ATTR,
  COMET_PROPS_ATTR,
  COMET_REUSED_ATTR,
  COMET_STRATEGY_ATTR,
} from '../comets/marker.ts'
import { parseCometProps } from '../render/serialization-codec.ts'
import { scheduleCometHydration } from './schedule-comet-hydration.ts'
import { registerPersistHandle } from './comet-persistence.ts'
import { setCometHydrator } from './hydrator-registry.ts'

async function hydrateBoundary(boundary: HTMLElement): Promise<void> {
  const moduleUrl = boundary.getAttribute(COMET_MODULE_ATTR)
  if (!moduleUrl) return

  const exportName = boundary.getAttribute(COMET_EXPORT_ATTR) || 'default'
  const strategy = (boundary.getAttribute(COMET_STRATEGY_ATTR) || 'load') as CometStrategy
  const props = parseCometProps(boundary.getAttribute(COMET_PROPS_ATTR))
  const persistKey = boundary.getAttribute(COMET_PERSIST_ATTR)

  const module = await import(/* @vite-ignore */ moduleUrl) as Record<
    string,
    // deno-lint-ignore no-explicit-any
    any
  >
  const Component = module[exportName]
  const element = createElement(Component, props)

  if (strategy === 'only') render(element, boundary)
  else hydrate(element, boundary)

  // Preact keeps no separate "root" object the way React does — its own reconciliation state
  // lives on `boundary` itself (confirmed by this file's own doc above: `hydrate()`/`render()`
  // reuse whatever's already attached to a container, with no remount). Reuse is therefore just
  // calling `render()` again on the SAME node; dispose is Preact's own documented unmount idiom,
  // `render(null, container)`.
  if (persistKey) {
    registerPersistHandle(boundary, {
      // `nextProps` is `unknown` at the OrbitPersistHandle boundary on purpose — same reasoning
      // as the dynamic `import()`/`Component` typing above.
      // deno-lint-ignore no-explicit-any
      reuse: (nextProps) => render(createElement(Component, nextProps as any), boundary),
      dispose: () => render(null, boundary),
    })
  }
}

/**
 * Preact-core counterpart to `hydrate-comets.ts`'s `hydrateComets` — same public contract, same
 * Comet marker protocol (`marker.ts`, shared unmodified between both renderers), same
 * `scheduleCometHydration` scheduling. The only difference from the React version is this
 * function's own mount call: `hydrate`/`render` from `'preact'` (Preact core, never
 * `preact/compat`) in place of `hydrateRoot`/`createRoot` from `react-dom/client` — confirmed via
 * this package's own decision spike (a real, disposable `jsdom` + real `MouseEvent` dispatch) that
 * `hydrate()` reuses the server-rendered DOM node exactly like `hydrateRoot()` does, with no
 * remount and no observable behavior difference for a Comet's own hydration/interaction path.
 *
 * Lives in a separate module (not a branch inside `hydrate-comets.ts`) on purpose — an app's own
 * client entry imports whichever one matches its `--renderer` choice (see
 * `@zanix/space/client/preact` vs `@zanix/space/client`), so only the renderer actually in use
 * ever ships to that app's client bundle; neither file imports the other renderer's package.
 *
 * @param root - See `hydrateComets`'s own doc.
 */
export function hydrateComets(root: ParentNode = document): void {
  const boundaries = root.querySelectorAll<HTMLElement>(`[${COMET_ID_ATTR}]`)

  boundaries.forEach((boundary) => {
    // Already updated in place by `reuseRetainedComets` (`comet-persistence.ts`), as part of the
    // SAME Orbit swap that produced this subtree — a fresh `hydrate()` call here would fight the
    // retained instance's own already-live reconciliation state, not hydrate anything real.
    if (boundary.hasAttribute(COMET_REUSED_ATTR)) {
      boundary.removeAttribute(COMET_REUSED_ATTR)
      return
    }

    const strategy = (boundary.getAttribute(COMET_STRATEGY_ATTR) || 'load') as CometStrategy
    if (strategy === 'none') return

    const media = boundary.getAttribute(COMET_MEDIA_ATTR) ?? undefined
    scheduleCometHydration(strategy, boundary, media, () => {
      hydrateBoundary(boundary).catch((error) => {
        logger.error('Failed to hydrate a Comet boundary', error)
      })
    })
  })
}

// Registers this (Preact) implementation as the hydrator `orbit.ts` calls after a swap —
// set once, at module load, so importing a client barrel is all an app ever has to do.
// See `hydrator-registry.ts`'s own doc for the defect this closes.
setCometHydrator(hydrateComets)
