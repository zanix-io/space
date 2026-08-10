import { INITIAL_STATE_GLOBAL } from './initial-state-global.ts'

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
  return (globalThis as Record<string, unknown>)[INITIAL_STATE_GLOBAL] as T | undefined
}
