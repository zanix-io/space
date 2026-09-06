import { hydrateComets } from './hydrate-comets-preact.ts'
import { hydrateErrorBoundaries } from './hydrate-error-boundaries-preact.ts'
import { initOrbit } from './orbit.ts'
import type { PrefetchOptions } from './prefetch.ts'

/**
 * Preact-core counterpart to `client-entry-init.ts`'s own `initClientEntry` — identical body and
 * contract, differing only in which renderer-specific `hydrateComets`/`hydrateErrorBoundaries` it
 * imports (`orbit.ts`/`prefetch.ts` are already renderer-agnostic, same as the React version uses).
 * See that file's own doc for the full rationale.
 *
 * @param options - See `initClientEntry`'s own doc.
 */
export function initClientEntry(options: { prefetch?: PrefetchOptions | false } = {}): void {
  hydrateComets()
  hydrateErrorBoundaries()
  initOrbit(options)
}
