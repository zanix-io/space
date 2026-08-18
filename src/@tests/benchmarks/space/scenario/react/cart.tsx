import { useState } from 'react'
import type { Product } from '../data.ts'

/**
 * The required "at least one stateful interactive Comet" — the largest, most stateful component
 * in the scenario: an add/remove cart with a derived total (`reduce`, recomputed every render,
 * the same Compiler-sensitive shape as the Deno-level `derived-values` scenario) and a visible
 * item count. Takes the full product list as a prop (server-fetched data reaching a client
 * component), same as a real "add to cart" widget would.
 */
export function Cart({ products }: { products: Product[] }) {
  const [itemIds, setItemIds] = useState<number[]>([])

  const items = itemIds
    .map((id) => products.find((p) => p.id === id))
    .filter((p): p is Product => p !== undefined)
  const total = items.reduce((sum, item) => sum + item.price, 0)

  return (
    <div data-testid='cart'>
      <p data-testid='cart-count'>{items.length} items — ${total.toFixed(2)}</p>
      <button
        type='button'
        data-testid='cart-add'
        onClick={() => setItemIds((ids) => [...ids, products[ids.length % products.length].id])}
      >
        Add next item
      </button>
      <button
        type='button'
        data-testid='cart-clear'
        onClick={() => setItemIds([])}
      >
        Clear
      </button>
      <ul>
        {items.map((item, i) => <li key={`${item.id}-${i}`}>{item.name}</li>)}
      </ul>
    </div>
  )
}
