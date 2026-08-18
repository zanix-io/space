import type { Product } from '../data.ts'

/** Derived/repeated UI — computed server-side from the same fetched product list (group by
 * category, take the first 3 per category), rendered as static, non-interactive markup. Never a
 * Comet in any variant; exercises the "derived value" shape at the page-composition level rather
 * than inside a single component. */
export function RelatedItems({ products }: { products: Product[] }) {
  const byCategory = new Map<string, Product[]>()
  for (const product of products) {
    const bucket = byCategory.get(product.category) ?? []
    bucket.push(product)
    byCategory.set(product.category, bucket)
  }

  return (
    <section data-testid='related-items'>
      <h2>Shop by category</h2>
      {[...byCategory.entries()].map(([category, items]) => (
        <div key={category}>
          <h3>{category}</h3>
          <ul>
            {items.slice(0, 3).map((item) => (
              <li key={item.id}>
                {item.name} — ${item.price.toFixed(2)}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  )
}
