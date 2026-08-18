import { createElement } from 'preact'
import type { Product } from '../data.ts'

/** Preact counterpart to `react/related-items.tsx`. */
export function RelatedItems({ products }: { products: Product[] }) {
  const byCategory = new Map<string, Product[]>()
  for (const product of products) {
    const bucket = byCategory.get(product.category) ?? []
    bucket.push(product)
    byCategory.set(product.category, bucket)
  }

  return createElement(
    'section',
    { 'data-testid': 'related-items' },
    createElement('h2', null, 'Shop by category'),
    [...byCategory.entries()].map(([category, items]) =>
      createElement(
        'div',
        { key: category },
        createElement('h3', null, category),
        createElement(
          'ul',
          null,
          items.slice(0, 3).map((item) =>
            createElement('li', { key: item.id }, `${item.name} — $${item.price.toFixed(2)}`)
          ),
        ),
      )
    ),
  )
}
