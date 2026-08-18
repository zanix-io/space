import { createElement, Fragment } from 'preact'
import type { ComponentType } from 'preact'
import type { Product } from '../data.ts'
import { ProductCard } from './product-card.ts'
import { RelatedItems } from './related-items.ts'

/** Preact counterpart to `react/page.tsx` — same composition, same dependency-injection shape, same
 * "no wrapping div of its own" reasoning (see that file's own doc). */
export interface PageComponents {
  LikeButton: ComponentType<{ productId: number }>
  Newsletter: ComponentType<Record<string, never>>
  Cart: ComponentType<{ products: Product[] }>
}

export function Page(
  { products, components }: { products: Product[]; components: PageComponents },
) {
  const { LikeButton, Newsletter, Cart } = components
  return createElement(
    Fragment,
    null,
    createElement(
      'header',
      null,
      createElement('h1', null, 'Space/Comets architecture benchmark'),
      createElement(Cart, { products }),
    ),
    createElement(
      'main',
      null,
      createElement(
        'section',
        { 'data-testid': 'product-grid' },
        products.map((product) =>
          createElement(ProductCard, { key: product.id, product, LikeButton })
        ),
      ),
      createElement(RelatedItems, { products }),
      createElement(Newsletter, null),
    ),
  )
}
