import { createElement } from 'react'
import { createRoot, hydrateRoot } from 'react-dom/client'
import type { CometStrategy } from 'typings/comet.ts'
import logger from './client-logger.ts'
import {
  COMET_EXPORT_ATTR,
  COMET_ID_ATTR,
  COMET_MEDIA_ATTR,
  COMET_MODULE_ATTR,
  COMET_PROPS_ATTR,
  COMET_REUSED_ATTR,
  COMET_STRATEGY_ATTR,
} from '../comets/marker.ts'
import { hashSourceKey } from '../comets/comet-manifest.ts'
// Imported directly, never through `comet-id-scope.ts`'s own per-renderer registry — that
// registry exists for `define-comet.ts`, which renders under WHICHEVER renderer is active in one
// process (this package's own test suite runs both). This file is already committed to React at
// the module level (`createElement`/`hydrateRoot` above are the same direct, static imports), so
// its Preact counterpart (`hydrate-comets-preact.ts`) is the one that ever loads the OTHER
// Provider — exactly the same reasoning that keeps this file's own `createElement` a direct import
// instead of `getCometElementFactory()`.
import { CometIdScopeProvider } from '../comets/comet-id-scope-react.tsx'
import { parseCometProps } from '../render/serialization-codec.ts'
import { scheduleCometHydration } from './schedule-comet-hydration.ts'
import { registerCometHandle } from './comet-persistence.ts'
import { setCometHydrator } from './hydrator-registry.ts'
import { isNestedComet } from './nested-comet-guard.ts'
import { setActiveRenderer } from '../router/active-renderer.ts'
import { setCometElementFactory } from '../comets/element-factory.ts'
import type { CometElementFactory } from '../comets/element-factory.ts'
import { setCometIdScopeProvider } from '../comets/comet-id-scope.ts'

// Registers this renderer's CLIENT-SAFE runtime pieces — see `hydrate-comets-preact.ts`'s own
// identical registration for the full "why" (this file's own Preact counterpart hit the exact
// same gap, for the exact same reason). `createElement`/`CometIdScopeProvider` above are already
// imported for the top-level hydrate path itself, so this adds no new dependency and pulls in none
// of the SSR-only renderers `installRendererRuntime` also carries server-side.
setActiveRenderer('react')
setCometElementFactory('react', createElement as CometElementFactory)
setCometIdScopeProvider('react', CometIdScopeProvider)

async function hydrateBoundary(boundary: HTMLElement): Promise<void> {
  const moduleUrl = boundary.getAttribute(COMET_MODULE_ATTR)
  if (!moduleUrl) return

  const exportName = boundary.getAttribute(COMET_EXPORT_ATTR) || 'default'
  const strategy = (boundary.getAttribute(COMET_STRATEGY_ATTR) || 'load') as CometStrategy
  const rawProps = boundary.getAttribute(COMET_PROPS_ATTR)
  const props = parseCometProps(rawProps)

  // The SAME instance scope `define-comet.ts` computed server-side — `COMET_ID_ATTR` is already
  // that call's own `sourceHash`, and `rawProps` (read here BEFORE `parseCometProps`, never
  // re-serialized) is the exact same string `serializedProps` published, so hashing it here
  // reproduces the identical value. See `comet-id-scope-react.tsx`'s own doc for the full "why".
  const instanceScope = `${boundary.getAttribute(COMET_ID_ATTR) ?? ''}-${
    hashSourceKey(rawProps ?? '')
  }`

  const module = await import(/* @vite-ignore */ moduleUrl) as Record<
    string,
    // deno-lint-ignore no-explicit-any
    any
  >
  const Component = module[exportName]
  const element = createElement(
    CometIdScopeProvider,
    { value: instanceScope },
    createElement(Component, props),
  )

  // Both branches produce the same real `Root` — `createRoot`/`hydrateRoot` differ only in
  // whether they hydrate existing SSR markup or mount fresh, never in the `Root` API surface
  // itself (`.render()`/`.unmount()`), so a single retained `root` covers both for the
  // registration below.
  const root = strategy === 'only' ? createRoot(boundary) : hydrateRoot(boundary, element)
  if (strategy === 'only') root.render(element)

  // Registered for EVERY top-level boundary, `persist`-tagged or not — see
  // `disposeOutletComets`'s own doc (`comet-persistence.ts`) for the real, confirmed leak this
  // closes: without a real `dispose()` to call, an Orbit swap's `outlet.replaceChildren(...)`
  // only ever discards this boundary's DOM node, never its React root, leaving every hook's own
  // cleanup — an event listener, a timer — permanently unrun. `reuse` stays real either way; it's
  // simply never invoked for a boundary that never becomes a `RetainedCometCache` entry in the
  // first place (that only happens via `detachPersistedComets`, `persist`-gated on ITS OWN side).
  registerCometHandle(boundary, {
    // `nextProps` is `unknown` at the OrbitCometHandle boundary on purpose — this module
    // doesn't know the component's own prop type any more than the dynamic `import()` above
    // does; `Component` is already `any`-typed for the same reason. `instanceScope` is closed
    // over from the ORIGINAL mount above, never recomputed from `nextProps` — this instance's
    // own id-scope stays fixed for its whole persisted lifetime, matching the same contract a
    // real hydration root's own `useId()` counter would.
    reuse: (nextProps) =>
      root.render(
        createElement(
          CometIdScopeProvider,
          { value: instanceScope },
          // deno-lint-ignore no-explicit-any
          createElement(Component, nextProps as any),
        ),
      ),
    dispose: () => root.unmount(),
  })
}

/**
 * Hydrates every Comet boundary under `root`, each on its own declared `CometStrategy` timing (see
 * `scheduleCometHydration`, which decides *when*; this decides *what* — dynamically importing the
 * boundary's own module and mounting/hydrating it). Meant to be called once, after the initial
 * page load, from this app's own client entry module — or via `initClientEntry()`
 * (`client-entry-init.ts`), which calls this alongside `hydrateErrorBoundaries()`/`initOrbit()`.
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

    // A Comet composed inside ANOTHER Comet's own content hydrates transitively, as part of that
    // outer boundary's own `hydrateRoot` call — see `nested-comet-guard.ts`'s own doc for the real
    // conflict a second, independent call here produces.
    if (isNestedComet(boundary)) return

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
