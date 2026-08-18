/**
 * Process-wide singleton holding the configured `messagesDir` — set exactly once, EAGERLY inside
 * `defineSpaceApp()` itself (same timing as `assetsDir`'s own path via `setAssetsDirConfig`, NOT
 * inside `setup()`). `undefined` means this app never declared `messagesDir` at all — the feature
 * is simply off, mirroring `asset-registry.ts`'s own `resolvedAssets` distinction between "never
 * opted in" and "opted in, nothing found."
 *
 * The eager timing matters for the same reason it does for `assetsDir`'s own path: `zanix space
 * build` imports `space.app.ts` to learn what a project declared, but never calls
 * `activateApps()` (so `setup()` never runs there) — a value only readable from inside `setup()`
 * would be invisible to `getMessagesDir()`, which is exactly what `@zanix/cli`'s own
 * `writeCompiledMessagesTree` needs before it can compile anything.
 *
 * This is ONLY about when the path STRING gets registered. Unlike `assetsDir` (eagerly SCANNED
 * into a `Map`, because it serves arbitrary request paths), resolving what's actually inside a
 * `messagesDir` stays exactly as lazy as before — per `(lang, population)` key, done by
 * {@linkcode loadMessages} on first access. Eagerly walking every language/population file up
 * front would do real filesystem work for languages a given process might never actually serve a
 * request for.
 *
 * @module
 */
let messagesDir: string | string[] | undefined

/** Set once, eagerly, by `defineSpaceApp()` itself — never called directly by application code. */
export function setMessagesDir(dirs: string | string[]): void {
  messagesDir = dirs
}

/** Test-only escape hatch — mirrors `resetResolvedAssets`'s own reasoning: an exact reset, for
 * test cleanup. Not exported from this package's public entry points. */
export function resetMessagesDir(): void {
  messagesDir = undefined
}

/** The currently configured `messagesDir`, or `undefined` if this app never declared it. Public —
 * `zanix space build`/`dev` read this back the same way they already do `getGlobalCssPaths`/
 * `getPwaConfig`, to locate the directory without either command knowing anything about what
 * happens to it (compiling ICU, or not, is entirely `@zanix/cli`'s own concern). */
export function getMessagesDir(): string | string[] | undefined {
  return messagesDir
}
