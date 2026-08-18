/**
 * Computes a weak content hash for `SpacePageController.cacheControl` — hashed from a page's
 * already-resolved `loader` data, never from the rendered HTML itself. The loader's data is
 * available before rendering even starts, so hashing it (instead of the streamed response body)
 * is what lets automatic ETags coexist with true streaming SSR: hashing the HTML would require
 * buffering the entire stream first, defeating the point of streaming. This trades a rare edge
 * case (two different renders from identical loader data, if `component` also reads state outside
 * its own props) for zero streaming impact — an accepted, documented trade-off.
 *
 * @param data - The value `loader` resolved to (or `undefined`, for a page with no loader).
 * @param extra - Additional hash material folded in alongside `data`, when the caller knows
 * something OUTSIDE `loader`'s own return value can also change the rendered output. The one real
 * case today: `SpacePageController.handleGet` passes this page's own `population` whenever
 * `defineSpaceApp({ theme: { resolve } })` is configured — `theme.resolve` can change the rendered
 * `<style>` block by `population` alone, without that ever showing up in `loader`'s own data, which
 * would otherwise let two different populations collide on the exact same ETag (and a stale `304`
 * serving one population's resolved theme to another). Deliberately narrow: this closes ONLY that
 * same-origin ETag/revalidation collision — it says nothing about, and does not attempt to fix, a
 * SHARED cache (CDN/proxy) potentially serving one population's cached response to another before
 * ever revalidating at all; that partitioning question is a separate, already-documented
 * architectural boundary (see `populationGuard`'s own doc) and stays explicitly out of scope here.
 * Omit for the exact same hashing behavior this function has always had.
 * @returns A quoted ETag value (e.g. `"3f2a…"`), suitable for the `ETag` header as-is.
 */
export async function computeEtag(data: unknown, extra?: unknown): Promise<string> {
  const json = extra === undefined
    ? JSON.stringify(data) ?? 'null'
    : JSON.stringify([data, extra]) ?? 'null'
  const bytes = new TextEncoder().encode(json)
  const digest = await crypto.subtle.digest('SHA-1', bytes)
  const hex = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
  return `"${hex}"`
}
