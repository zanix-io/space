import { InternalError } from '@zanix/errors'

/** Maps a comet's own resolved source file path (as `file://` normalizes to a plain path) to the
 * real URL its build output chunk was served/built at. Written by `cometPlugin` during the client
 * build; read back here at request time. */
export type CometManifest = Record<string, string>

let manifest: CometManifest | undefined

/** Normalizes a `file://` URL (or an already-plain path) to a plain filesystem path — the shared
 * key format between what `cometPlugin` writes (from Rollup's own module `id`, already a plain
 * path) and what `defineComet` looks up (from `import.meta.url`, a `file://` URL under Deno).
 * Exported (not just used internally) because `css-manifest.ts`'s own `getCometCssHrefs` keys a
 * comet's CSS scope by this EXACT same identity — reused rather than re-derived, so the two
 * manifests can never silently drift into two different key formats for "the same comet". */
export function normalizeSourceKey(sourceUrl: string): string {
  return sourceUrl.startsWith('file://') ? new URL(sourceUrl).pathname : sourceUrl
}

/**
 * A small, fast, non-cryptographic hash (FNV-1a, 32-bit, as 8 lowercase hex digits) of a comet's
 * own {@linkcode normalizeSourceKey} value — used by `define-comet.ts` as `COMET_ID_ATTR`'s
 * (`data-comet`) public HTML value instead of the raw absolute source path, which would otherwise
 * put the server's local filesystem layout (and, on a non-containerized deploy, its OS username)
 * into every page's rendered HTML — confirmed as a real disclosure, not theoretical, by directly
 * inspecting a real build's output. Not a security hash: collision resistance across an
 * adversarial input isn't the goal, only a stable, deterministic value for the same comet across
 * renders (the same property the raw path already had) — a real project's comet count is far too
 * small for an accidental collision to be a practical concern. Sync on purpose, since
 * `defineComet` computes this at render time, never behind an `await`.
 */
