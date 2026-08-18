import { INITIAL_STATE_GLOBAL } from './initial-state-global.ts'
import { decodeFromWire } from './serialization-codec.ts'

/**
 * Reads back, on the client, the state a server render handed off via
 * {@linkcode renderToResponse}'s `initialState` option. Client-safe — this module (and the
 * zero-dependency `initial-state-global.ts` it imports) never imports `react-dom/server`, so
 * pulling it into a client bundle never drags server-only code along.
 *
 * @returns The value passed as `initialState` on the server, or `undefined` if the page was
 * rendered without one.
 *
 * @example
 * ```ts
 * const { product } = readInitialState<{ product: Product }>() ?? {}
 * ```
 */
export function readInitialState<T>(): T | undefined {
  // Decoded on read rather than in the injected script: the script stays a bare assignment (no
  // codec code shipped inline, in either renderer), and an app that never calls this pays nothing.
  // `decodeFromWire` returns a plain payload untouched, so a page rendered with the codec off
  // behaves exactly as it always has.
  return decodeFromWire(
    (globalThis as Record<string, unknown>)[INITIAL_STATE_GLOBAL],
  ) as T | undefined
}
