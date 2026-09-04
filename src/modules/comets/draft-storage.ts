/**
 * The `sessionStorage`/`localStorage` read/write/namespacing plumbing shared by every comet
 * primitive that persists small, client-only state across a refresh or navigation —
 * `form-draft-persistence.ts` (a form's own fields) and `scroll-restoration.ts` (a page or
 * container's scroll position) today. Kept as one shared module so the fail-soft try/catch
 * discipline and the storage-key namespace can't drift out of sync between them.
 *
 * @module
 */

/** Storage backend state is persisted to. `'session'` is scoped to the current tab's session
 * lifetime; `'local'` survives a browser restart — an explicit, visible opt-in for state a
 * consumer genuinely wants to resume tomorrow, the same "safe-by-default, opt-out is one visible
 * field" shape this framework already applies to its CSP nonce default. */
export type DraftStorageKind = 'session' | 'local'

/** How long to wait after the last change before persisting — the default debounce every comet
 * primitive in this module family uses unless a caller overrides it. */
export const DEFAULT_DRAFT_DEBOUNCE_MS = 500

/** Namespaces every key this module writes under one fixed internal prefix, so an author-chosen
 * key (`'draft'`, say) can never collide with an unrelated key some other script on the same page
 * writes to the same storage object. */
const STORAGE_PREFIX = 'zn-space:'

/** Prefixes a caller-chosen key with this module's own namespace. */
export function namespacedStorageKey(key: string): string {
  return `${STORAGE_PREFIX}${key}`
}

/** Resolves the real `Storage` object for a given {@linkcode DraftStorageKind}, defaulting to
 * `'session'`. `undefined` if the backend itself isn't reachable at all (a storage object can
 * throw just by being READ under some private-browsing/quota policies) — every caller treats that
 * as "nothing to do here" rather than throwing further. */
export function resolveStorageBackend(kind: DraftStorageKind | undefined): Storage | undefined {
  try {
    return kind === 'local' ? globalThis.localStorage : globalThis.sessionStorage
  } catch {
    return undefined
  }
}

/** Parses whatever was previously written under `key` via {@linkcode writeToStorage} — `unknown`
 * on purpose: each caller shape-checks the result against what IT expects to have written there,
 * so no shape is assumed here. */
export function readFromStorage(backend: Storage, key: string): unknown {
  try {
    const raw = backend.getItem(key)
    return raw ? JSON.parse(raw) : undefined
  } catch {
    return undefined
  }
}

/** Serializes `data` as JSON under `key` — fails soft (a full/disabled storage object never
 * breaks whatever it's backing) rather than throwing. */
export function writeToStorage(backend: Storage, key: string, data: unknown): void {
  try {
    backend.setItem(key, JSON.stringify(data))
  } catch {
    // Fail soft — a full/disabled storage object never breaks whatever it's backing.
  }
}

/** Removes whatever was written under `key`, if anything — a no-op, not a throw, if there's
 * nothing there or the backend itself rejects the call. */
export function clearFromStorage(backend: Storage, key: string): void {
  try {
    backend.removeItem(key)
  } catch {
    // Nothing to clean up if this throws.
  }
}
