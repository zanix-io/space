import type { ComponentType } from 'react'
import type { Product } from '../data.ts'
import { ProductCard } from './product-card.tsx'
import { RelatedItems } from './related-items.tsx'

/**
 * Composes the whole scenario page — identical structure/content across every variant. The 3
 * interactive components are taken as PROPS (dependency injection), not imported directly, so the
 * exact same composition function produces variant A (plain components, full hydration) and
 * variants B/C (the SAME component bodies, wrapped in `defineComet`) without duplicating this
 * file — the only thing that differs between variants is which implementation of `LikeButton`/
 * `Newsletter`/`Cart` gets passed in, never the page's own structure. See `variants/`'s own doc
 * for exactly what each variant injects.
 *
 * Deliberately no wrapping `<div id="...">` of its own — this component stays agnostic to
 * whatever document shell/hydration-root convention each variant's own serving harness uses
 * (Space's own document shell for B/C/D, a hand-built shell for variant A), rather than baking in
 * an id only one of the four variants would actually need.
 */
export interface PageComponents {
  LikeButton: ComponentType<{ productId: number }>
  Newsletter: ComponentType<Record<string, never>>
  Cart: ComponentType<{ products: Product[] }>
}

export function Page(
  { products, components }: { products: Product[]; components: PageComponents },
) {
  const { LikeButton, Newsletter, Cart } = components
  return (
    <>
      <header>
        <h1>Space/Comets architecture benchmark</h1>
        <Cart products={products} />
      </header>
      <main>
        <section data-testid='product-grid'>
          {products.map((product) => (
            <ProductCard key={product.id} product={product} LikeButton={LikeButton} />
          ))}
        </section>
        <RelatedItems products={products} />
        <Newsletter />
      </main>
    </>
  )
}
