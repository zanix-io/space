/// <reference lib="dom" />
import { createElement } from 'react'
import { createRoot, hydrateRoot } from 'react-dom/client'
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

  // Both branches produce the same real `Root` — `createRoot`/`hydrateRoot` differ only in
  // whether they hydrate existing SSR markup or mount fresh, never in the `Root` API surface
  // itself (`.render()`/`.unmount()`), so a single retained `root` covers both for the
  // `persist` registration below.
  const root = strategy === 'only' ? createRoot(boundary) : hydrateRoot(boundary, element)
  if (strategy === 'only') root.render(element)

  if (persistKey) {
    registerPersistHandle(boundary, {
      // `nextProps` is `unknown` at the OrbitPersistHandle boundary on purpose — this module
      // doesn't know the component's own prop type any more than the dynamic `import()` above
      // does; `Component` is already `any`-typed for the same reason.
      // deno-lint-ignore no-explicit-any
      reuse: (nextProps) => root.render(createElement(Component, nextProps as any)),
      dispose: () => root.unmount(),
    })
  }
}

/**
 * Hydrates every Comet boundary under `root`, each on its own declared `CometStrategy` timing (see
 * `scheduleCometHydration`, which decides *when*; this decides *what* — dynamically importing the
 * boundary's own module and mounting/hydrating it). Meant to be called once, after the initial
 * page load, from this app's own client entry module.
 *
 * Not unit-tested directly — beyond `scheduleCometHydration`'s own strategy-timing logic (which
 * is), this is a thin shim over real browser/React APIs (`document.querySelectorAll`,
 * `hydrateRoot`, dynamic `import()` of a URL) that only make sense with an actual DOM and network,
 * neither of which exist in this package's Deno-native test environment.
 *
 * @param root - Scopes the search for Comet boundaries — defaults to the whole document, but
 * accepting any `ParentNode` lets a future re-hydration pass (e.g. after an Orbit navigation swaps
 * in a new fragment) target only the newly inserted subtree.
 */
export function hydrateComets(root: ParentNode = document): void {
  const boundaries = root.querySelectorAll<HTMLElement>(`[${COMET_ID_ATTR}]`)

  boundaries.forEach((boundary) => {
    // Already updated in place by `reuseRetainedComets` (`comet-persistence.ts`), as part of the
    // SAME Orbit swap that produced this subtree — a fresh `hydrateRoot`/`createRoot` call here
    // would fight the retained instance's own already-live root, not hydrate anything real.
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

// Registers this (React) implementation as the hydrator `orbit.ts` calls after a swap —
// set once, at module load, so importing a client barrel is all an app ever has to do.
// See `hydrator-registry.ts`'s own doc for the defect this closes.
setCometHydrator(hydrateComets)
