/**
 * Shared server data for the Space/Comets architecture benchmark — the SAME data, generated the
 * SAME way, feeds all 4 variants (`variants/`). "Server-fetched data" is simulated with a
 * `Promise`-returning function (same shape a real `loader` uses) rather than a real network call —
 * deterministic and fast, without making the benchmark depend on an external service's own
 * latency, which would measure that service, not this architecture.
 *
 * @module
 */

export interface Product {
  id: number
  name: string
  category: 'audio' | 'kitchen' | 'outdoor' | 'office'
  price: number
  description: string
}

const CATEGORIES = ['audio', 'kitchen', 'outdoor', 'office'] as const

const ADJECTIVES = ['Compact', 'Pro', 'Ultra', 'Essential', 'Studio', 'Field']
const NOUNS = ['Speaker', 'Kettle', 'Chair', 'Lamp', 'Backpack', 'Monitor']

/** 24 products — enough server-rendered content to be substantial without making the benchmark
 * slow to build/run repeatedly. Deterministic (no `Math.random`) so every variant renders byte-
 * identical server content off the same input. */
export function makeProducts(count = 24): Product[] {
  return Array.from({ length: count }, (_, i) => {
    const category = CATEGORIES[i % CATEGORIES.length]
    const adjective = ADJECTIVES[i % ADJECTIVES.length]
    const noun = NOUNS[(i + 2) % NOUNS.length]
    return {
      id: i,
      name: `${adjective} ${noun} ${i + 1}`,
      category,
      price: 19.99 + (i % 7) * 10,
      description: `The ${adjective.toLowerCase()} ${noun.toLowerCase()} built for everyday use, ` +
        `combining reliable performance with a design that fits any space. Item reference #${
          1000 + i
        }.`,
    }
  })
}

/** Simulates a `loader`'s own server-side fetch — resolves on a microtask, no artificial delay. */
export function fetchProducts(): Promise<Product[]> {
  return Promise.resolve(makeProducts())
}
