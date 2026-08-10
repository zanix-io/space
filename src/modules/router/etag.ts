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
 * @returns A quoted ETag value (e.g. `"3f2a…"`), suitable for the `ETag` header as-is.
 */
export async function computeEtag(data: unknown): Promise<string> {
  const json = JSON.stringify(data) ?? 'null'
  const bytes = new TextEncoder().encode(json)
  const digest = await crypto.subtle.digest('SHA-1', bytes)
  const hex = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
  return `"${hex}"`
}
