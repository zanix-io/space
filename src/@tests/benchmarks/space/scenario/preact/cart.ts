import { createElement } from 'preact'
import { useState } from 'preact/hooks'
import type { Product } from '../data.ts'

/** Preact counterpart to `react/cart.tsx` — same shape, same derived total. */
export function Cart({ products }: { products: Product[] }) {
  const [itemIds, setItemIds] = useState<number[]>([])

  const items = itemIds
    .map((id) => products.find((p) => p.id === id))
    .filter((p): p is Product => p !== undefined)
  const total = items.reduce((sum, item) => sum + item.price, 0)

  return createElement(
    'div',
    { 'data-testid': 'cart' },
    createElement(
      'p',
      { 'data-testid': 'cart-count' },
      `${items.length} items — $${total.toFixed(2)}`,
    ),
    createElement('button', {
      type: 'button',
      'data-testid': 'cart-add',
      onClick: () =>
        setItemIds((ids: number[]) => [...ids, products[ids.length % products.length].id]),
    }, 'Add next item'),
    createElement('button', {
      type: 'button',
      'data-testid': 'cart-clear',
      onClick: () => setItemIds([]),
    }, 'Clear'),
    createElement(
      'ul',
      null,
      items.map((item, i) => createElement('li', { key: `${item.id}-${i}` }, item.name)),
    ),
  )
}
