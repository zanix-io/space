import { createContext, use, useContext } from 'react'
import type { ReactNode } from 'react'
import { InternalError } from '@zanix/errors'

/** One request's promise cache — a plain `Map` keyed by whatever key a `useRequestCache()` call
 * picks, scoped to a single {@linkcode renderToResponse} call and discarded once it resolves. */
export type RequestCache = Map<string, Promise<unknown>>

const RequestCacheContext = createContext<RequestCache | null>(null)

/**
 * Provides the request-scoped promise cache that {@linkcode useRequestCache} reads from — wraps
 * the whole tree passed to {@linkcode renderToResponse}. Not meant to be used directly by app
 * code; `renderToResponse` always supplies it.
 */
export function RequestCacheProvider(
  { cache, children }: { cache: RequestCache; children: ReactNode },
): ReactNode {
  return <RequestCacheContext.Provider value={cache}>{children}</RequestCacheContext.Provider>
}

/**
 * Reads (or starts, and caches) an async value for the current request, suspending the calling
 * component via `use()` until it resolves.
 *
 * This exists because React does not provide it: without a stable, request-scoped promise
 * identity, calling `fetcher()` fresh on every render would either re-fetch on each re-render or
 * throw `use()`'s "a component was suspended by an uncached promise" error. `useRequestCache`
 * fixes the promise's identity for the lifetime of one {@linkcode renderToResponse} call — the
 * same `key` always returns the exact same promise within that request, however many times a
 * component up the tree happens to re-render around it.
 *
 * @param key - Cache key, unique within this request (e.g. a loader's own name plus its params).
 * @param fetcher - Invoked at most once per request for a given `key`, only if nothing is cached
 * yet under it.
 * @returns The resolved value — never the promise itself; suspends the component until it settles.
 * @throws {InternalError} If called outside a tree rendered by `renderToResponse` (no
 * `RequestCacheProvider` ancestor) — this is a framework-usage bug, not a runtime condition an app
 * should handle.
 *
 * @example
 * ```tsx
 * function ProductView({ id }: { id: string }) {
 *   const product = useRequestCache(`product:${id}`, () => getProduct(id))
 *   return <h1>{product.name}</h1>
 * }
 * ```
 */
export function useRequestCache<T>(key: string, fetcher: () => Promise<T>): T {
  const cache = useContext(RequestCacheContext)
  if (!cache) {
    throw new InternalError(
      'useRequestCache() was called outside a tree rendered by renderToResponse()',
    )
  }

  let promise = cache.get(key) as Promise<T> | undefined
  if (!promise) {
    promise = fetcher()
    cache.set(key, promise)
  }

  return use(promise)
}
