import { createContext, use, useContext } from 'react'
import type { ReactNode } from 'react'
import { InternalError } from '@zanix/errors'
import { getActiveRenderer } from '../router/active-renderer.ts'

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
  return (
    <RequestCacheContext.Provider value={cache}>
      {children}
    </RequestCacheContext.Provider>
  )
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
 * **Deliberately React-only, evaluated and closed, not a pending Preact feature.** This function
 * exists to solve one specific problem: several components, anywhere in the tree, independently
 * wanting the same in-flight request without re-triggering it — a problem `use()`/`Suspense`
 * creates by letting a component suspend mid-render in the first place. Preact core has no
 * `use()`/`Suspense` — the same reason `load-routes.ts` rejects `loading.tsx` under
 * `--renderer=preact` — so no Preact
 * component can ever suspend — or do ANY async work — mid-render; every prop it receives must
 * already be a resolved, synchronous value by the time `preact-render-to-string` reaches it. That
 * removes the precondition for this problem to occur at all under Preact, not just the mechanism
 * to solve it: the one place a Preact page's data flows through is its own `loader` (invoked once,
 * before render ever starts — `SpacePageController`'s own `handleGet`), so combining or
 * deduplicating several data sources for a Preact page is ordinary application code the author
 * writes inside that `loader`, not something a Preact counterpart to this function could do any
 * better.
 *
 * @param key - Cache key, unique within this request (e.g. a loader's own name plus its params).
 * @param fetcher - Invoked at most once per request for a given `key`, only if nothing is cached
 * yet under it.
 * @returns The resolved value — never the promise itself; suspends the component until it settles.
 * @throws {InternalError} If called outside a tree rendered by `renderToResponse` (no
 * `RequestCacheProvider` ancestor) — this is a framework-usage bug, not a runtime condition an app
 * should handle. Also thrown, with a different message, when the active renderer is Preact (see
 * below) — Preact core has no `Suspense`/`use()` at all (confirmed by this package's own decision
 * spike), so there is no mechanism for this function to suspend the calling component with in the
 * first place.
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
  // Checked BEFORE `useContext` below, not after — `useContext` is a real React hook; calling it
  // during a Preact render (no React render in progress at all) doesn't fail with a message this
  // package controls, it fails with React's own generic "Invalid hook call"
  // (`TypeError: Cannot read properties of null (reading 'useContext')`, pointing at React's own
  // troubleshooting docs, not this framework's). This is the one deliberate,
  // isolated exception to keeping renderer checks out of shared code — `useRequestCache` is
  // inherently React-only by contract, not a capability
  // that could work for Preact with more effort, so this is a boundary check on that contract, not
  // a behavior branch inside otherwise-shared rendering logic (nothing else in this file, or
  // called from it, is renderer-aware).
  if (getActiveRenderer() === 'preact') {
    throw new InternalError(
      'useRequestCache() is not available under --renderer=preact: Preact core has no ' +
        'Suspense/use(), so there is no way to suspend this render for the requested data. ' +
        "Resolve it inside this page's loader and pass it down as a prop instead.",
      { code: 'SPACE_RENDER_REQUEST_CACHE_UNAVAILABLE_PREACT', meta: { key } },
    )
  }

  const cache = useContext(RequestCacheContext)
  if (!cache) {
    throw new InternalError(
      'useRequestCache() was called outside a tree rendered by renderToResponse()',
      { code: 'SPACE_RENDER_REQUEST_CACHE_OUTSIDE_TREE' },
    )
  }

  let promise = cache.get(key) as Promise<T> | undefined
  if (!promise) {
    promise = fetcher()
    cache.set(key, promise)
  }

  return use(promise)
}
