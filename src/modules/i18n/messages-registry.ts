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

/**
 * The catalog folder name (`{messagesDir}/{lang}/...`) an app with `messagesDir` but no real
 * language routing at all should use for its ONE implicit locale — never a real language code like
 * `'en'`, which would falsely imply the catalog is specifically English rather than "whatever this
 * app's only content variant happens to be." `loadMessages` itself never reads this constant (it
 * has no opinion on what `lang` means — any string is a valid catalog folder name to it); it exists
 * purely so every CALLER resolving a single-locale app's implicit catalog — `@zanix/cli`'s own
 * `--template population` (no `[lang]` routing) and this package's own `error.tsx`/`not-found.tsx`
 * fallback (`composeSegments`/`not-found-handler.ts`, when a segment/request has no real `lang` to
 * read) — agrees on the same folder name, instead of each independently hardcoding `'en'` and
 * silently drifting apart the moment one of them changes.
 */
export const DEFAULT_IMPLICIT_LANG = 'default'

/** Mirrors `SpaceAppConfig.clientBuildDir`'s own value — set eagerly, alongside `messagesDir`
 * itself, by `defineSpaceApp()` (see `define-space-app.ts`'s own comment at that call site for why
 * this is a plain copy rather than a shared registry: `clientBuildDir`'s own consumption inside
 * `setup()` is a separate, established code path this deliberately doesn't touch). A SEPARATE
 * module-level value from `clientBuildDir` itself, not a re-export of it — kept local to this
 * module so `loadMessages()`'s own resolution logic (`load-messages.ts`) never needs to import
 * anything client-build-specific. */
let messagesBuildDir: string | undefined

/** Set once, eagerly, by `defineSpaceApp()` itself — never called directly by application code. */
export function setMessagesBuildDir(dir: string): void {
  messagesBuildDir = dir
}

/** Test-only escape hatch — mirrors `resetMessagesDir`'s own reasoning. Not exported from this
 * package's public entry points. */
export function resetMessagesBuildDir(): void {
  messagesBuildDir = undefined
}

/** Where `zanix space build` compiled this app's `messagesDir` catalogs to (mirrors
 * `clientBuildDir`), or `undefined` if this app never declared `clientBuildDir`. Read by
 * `loadMessages()`'s own `resolve()` to decide whether to read compiled output instead of live
 * source — see that function's own doc for the exact `!isDevClientEnabled()` gating, identical to
 * `clientBuildDir`'s own dev-skip condition. */
export function getMessagesBuildDir(): string | undefined {
  return messagesBuildDir
}
