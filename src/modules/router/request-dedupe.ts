/**
 * The request-scoped dedup primitive behind `PageContext.dedupe` (`typings/page.ts`) — one plain
 * `Map`, keyed by whatever string a caller picks, created once per request by `toPageContext`
 * (`space-page-controller.tsx`) and shared by construction across every `loader` that request's
 * composition chain runs: the page's own AND every `layout.tsx` in it (see `LayoutProps.data`'s own
 * doc, same file, for how segment-level loaders share this same `ctx`).
 *
 * **Why this exists, and how it differs from `useRequestCache`.** Segment-level loaders made a real
 * duplicate-fetch case possible that could not exist before them: two INDEPENDENT loaders in the
 * same request — say, a page's own `loader` and its `dashboard/layout.tsx`'s own `loader` — each
 * wanting the same underlying data (`getCurrentUser()`), with no way to know about each other,
 * since they live in separate files with no shared scope of their own. `useRequestCache`
 * (`render/request-cache.tsx`) does NOT solve this: it dedupes fetches issued FROM INSIDE COMPONENT
 * RENDER, via React's `use()`/`Suspense` — a mechanism Preact core structurally cannot have, and
 * irrelevant here regardless, since a loader is a plain async function that runs BEFORE any
 * rendering starts, on EITHER renderer. This primitive dedupes across LOADERS, not across
 * components — renderer-neutral by construction, because nothing about it touches rendering at all.
 *
 * @module
 */

import type { PageContext } from 'typings/page.ts'

/** What {@linkcode createDedupeCache} returns — derived from `PageContext.dedupe`'s own type
 * (`typings/page.ts`), not redeclared by hand, so the two can never drift apart. */
export type DedupeFetch = PageContext['dedupe']

/**
 * Builds one request's own dedupe cache — a fresh, empty `Map` closed over by the function it
 * returns. Called once per request, never per loader: calling it twice would defeat the whole
 * point, since each call starts a brand new, empty cache with nothing shared between them.
 *
 * @returns A `dedupe(key, fetcher)` function: the first call for a given `key` invokes `fetcher()`
 * and caches its promise (resolved OR rejected — a rejection is cached too, same as any other
 * value, so every caller of that `key` sees the identical failure rather than each retrying it);
 * every later call for the same `key`, however many loaders make it, returns that SAME promise
 * without calling `fetcher()` again.
 */
export function createDedupeCache(): DedupeFetch {
  const cache = new Map<string, Promise<unknown>>()

  return function dedupe<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
    let promise = cache.get(key) as Promise<T> | undefined
    if (!promise) {
      promise = fetcher()
      cache.set(key, promise)
    }
    return promise
  }
}
