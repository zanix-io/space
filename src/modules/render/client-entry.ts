import { resolve } from '@std/path'
import { InternalError } from '@zanix/errors'
import { isDevClientEnabled } from '../dev/dev-client-registry.ts'

/**
 * The default, auto-generated client entry's own synthetic module id — never a real file on disk.
 * Owned here, not by `client-entry-plugin.ts` (which imports it FROM this module instead): every
 * other bundler-facing constant this package's build layer needs (`getGlobalCssPaths`, ...) is
 * likewise owned by its own `render/` runtime module, with `modules/bundler/*.ts` files importing
 * it — never the other way around — so this follows the same established direction rather than
 * introducing a new one.
 *
 * Root-relative and `.ts`-suffixed on purpose: `dev-asset-handler.ts`'s own
 * `looksLikeDevAssetRequest` already recognizes any `.ts`-suffixed path as something to forward
 * into `SpaceDevEngine.transformClientAsset()`, so a real browser's request for this exact id
 * reaches `clientEntryPlugin`'s own `load` hook with zero changes needed there — the SAME plugin
 * pipeline every other request already runs through, not a separate interception layer (unlike
 * `dev-vite-hot-client.ts`'s own `/@vite/client` replacement, which genuinely needs one, since that
 * path is ALSO one Vite's own default asset handling would otherwise claim first — see that
 * module's own doc). In production, this same id is a valid Rollup `rollupOptions.input` key,
 * resolved by `clientEntryPlugin`'s own `resolveId` hook exactly the same way.
 */
export const CLIENT_ENTRY_VIRTUAL_ID = '/@zanix/client-entry.ts'

let clientEntryPath: string | undefined
let manifest: Record<string, string> | undefined
let productionKey: string | undefined

/**
 * Resolves `override` (a project's own `SpaceAppConfig.clientEntry`, if any) to its real,
 * realpath'd filesystem path relative to `root` — `undefined` when there's no override at all (the
 * auto-generated default, a synthetic virtual module with no file on disk). The one place this
 * resolution happens, reused by every consumer that needs a REAL file:
 *
 * - `build-client.ts`'s own `rollupOptions.input` — falls back to {@linkcode CLIENT_ENTRY_VIRTUAL_ID}
 *   when this resolves to `undefined` (every build needs SOME entry, real or synthetic).
 * - `deno-optimize-deps-alias.ts`'s own bare-specifier discovery walk — skips adding anything at
 *   all when this resolves to `undefined` (the synthetic default has no file to walk, and only ever
 *   imports `@zanix/space/client` itself, a first-party JSR module with no CJS-interop concern).
 * - {@linkcode loadClientEntryProductionKey} below — the runtime counterpart of the build side's own
 *   resolution, so both sides key `client-entry-manifest.json` by the exact same value.
 */
export async function resolveClientEntryFilePath(
  root: string,
  override: string | undefined,
): Promise<string | undefined> {
  return override === undefined ? undefined : await Deno.realPath(resolve(root, override))
}

/**
 * Hard-sets (or clears, via `undefined`) the declared client-entry override, discarding whatever
 * was there before — called by `defineSpaceApp({ clientEntry })`. Unlike `globalCss`'s own
 * `addGlobalCssPaths` (a genuinely composable list), a client entry has no real "multiple entries"
 * use case: a host overriding a base app's own entry point is a REPLACE, not an append, so this is
 * a plain last-wins setter, not an accumulator.
 */
export function setClientEntry(path: string | undefined): void {
  clientEntryPath = path
}

/** Test-only escape hatch, same reasoning as `css-manifest.ts`'s own `getGlobalCssPaths`. */
export function getClientEntry(): string | undefined {
  return clientEntryPath
}

/**
 * The specifier this build/dev session actually resolves its client entry around —
 * {@linkcode CLIENT_ENTRY_VIRTUAL_ID} (the zero-config default: `initClientEntry()`, auto-generated
 * by `client-entry-plugin.ts`) unless `defineSpaceApp({ clientEntry })` configured
 * a real override. `buildSpaceClient`'s own `rollupOptions.input` and `clientEntryPlugin`'s own
 * `generateBundle` correlation both resolve around this SAME value, so neither can ever disagree
 * with the other about which entry is actually active.
 */
export function resolveClientEntrySpecifier(): string {
  return clientEntryPath ?? CLIENT_ENTRY_VIRTUAL_ID
}

/** Test-only escape hatch — sets (or clears) the production manifest directly, without touching
 * the filesystem. Same reasoning as `css-manifest.ts`'s own `setCssManifest`. */
export function setClientEntryManifest(value: Record<string, string> | undefined): void {
  manifest = value
}

