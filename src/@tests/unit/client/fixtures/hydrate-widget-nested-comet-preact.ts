import { createElement } from 'preact'
import { defineComet } from 'modules/comets/define-comet.ts'

/**
 * A Comet composed INSIDE another Comet's own render tree — `hydrate-comets-preact.test.ts`'s own
 * regression fixture for the real, confirmed gap this package's client bundle used to have: a
 * NESTED Comet (one imported and rendered directly inside another already-hydrating Comet's own
 * JSX, as opposed to a top-level boundary `hydrateComets` discovers and mounts on its own) reaches
 * `defineComet`'s own `CometBoundary`, which calls `getCometElementFactory()`/`getActiveRenderer()`/
 * `getCometIdScopeProvider()` — registries the client bundle never populated before
 * `hydrate-comets-preact.ts` started registering its own renderer's client-safe pieces at module
 * load. `product-image.comet.tsx`-style usage (a card component rendering a Comet for its own
 * thumbnail) is the real-world shape this fixture stands in for.
 */
const Inner = defineComet(
  function Inner({ label }: { label?: string }) {
    return createElement('em', { class: 'inner' }, `inner:${label ?? ''}`)
  },
  import.meta.url,
  'Inner',
)

/** The OUTER Comet `hydrate-comets-preact.test.ts` actually mounts via `hydrateComets` — its own
 * render reaches {@linkcode Inner} transitively, the same way a real page's Comet reaches a nested
 * one like `ProductImage`. */
export default function Outer({ label }: { label?: string }) {
  return createElement(
    'div',
    { class: 'outer' },
    `outer:${label ?? ''}`,
    createElement(Inner, { label }),
  )
}