export function hashSourceKey(sourceKey: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < sourceKey.length; i++) {
    hash ^= sourceKey.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/**
 * Loads the manifest `cometPlugin` writes during a production client build (`comets-manifest.json`
 * in the client build's output directory), so `defineComet` can resolve each comet's real,
 * hashed client URL instead of the raw source location it only knows from `import.meta.url`.
 *
 * Call this once, before serving any requests — typically right after `activateApps()` in this
 * app's own `main.ts`, before `bootstrapServers()`. A missing file is not an error: it's the normal
 * case in development, where `defineComet` falls back to deriving a servable URL directly from the
 * source path instead (see `resolveCometModuleUrl`'s own doc).
 *
 * @param path - Path to the manifest JSON file, as written by `cometPlugin`.
 */
export async function loadCometManifest(path: string): Promise<void> {
  try {
    manifest = JSON.parse(await Deno.readTextFile(path))
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return
    // Boot-time-only (called once, before serving any requests) — never reaches an HTTP response,
    // so no `code`/`userMessage` here, same shape `@zanix/server`'s own `WebServerManager`'s
    // `readSslFile` already establishes for a boot-time file-read failure: still the shared
    // hierarchy (never a raw native error), just without the boundary-crossing metadata that only
    // matters once something actually reaches a request/response cycle.
    throw new InternalError(`Failed to load the comet manifest from "${path}".`, {
      cause: error,
      meta: { source: 'zanix', method: 'loadCometManifest', path },
    })
  }
}

/** Test-only escape hatch — sets (or clears, via `undefined`) the manifest directly, without
 * touching the filesystem. Not exported from this package's public entry points. */
export function setCometManifest(value: CometManifest | undefined): void {
  manifest = value
}

/** The currently loaded manifest, or `undefined` if {@linkcode loadCometManifest} was never
 * called — production only, same "was a real build's manifest loaded" signal `css-manifest.ts`'s
 * own {@linkcode getCssManifest} provides for CSS. Read by `define-space-app.ts`'s own
 * `assetsDir`-missing warning (see that file's own doc for why). */
export function getCometManifest(): CometManifest | undefined {
  return manifest
}

/** Maps a source file's own extension to the `DenoMediaType` string `@deno/vite-plugin`'s real
 * resolver (`dist/resolver.js`, `toDenoSpecifier`) tags a wrapped virtual module id with — see
 * {@linkcode toBrowserDenoSpecifier}'s own doc for why this is hand-derived here instead of
 * importing that type. `.tsx`/`.jsx` matter in practice: every ready-made Comet this package ships
 * (`SubmitGuard`, `FormDraftPersistence`, ...) is itself a `.tsx` file, and tagging it `TypeScript`
 * instead of `TSX` produces a specifier `@deno/vite-plugin` doesn't recognize as the same module it
 * already resolved, breaking the whole point of this function. Defaults to `JavaScript` for
 * anything else (`.js`/`.mjs`/`.cjs`, or no recognized extension at all) — the same default
 * `resolveDeno` itself falls back to (`resolved.loader ?? "JavaScript"`) when Deno's own loader
 * reports none. */
function denoLoaderFor(sourcePath: string): string {
  if (sourcePath.endsWith('.tsx')) return 'TSX'
  if (sourcePath.endsWith('.jsx')) return 'JSX'
  if (sourcePath.endsWith('.json')) return 'Json'
  if (sourcePath.endsWith('.ts')) return 'TypeScript'
  return 'JavaScript'
}

/** Vite's own stable, public convention for exposing a virtual/remote module id as a browser-
 * requestable URL — the browser-facing counterpart of `@deno/vite-plugin`'s own `toDenoSpecifier`
 * (`\0deno::<loader>::<id>::<resolved>#deno`, confirmed against that package's real
 * `dist/resolver.js` source, not reverse-engineered): `/@id/` prefix, with the leading `\0` byte
 * replaced by the literal string `__x00__` (a real byte is invalid in a URL) — the exact shape
 * `@deno/vite-plugin`'s own resolver already produces for a plain `import` of the same remote
 * module, and the exact shape `dev-engine.ts`'s own `unwrapViteId` already reverses on the way in.
 * `id`/`resolved` are the identical `sourcePath` here (this function only ever wraps an ALREADY
 * fully-resolved remote URL — there's no separate "original bare specifier" to preserve, unlike
 * `resolveDeno`'s own general case).
 *
 * Deliberately hand-written here, not imported from `@deno/vite-plugin/resolver` (already a real
 * dependency `dev-engine.ts` uses) or shared with that file's own `unwrapViteId`: THIS file is
 * reachable from a Comet's own client bundle (`comet-persist-transition.ts` imports
 * `hashSourceKey` from here — see `discoverComets`' own doc for why every Comet importing
 * `defineComet` puts this whole file in that bundle's own module graph), and both
 * `@deno/vite-plugin` and `dev-engine.ts` carry real, heavy `vite` value dependencies this file
 * must never reach. The format itself is three lines of string-templating — cheaper to duplicate
 * than to risk that leak for.
 */
function toBrowserDenoSpecifier(sourcePath: string): string {
  return `/@id/__x00__deno::${denoLoaderFor(sourcePath)}::${sourcePath}::${sourcePath}#deno`
}

/**
 * Resolves a comet's real client-servable URL from its own source location.
 *
 * - **With a manifest loaded** (production, after `loadCometManifest`): looks up the source path
 *   in it, falling back to the raw value if that specific comet has no entry (a comet whose file
 *   never actually got built, e.g. a stale manifest — safer to degrade than to throw at request
 *   time over a build/deploy skew this function has no way to fix).
 * - **With no manifest loaded** (development), three cases:
 *   - The common one — the source file lives INSIDE `devRoot` (an app's own Comet or `error.tsx`,
 *     always somewhere under its own project): Vite's dev server already serves every project file
 *     at its own root-relative path, so the filesystem-root prefix is simply stripped — no
 *     manifest, no hashing, no build step involved.
 *   - The source resolves to a remote `http://`/`https://` URL — every one of this package's own
 *     ready-made Comets (`SubmitGuard`, `FormDraftPersistence`, ...), used directly from
 *     `@zanix/space/comet/react`/`/preact` the way this package's own docs recommend, resolves this
 *     way for any consumer installing `@zanix/space` as a plain `jsr:` dependency (i.e. every
 *     consumer without a locally-linked/vendored checkout) — `import.meta.url`, evaluated
 *     server-side under Deno, is itself a real `https://jsr.io/...` specifier there, never a
 *     `file://` path. Vite's dev server has no filesystem path to serve this by at all — the
 *     browser-facing wrapped-virtual-module convention {@linkcode toBrowserDenoSpecifier} builds
 *     is what `@deno/vite-plugin`'s own resolver already recognizes for the identical module.
 *   - The file lives OUTSIDE `devRoot`, on the local filesystem — this package's own built-in
 *     `default-error-view.tsx`/`default-error-view-preact.ts` (`render-page-react.tsx`'s/
 *     `render-page-preact.ts`'s own "no error.tsx anywhere" fallback) being the one real case
 *     today: it lives inside `@zanix/space`'s OWN install location, never an app's `routesDir`.
 *     Vite's dev server has a real, documented answer for exactly this — its own
 *     `/@fs/<absolute-path>` convention for serving a file outside the project root — and
 *     `dev-asset-handler.ts`'s own `looksLikeDevAssetRequest` already recognizes that prefix.
 *
 * @param sourceUrl - The comet's own `import.meta.url`, as passed to `defineComet`.
 * @param devRoot - The Vite project root, used to derive the dev-mode fallback path. Defaults to
 * the current working directory, which is correct whenever the SSR process itself runs from the
 * project root (the common case for this framework's own `main.ts` convention).
 */
export function resolveCometModuleUrl(
  sourceUrl: string,
  devRoot: string = Deno.cwd(),
): string {
  const sourcePath = normalizeSourceKey(sourceUrl)

  if (manifest) return manifest[sourcePath] ?? sourceUrl

  if (sourcePath.startsWith('http://') || sourcePath.startsWith('https://')) {
    return toBrowserDenoSpecifier(sourcePath)
  }

  const rootPath = normalizeSourceKey(
    devRoot.startsWith('file://') ? devRoot : new URL(`file://${devRoot}`).href,
  )
  if (sourcePath.startsWith(rootPath)) return sourcePath.slice(rootPath.length)
  return `/@fs${sourcePath}`
}