/**
 * Resolves and caches, once, the key {@linkcode resolveClientEntryUrl}'s production branch looks
 * up in the manifest — {@linkcode resolveClientEntryFilePath}'s own realpath'd result (the exact
 * value `build-client.ts`'s own `resolvedClientEntry` wrote the manifest keyed by), never the raw,
 * un-resolved override string {@linkcode resolveClientEntrySpecifier} returns for dev. Call once at
 * boot, alongside {@linkcode loadClientEntryManifest} — same convention, and the same reason: a
 * per-request `Deno.realPath` call would be wasted work for a value that can never change once this
 * app has booted.
 *
 * @param root - Project root, same meaning as {@linkcode resolveClientEntryFilePath}'s own `root` —
 * pass `Deno.cwd()` unless this app resolves paths against something else, matching the assumption
 * every other `clientBuildDir`-relative path in this app's own boot sequence already makes.
 */
export async function loadClientEntryProductionKey(root: string): Promise<void> {
  productionKey = await resolveClientEntryFilePath(root, clientEntryPath) ?? CLIENT_ENTRY_VIRTUAL_ID
}

/** Test-only escape hatch — sets (or clears) the cached production key directly, without touching
 * the filesystem. Same reasoning as {@linkcode setClientEntryManifest}. */
export function setClientEntryProductionKey(value: string | undefined): void {
  productionKey = value
}

/** The currently loaded manifest, or `undefined` if {@linkcode loadClientEntryManifest} was never
 * called — production only, same "was a real build's manifest loaded" signal `css-manifest.ts`'s
 * own `getCssManifest` provides for CSS. Read by `define-space-app.ts`'s own `assetsDir`-missing
 * warning (see that file's own doc for why). */
export function getClientEntryManifest(): Record<string, string> | undefined {
  return manifest
}

/**
 * Loads the manifest `clientEntryPlugin`'s own `generateBundle` hook writes during a production
 * client build, so a page's bootstrap script can resolve to its real, hashed build-output URL
 * instead of nothing at all. Same convention as `loadCssManifest`/`loadCometManifest` — call once,
 * before serving any requests. A missing file is not an error — the normal case in dev, where
 * {@linkcode resolveClientEntryUrl} never reads this manifest at all.
 *
 * @param path - Path to the manifest JSON file, as written by `clientEntryPlugin`.
 */
export async function loadClientEntryManifest(path: string): Promise<void> {
  try {
    manifest = JSON.parse(await Deno.readTextFile(path))
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return
    throw new InternalError(`Failed to load the client-entry manifest from "${path}".`, {
      cause: error,
      meta: { source: 'zanix', method: 'loadClientEntryManifest', path },
    })
  }
}

/**
 * The client entry URL a full-document response's `bootstrapModules` should point at — the one
 * accessor `render-page-react.tsx`/`render-page-preact.ts` actually call. Dev-aware, same
 * `isDevClientEnabled()` branch `resolveCssHrefs` already establishes:
 *
 * - **`znx space dev`**: {@linkcode resolveClientEntrySpecifier}'s own value is ALREADY a valid,
 *   root-relative dev URL by construction — either {@linkcode CLIENT_ENTRY_VIRTUAL_ID} itself (a
 *   synthetic root-relative path `clientEntryPlugin`'s own `load` hook answers directly) or an
 *   author's override path, root-relative-ified the same trivial way `dev-css-hrefs.ts`'s own
 *   `toDirectHref` does for a stylesheet path (minus its CSS-only `?direct` suffix — a plain
 *   bootstrap module needs none of that). No manifest, no hashing, no build step involved either
 *   way.
 * - **production**: looked up in the loaded manifest by {@linkcode loadClientEntryProductionKey}'s
 *   own cached, realpath'd key — never {@linkcode resolveClientEntrySpecifier}'s raw override
 *   string, which the manifest was never keyed by in the first place (only dev needs that literal
 *   value). `undefined` if no manifest was ever loaded (this app declares Comets but the client
 *   build never ran, or the manifest simply hasn't been loaded yet), or if
 *   {@linkcode loadClientEntryProductionKey} itself was never called (falls back to the raw
 *   specifier in that case, matching whatever a caller that skipped it would already expect).
 */
export function resolveClientEntryUrl(): string | undefined {
  if (isDevClientEnabled()) {
    const specifier = resolveClientEntrySpecifier()
    if (specifier === CLIENT_ENTRY_VIRTUAL_ID) return specifier
    const withoutLeadingDot = specifier.replace(/^\.\//, '')
    return withoutLeadingDot.startsWith('/') ? withoutLeadingDot : `/${withoutLeadingDot}`
  }
  return manifest?.[productionKey ?? resolveClientEntrySpecifier()]
}
