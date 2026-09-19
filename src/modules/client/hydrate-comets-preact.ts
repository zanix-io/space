import { createElement, hydrate, render } from 'preact'
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
// Imported directly, never through `comet-id-scope.ts`'s own per-renderer registry — see
// `hydrate-comets.ts`'s own identical import for the full "why" (this file is already committed
// to Preact at the module level, same as that one is to React).
import { CometIdScopeProvider } from '../comets/comet-id-scope-preact.tsx'
import { parseCometProps } from '../render/serialization-codec.ts'
import { scheduleCometHydration } from './schedule-comet-hydration.ts'
import { registerCometHandle } from './comet-persistence.ts'
import { setCometHydrator } from './hydrator-registry.ts'
import { isNestedComet } from './nested-comet-guard.ts'
import { setActiveRenderer } from '../router/active-renderer.ts'
import { setCometElementFactory } from '../comets/element-factory.ts'
import type { CometElementFactory } from '../comets/element-factory.ts'
import { setCometIdScopeProvider } from '../comets/comet-id-scope.ts'

// Registers this renderer's CLIENT-SAFE runtime pieces — never the full `installRendererRuntime`
// an app's main module installs server-side (`@zanix/space/preact`), which also carries three
// SSR-only renderers (`renderPage`/`renderNotFound`/`renderLoaderError`) that must never reach a
// client bundle. `defineComet`'s own boundary (`define-comet.ts`) reads `getCometElementFactory`/
// `getActiveRenderer`/`getCometIdScopeProvider` to build a NESTED Comet's markup — one composed
// directly inside another already-hydrating Comet's own render tree (e.g. `ProductImage` inside a
// card component nested in a page-level Comet), as opposed to a top-level boundary, which this
// file's own `hydrateBoundary` mounts by calling `createElement(Component, props)` directly and
// never touches these registries at all. Real, confirmed gap this closes: this package's own
// auto-generated client entry (`client-entry-plugin.ts`) never imported anything that populated
// these registries, so every top-level Comet hydrated fine (it never needed them) while ANY Comet
// nested inside one threw `InternalError: no react element factory is registered` on every single
// hydration — unconditionally, not a race, just nothing ever having been registered client-side.
// `createElement`/`CometIdScopeProvider` above are already imported for the top-level hydrate path
// itself, so this adds no new dependency and pulls in none of the server-only renderers.
setActiveRenderer('preact')
setCometElementFactory('preact', createElement as CometElementFactory)
setCometIdScopeProvider('preact', CometIdScopeProvider)

async function hydrateBoundary(boundary: HTMLElement): Promise<void> {
  const moduleUrl = boundary.getAttribute(COMET_MODULE_ATTR)
  if (!moduleUrl) return

  const exportName = boundary.getAttribute(COMET_EXPORT_ATTR) || 'default'
  const strategy = (boundary.getAttribute(COMET_STRATEGY_ATTR) || 'load') as CometStrategy
  const rawProps = boundary.getAttribute(COMET_PROPS_ATTR)
  const props = parseCometProps(rawProps)

  // The SAME instance scope `define-comet.ts` computed server-side — see `hydrate-comets.ts`'s
  // own identical derivation for the full "why".
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

  if (strategy === 'only') render(element, boundary)
  else hydrate(element, boundary)

  // Preact keeps no separate "root" object the way React does — its own reconciliation state
  // lives on `boundary` itself (confirmed by this file's own doc above: `hydrate()`/`render()`
  // reuse whatever's already attached to a container, with no remount). Reuse is therefore just
  // calling `render()` again on the SAME node; dispose is Preact's own documented unmount idiom,
  // `render(null, container)`.
  //
  // Registered for EVERY top-level boundary, `persistKey` or not — see `disposeOutletComets`'s
  // own doc (`comet-persistence.ts`) for the real, confirmed leak this closes: without a real
  // `dispose()` to call, an Orbit swap's `outlet.replaceChildren(...)` only ever discards this
  // boundary's DOM node, never its Preact instance, leaving every hook's own cleanup — an event
  // listener, a timer — permanently unrun. `reuse` stays real either way; it's simply never
  // invoked for a boundary that never becomes a `RetainedCometCache` entry in the first place
  // (that only happens via `detachPersistedComets`, `persistKey`-gated on ITS OWN side).
  registerCometHandle(boundary, {
    // `nextProps` is `unknown` at the OrbitCometHandle boundary on purpose — same reasoning
    // as the dynamic `import()`/`Component` typing above. `instanceScope` is closed over from
    // the ORIGINAL mount above, never recomputed from `nextProps` — see `hydrate-comets.ts`'s
    // own identical reuse closure for the full "why".
    reuse: (nextProps) =>
      render(
        createElement(
          CometIdScopeProvider,
          { value: instanceScope },
          // deno-lint-ignore no-explicit-any
          createElement(Component, nextProps as any),
        ),
        boundary,
      ),
    dispose: () => render(null, boundary),
  })
}

/**
 * Preact-core counterpart to `hydrate-comets.ts`'s `hydrateComets` — same public contract, same
 * Comet marker protocol (`marker.ts`, shared unmodified between both renderers), same
 * `scheduleCometHydration` scheduling. The only difference from the React version is this
 * function's own mount call: `hydrate`/`render` from `'preact'` (Preact core, never
 * `preact/compat`) in place of `hydrateRoot`/`createRoot` from `react-dom/client`: `hydrate()`
 * reuses the server-rendered DOM node exactly like `hydrateRoot()` does, with no
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

    // A Comet composed inside ANOTHER Comet's own content hydrates transitively, as part of that
    // outer boundary's own `hydrate()` call — see `nested-comet-guard.ts`'s own doc for the real
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

// Registers this (Preact) implementation as the hydrator `orbit.ts` calls after a swap —
// set once, at module load, so importing a client barrel is all an app ever has to do.
// See `hydrator-registry.ts`'s own doc for the defect this closes.
setCometHydrator(hydrateComets)
