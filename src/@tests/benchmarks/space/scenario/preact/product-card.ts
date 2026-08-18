import { createElement } from 'preact'
import type { ComponentType } from 'preact'
import type { Product } from '../data.ts'

/** Preact counterpart to `react/product-card.tsx`. */
export function ProductCard(
  { product, LikeButton }: { product: Product; LikeButton: ComponentType<{ productId: number }> },
) {
  return createElement(
    'article',
    { 'data-testid': `product-${product.id}` },
    createElement('h3', null, product.name),
    createElement('p', { className: 'category' }, product.category),
    createElement('p', { className: 'price' }, `$${product.price.toFixed(2)}`),
    createElement('p', { className: 'description' }, product.description),
    createElement(LikeButton, { productId: product.id }),
  )
}
