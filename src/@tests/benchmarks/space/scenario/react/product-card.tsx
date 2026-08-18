import type { ComponentType } from 'react'
import type { Product } from '../data.ts'

/**
 * Static, server-rendered-only content — never hydrated in ANY variant, including "full
 * hydration" (its own text/markup is identical everywhere; only the injected `LikeButton` inside
 * it differs by variant). This is the "substantial server-rendered content" half of the scenario —
 * 24 of these render on the page, each with real description text, not placeholder text.
 */
export function ProductCard(
  { product, LikeButton }: { product: Product; LikeButton: ComponentType<{ productId: number }> },
) {
  return (
    <article data-testid={`product-${product.id}`}>
      <h3>{product.name}</h3>
      <p className='category'>{product.category}</p>
      <p className='price'>${product.price.toFixed(2)}</p>
      <p className='description'>{product.description}</p>
      <LikeButton productId={product.id} />
    </article>
  )
}
