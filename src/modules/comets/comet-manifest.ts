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
    throw error
  }
}

/** Test-only escape hatch — sets (or clears, via `undefined`) the manifest directly, without
 * touching the filesystem. Not exported from this package's public entry points. */
export function setCometManifest(value: CometManifest | undefined): void {
  manifest = value
}

/**
 * Resolves a comet's real client-servable URL from its own source location.
 *
 * - **With a manifest loaded** (production, after `loadCometManifest`): looks up the source path
 *   in it, falling back to the raw value if that specific comet has no entry (a comet whose file
 *   never actually got built, e.g. a stale manifest — safer to degrade than to throw at request
 *   time over a build/deploy skew this function has no way to fix).
 * - **With no manifest loaded** (development): Vite's dev server already serves every project file
 *   at its own root-relative path, so `sourceUrl` (a `file://` URL) only needs its filesystem-root
 *   prefix stripped — no manifest, no hashing, no build step involved.
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

  const rootPath = normalizeSourceKey(
    devRoot.startsWith('file://') ? devRoot : new URL(`file://${devRoot}`).href,
  )
  return sourcePath.startsWith(rootPath) ? sourcePath.slice(rootPath.length) : sourceUrl
}
