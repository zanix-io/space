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
  COMET_PROPS_ATTR,
  COMET_STRATEGY_ATTR,
} from '../comets/marker.ts'
import { scheduleCometHydration } from './schedule-comet-hydration.ts'

async function hydrateBoundary(boundary: HTMLElement): Promise<void> {
  const moduleUrl = boundary.getAttribute(COMET_MODULE_ATTR)
  if (!moduleUrl) return

  const exportName = boundary.getAttribute(COMET_EXPORT_ATTR) || 'default'
  const strategy = (boundary.getAttribute(COMET_STRATEGY_ATTR) || 'load') as CometStrategy
  const props = JSON.parse(boundary.getAttribute(COMET_PROPS_ATTR) || '{}')

  // deno-lint-ignore no-explicit-any
  const module = await import(/* @vite-ignore */ moduleUrl) as Record<string, any>
  const element = createElement(module[exportName], props)

  if (strategy === 'only') createRoot(boundary).render(element)
  else hydrateRoot(boundary, element)
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
