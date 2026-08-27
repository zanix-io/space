import type { Plugin } from 'vite'
import { build } from 'vite'
import deno from '@deno/vite-plugin'
import { relative, resolve } from '@std/path'
import type { PwaConfig } from 'typings/pwa.ts'
import { spacePlugin } from './space-plugin.ts'
import { cometPlugin } from './comet-plugin.ts'
import { cssPlugin, type CssPluginOptions } from './css-plugin.ts'
import { pwaPlugin } from './pwa-plugin.ts'
import type { AssetsOptimizeOptions } from './assets-plugin-types.ts'
import type { MediaOptimizeOptions } from './media-plugin-types.ts'
import { ASSETS_PLUGIN_SPECIFIER, MEDIA_PLUGIN_SPECIFIER } from './build-plugin-specifiers.ts'
import { createAssetManifestRegistry } from 'modules/assets/asset-manifest-registry.ts'
import { resolvePwaPluginOptions } from './resolve-pwa-plugin-options.ts'
import { discoverComets } from './discover-comets.ts'
import { collectPageStyles, discoverPages } from './discover-pages.ts'
import { getGlobalCssPaths, type StylesheetRef } from 'modules/render/css-manifest.ts'
import { normalizeSourceKey } from 'modules/comets/comet-manifest.ts'
import {
  getAssetsDirConfig,
  getMediaConfig,
  getOptimizeConfig,
} from 'modules/assets/asset-registry.ts'
import { getActiveRenderer, type RendererKind } from 'modules/router/active-renderer.ts'
import { getValidationConfig } from 'modules/validation/config-registry.ts'
import type { Diagnostic, ValidationConfig } from 'modules/validation/mod.ts'
import { validateBuild } from './validate-build.ts'

// `Plugin` is not re-exported here — same accepted `deno doc --lint` finding as `spacePlugin`'s
// own doc comment.

/** Options for {@linkcode buildSpaceClient}. */
export interface BuildSpaceClientOptions {
  /** Project root — same meaning as `SpaceDevEngineOptions.root`. */
  root: string
  /** Where the built client assets are written, relative to `root`. @default 'dist/client' */
  outDir?: string
  /**
   * This app's own declared global stylesheet source paths — included as real build entries
   * alongside every discovered comet, so `cssPlugin` actually emits them: a plain `.css` file
   * nothing else imports would otherwise never reach the output bundle at all, since Rollup only
   * emits a CSS asset for a file that's actually reachable from some real entry.
   *
   * Defaults to `getGlobalCssPaths()` — the SAME process-wide, already-COMPOSED list
   * `defineSpaceApp({ globalCss })` populates (via `addGlobalCssPaths`, appending across every
   * `defineSpaceApp()` call in the process — see that function's own doc). A build script that
   * already imports the app's `space.app.ts` (so `defineSpaceApp()` actually runs) before calling
   * `buildSpaceClient()` gets the base app's own `globalCss` AND a host's own composed-on-top
   * stylesheets included automatically, without re-declaring either. Pass an explicit array instead
   * to build against a different list on purpose (e.g. a build script that never imports
   * `space.app.ts` at all). Each entry is a `StylesheetRef` — a plain string, or `{href, media}`
   * to carry a `media` attribute through to the built `css-manifest.json`'s own `global` scope.
   */
  globalCss?: StylesheetRef[]
  /**
   * Where to look for pages' own `static styles` — passed UNCHANGED to `scanPageFiles`
   * (see `discover-pages.ts`'s own doc for why this is deliberately NOT resolved against
   * `root` the way `globalCss`/`assetsDir` are: the resulting page identity must come out in
   * EXACTLY the same shape `loadRoutes()` itself will produce for the SAME value at real server
   * startup). @default './routes' — the same default `loadRoutes()` itself uses.
   */
  routesDir?: string | string[]
  /** Forwarded to {@linkcode cssPlugin} unchanged. */
  css?: CssPluginOptions
  /**
   * The SAME author-facing `PwaConfig` `defineSpaceApp({ pwa })` takes — resolved internally via
   * {@linkcode resolvePwaPluginOptions} into whatever `pwaPlugin` itself needs. An author never
   * configures `pwaPlugin` separately; omitted entirely (no PWA build step at all) when not
   * given, matching `SpaceAppConfig.pwa`'s own optionality (`pwa: false`/undefined).
   */
  pwa?: PwaConfig
  /**
   * The SAME `assetsDir` `defineSpaceApp({ assetsDir })` takes — hashed via `assetsPlugin`, whose
   * own `assets-manifest.json` `loadAssetsManifest()`/`resolveAssetHref()` read back at request
   * time. Defaults to `getAssetsDirConfig()` — the SAME eager-registry pattern `globalCss`/
   * `renderer` above already establish (`defineSpaceApp()` sets it eagerly, same timing as those),
   * so a build script that already imports the app's `space.app.ts` gets it automatically. Omitted
   * entirely (no directory ever configured) skips `assetsPlugin` altogether — an app with no
   * `assetsDir` at all never pays for this, at zero cost, same convention every other opt-in field
   * here already follows.
   */
  assetsDir?: string | string[]
  /**
   * The SAME `optimize` `defineSpaceApp({ optimize })` takes — forwarded to `assetsPlugin({
   * assetsDir, optimize })` as its own `optimize` option, unchanged. Defaults to
   * `getOptimizeConfig()` — the same eager-registry pattern `assetsDir` above already
   * establishes, so a build script that already imports the app's `space.app.ts` gets it
   * automatically. Only ever takes effect when `assetsDir` also resolves to something (see
   * `AssetsPluginOptions.optimize`'s own doc) — declaring `optimize` alone, with no `assetsDir`,
   * does nothing, exactly like `assetsPlugin` itself already behaves when called directly.
   */
  optimize?: AssetsOptimizeOptions
  /**
   * The SAME `media` `defineSpaceApp({ media })` takes — forwarded to `mediaPlugin({ assetsDir,
   * optimize: media, manifestRegistry })`, sharing the SAME manifest registry `assetsPlugin`
   * above does (see `AssetManifestRegistry`'s own doc). Defaults to `getMediaConfig()` — same
   * eager-registry pattern `optimize` above already establishes. Only ever takes effect when
   * `assetsDir` also resolves to something — declaring `media` alone does nothing.
   */
  media?: MediaOptimizeOptions
  /** Extra Vite plugins, composed after this function's own. */
  plugins?: Plugin[]
  /** Forwarded to Vite's own `build.minify`. @default true */
  minify?: boolean
  /**
   * Document validation policy. Defaults to `getValidationConfig()` — the SAME eagerly-set registry
   * `defineSpaceApp({ validation })` populates, mirroring how `globalCss`/`renderer`/`assetsDir`
   * already resolve. `false` skips validation entirely.
   *
   * A build script that already imports the app's `space.app.ts` gets the project's own policy
   * without passing anything.
   */
  validation?: ValidationConfig | false
  /**
   * Sitemap locations, when the app declares its sitemap as a literal array — enables the
   * sitemap cross-checks. Omitted (including for a function-sourced sitemap) simply skips them, and
   * the skip is reported rather than left silent. See `validateBuild`'s own doc.
   */
  sitemapLocations?: string[]
  /**
   * Which renderer to build the client bundle for — forwarded to {@linkcode spacePlugin}
   * unchanged. Defaults to `getActiveRenderer()` — the SAME eagerly-set flag
   * `defineSpaceApp({ renderer })` populates (see that function's own doc), mirroring exactly how
   * `globalCss` above already defaults to `getGlobalCssPaths()`. A build script that already
   * imports the app's `space.app.ts` before calling this function gets the right renderer
   * automatically, without passing this explicitly. Pass an explicit value instead to build
   * against a different renderer on purpose (e.g. a build script that never imports
   * `space.app.ts` at all).
   */
  renderer?: RendererKind
}

/** What {@linkcode buildSpaceClient} returns. */
export interface BuildSpaceClientResult {
  /** Every comet file this build discovered and built as its own real entry. */
  comets: string[]
  /** The resolved, absolute output directory every built asset was written under. */
  outDir: string
  /**
   * Document validation findings, most severe first. Empty when validation was disabled.
   *
   * Returned rather than printed: this function has no opinion about presentation, and a caller
   * (`zanix space build`, a custom script, a test) decides how to report and whether an `error`
   * should fail the run. `hasBlockingDiagnostics` answers the second question.
   */
  diagnostics: Diagnostic[]
  /** Checks that could not run, and why — see `ValidateBuildResult.skipped`. A validator that
   * silently skips work reads exactly like one that found nothing wrong. */
  validationSkipped: string[]
}

/** Derives a stable, collision-resistant Rollup entry name from an absolute file path — its path
 * relative to `root`, extension stripped, separators flattened to `-`, every other character
 * outside `[a-zA-Z0-9_-]` flattened to `_`. Two comets sharing a bare `basename` (e.g.
 * `a/counter.tsx` and `b/counter.tsx`) would otherwise silently collide in Rollup's own `input`
 * map (the later one winning, the earlier one dropped from the build entirely) — confirmed
 * empirically before relying on this shape instead of a bare basename.
 *
 * The final sanitize pass is not decorative: Vite/Rollup themselves sanitize a chunk's
 * OWN `name` for filename-safety internally (e.g. a dynamic-route folder's `[id]` becomes `_id_`
 * in the real built asset's own filename) — a page under such a folder is the first real case that
 * ever exercises this, since comet/`globalCss` paths rarely contain bracket characters. Confirmed
 * empirically as a REAL bug, not a hypothetical: without this, `toEntryName` computed
 * `routes-products-[id]-product` (brackets intact) for BOTH the `input` key and the later
 * `chunk.name` lookup in `cssPlugin`, but Rollup's own internal `chunk.name` for that SAME entry
 * came back sanitized (`routes-products-_id_-product`) — a silent mismatch that made
 * `cssPlugin`'s correlation loop never find the chunk, dropping that page's CSS into the flat
 * `global` fallback sweep instead of its own scoped `pages` entry. Matching Rollup's own
 * sanitization here (not just avoiding slashes) is what keeps `toEntryName`'s OWN output and
 * Rollup's internal `chunk.name` for the SAME entry always identical, for any file path. */
function toEntryName(root: string, filePath: string): string {
  return relative(root, filePath)
    .replace(/\.[^./]+$/, '')
    .replace(/[\\/]/g, '-')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
}

/**
 * Builds this app's real, production CLIENT bundle — comets (each its own hashed chunk, selective
 * hydration's whole point), CSS (Tailwind/CSS Modules/vanilla-extract via `cssPlugin`), and PWA
 * icons/service worker (via `pwaPlugin`, only when `options.pwa` is given). Writes
 * `comets-manifest.json`/`css-manifest.json` into `outDir` — `loadCometManifest`/`loadCssManifest`
 * read them back once at server startup (see their own docs).
 *
 * Deliberately never builds the SSR/server side — production SSR keeps running directly against
 * source via plain `deno run` (Deno executes `.tsx` natively; no bundle is needed for that to
 * work), the same way `zanix space dev` already does, just without HMR. `loadRoutes()`'s own page
 * discovery (`scanPageFiles`, a real filesystem walk, and a per-file dynamic `import()` whose path
 * argument is computed at runtime, not a static literal) is intentionally left untouched here —
 * bundling it would need statically-analyzable imports, a real routing design change this function
 * does not make. Left open deliberately for a future `--bundle-server` mode, should a concrete need
 * (serverless/edge cold-starts, single-artifact distribution, ...) ever justify the added
 * complexity of a second, SSR-side module pipeline — not built ahead of that need.
 *
 * Every comet is discovered via {@linkcode discoverComets} (a content scan for the `'use comet'`
 * directive, not a folder convention) and handed to Vite as a real `rollupOptions.input` entry —
 * `cometPlugin` is still included (for its own `comets-manifest.json` write), but told about these
 * via `knownEntryPaths` so it never force-emits a second, duplicate chunk for a file that's
 * already a real entry (confirmed empirically to happen otherwise — see `CometPluginOptions`'s own
 * doc).
 *
 * @param options - See {@linkcode BuildSpaceClientOptions}.
 * @returns See {@linkcode BuildSpaceClientResult}.
 */
export async function buildSpaceClient(
  options: BuildSpaceClientOptions,
): Promise<BuildSpaceClientResult> {
  const {
    root,
    outDir = 'dist/client',
    globalCss = getGlobalCssPaths() ?? [],
    routesDir = './routes',
    css,
    pwa,
    assetsDir = getAssetsDirConfig(),
    optimize = getOptimizeConfig(),
    media = getMediaConfig(),
    plugins = [],
    minify = true,
    renderer = getActiveRenderer(),
    validation = getValidationConfig(),
    sitemapLocations,
  } = options

  const comets = await discoverComets(root)
  const resolvedOutDir = resolve(root, outDir)

  // `discoverComets` (and any `globalCss` entry, realpath'd the same way below) return real,
  // symlink-resolved paths — `root` itself only if the caller already resolved it. Mixing an
  // unresolved base with an already-resolved target breaks `toEntryName`'s `relative()` call on a
  // filesystem where a temp dir's own path is itself a symlink (macOS's `/tmp`→`/private/tmp`,
  // confirmed empirically to otherwise turn a plain `counter.tsx` entry name into a long,
  // Rollup-rejected `../../../private/var/...` traversal instead).
  const realRoot = await Deno.realPath(root)

  const input: Record<string, string> = {}
  // `entryName -> comet's own source key` — lets `cssPlugin` correlate each comet's build OUTPUT
  // chunk (found by matching `chunk.name` against this same entry name) back to the SAME identity
  // `comets-manifest.json`/`defineComet` already key on, so a comet's own CSS lands under the
  // right key in `css-manifest.json`'s `comets` scope — never guessed, never re-derived twice.
  const cometEntries: Record<string, string> = {}
  for (const comet of comets) {
    const entryName = toEntryName(realRoot, comet)
    input[entryName] = comet
    cometEntries[entryName] = normalizeSourceKey(comet)
  }
  const resolvedGlobalCss = await Promise.all(
    globalCss.map(async (stylesheet) => {
      const href = typeof stylesheet === 'string' ? stylesheet : stylesheet.href
      const media = typeof stylesheet === 'string' ? undefined : stylesheet.media
      return { resolved: await Deno.realPath(resolve(root, href)), media }
    }),
  )
  // `entryName -> media` for every declared `globalCss` entry, in DECLARATION order — lets
  // `cssPlugin` build `css-manifest.json`'s own `global` scope by walking known entries instead of
  // an unordered `Object.values(bundle)` sweep (the real, confirmed manifest-order bug this fixes
  // — see `css-plugin.ts`'s own doc), and lets a `{href, media}` entry's `media` actually reach the
  // manifest at all.
  const globalEntries: Array<{ entryName: string; media?: string }> = []
  for (const { resolved, media } of resolvedGlobalCss) {
    const entryName = toEntryName(realRoot, resolved)
    input[entryName] = resolved
    globalEntries.push({ entryName, media })
  }

  // `pageFilePath -> [{entryName, media}]`, in DECLARATION order per page — same entry-correlation
  // technique as `globalEntries` above, just grouped by the page each style belongs to instead of
  // flattened into one list, since a page's own CSS must stay scoped to that page (never folded
  // into `global` — see `discoverPages`'s own doc for the full identity/side-effect reasoning).
  const pageEntries: Record<string, Array<{ entryName: string; media?: string }>> = {}
  // ONE pass over every page, shared by CSS entry construction here and by document validation
  // below — see `discoverPages`'s own doc: importing each page module once serves both `styles`
  // and `head`/`redirect`, instead of a separate scan+import per concern.
  const discoveredPages = await discoverPages(routesDir)

  // Validated from the SAME discovery result the CSS entries below are built from — one pass, one
  // view of the project. Run before Vite so a document problem is reported even when the bundle
  // would go on to fail for an unrelated reason.
  const validationResult = validation === false
    ? { diagnostics: [] as Diagnostic[], skipped: [] as string[] }
    : await validateBuild({
      pages: discoveredPages,
      routesDir,
      pwa,
      sitemapLocations,
      config: validation,
    })
  for (const { pageFilePath, resolvedCssPath, media } of collectPageStyles(discoveredPages)) {
    const entryName = toEntryName(realRoot, resolvedCssPath)
    input[entryName] = resolvedCssPath
    ;(pageEntries[pageFilePath] ??= []).push({ entryName, media })
  }

  // Zero comets, zero declared global CSS, no `pwa`, and no `assetsDir` configured is a valid (if
  // unusual) app state — a page whose entire UI renders server-side with nothing client-facing at
  // all — not an error. Confirmed empirically: Rollup itself throws `INVALID_OPTION` for an empty
  // `input`, so this is a real guard, not defensive filler for a case that can't happen.
  if (Object.keys(input).length === 0 && !pwa && !assetsDir) {
    return {
      comets,
      outDir: resolvedOutDir,
      diagnostics: validationResult.diagnostics,
      validationSkipped: validationResult.skipped,
    }
  }

  // `pwaPlugin`/`assetsPlugin`'s own asset generation happens in `generateBundle`, a hook Rollup
  // only ever runs as part of a real build — it needs SOME entry to resolve a chunk graph from at
  // all, even though neither plugin itself cares what that entry is. Confirmed empirically: a
  // `pwa`-only app (no comets, no globalCss) hit the exact same `INVALID_OPTION` error above
  // without this; the same applies to an `assetsDir`-only app. A tiny virtual, empty module (never
  // touching the real filesystem) is enough — its own output is negligible and irrelevant; only
  // `pwaPlugin`/`assetsPlugin`'s own emitted assets matter.
  const syntheticEntryId = '\0zanix-space-empty-entry'
  if (Object.keys(input).length === 0) input['empty'] = syntheticEntryId

  // Created unconditionally (cheap — just a `Map`) so `assetsPlugin`/a future `mediaPlugin` always
  // share the exact same instance below, regardless of which one(s) actually end up in the plugins
  // array — see `AssetManifestRegistry`'s own doc for why this must be one shared instance, never
  // a process-wide singleton.
  const manifestRegistry = createAssetManifestRegistry()

  // Lazy, gated behind the same `assetsDir` check the plugins array below already applies —
  // `assets-plugin.ts`/`media-plugin.ts` both reach `@zanix/utils`'s own `WorkerManager` (via
  // `@zanix/logger`), whose real `new Worker(new URL(...))` pattern Vite's own
  // `worker-import-meta-url` plugin statically detects the moment either file is merely resolved,
  // and tries to bundle as its own nested sub-build — a real, confirmed source of build failures
  // (`UNLOADABLE_DEPENDENCY`/`PARSE_ERROR`/`UNRESOLVED_ENTRY` inside that nested build,
  // `worker: { plugins: () => [] }` below notwithstanding). A plain app with no `assetsDir`
  // configured needs neither plugin at all, so resolving them here, only once `assetsDir` is real,
  // keeps that app's own build out of this risk entirely.
  const assetsPlugins = assetsDir
    ? (await import(ASSETS_PLUGIN_SPECIFIER)).assetsPlugin({
      assetsDir,
      optimize,
      manifestRegistry,
    })
    : []
  const mediaPlugins = assetsDir
    ? (await import(MEDIA_PLUGIN_SPECIFIER)).mediaPlugin({
      assetsDir,
      optimize: media,
      manifestRegistry,
    })
    : []

  await build({
    root,
    configFile: false,
    // An empty worker plugin array keeps `deno()`'s own self-resolution out of the nested worker
    // sub-build Vite spins up for `?worker`/`?sharedworker` imports — without this, that
    // sub-build hangs resolving `picomatch` inside `@zanix/utils`'s own worker (see
    // `cjs-interop.ts`). `worker` is a top-level `UserConfig` property, a sibling of `build`, not
    // nested inside `BuildEnvironmentOptions`.
    worker: { plugins: () => [] },
    build: {
      write: true,
      outDir: resolvedOutDir,
      emptyOutDir: true,
      minify,
      rollupOptions: {
        input,
        // Vite's own default (`false`, tuned for a normal app entry whose exports nothing reads —
        // a `<script>` tag has no use for them) silently strips an entry's own top-level exports
        // entirely — confirmed empirically: a comet's `export default function Counter() {...}`
        // built to a literal empty string with the default. A comet's default export is NOT
        // decorative here — client-side hydration dynamically imports each comet's own built URL
        // and reads `.default` off it (`hydrate-comets.ts`), so losing it would silently break
        // every comet's hydration in production while dev (never bundled) kept working, exactly
        // the kind of gap that's invisible until a real production build is actually exercised.
        preserveEntrySignatures: 'exports-only',
      },
    },
    plugins: [
      deno(),
      ...spacePlugin({ renderer }),
      cometPlugin({ knownEntryPaths: comets }),
      ...cssPlugin({ ...css, cometEntries, globalEntries, pageEntries }),
      ...(pwa ? [pwaPlugin(resolvePwaPluginOptions(pwa, root))] : []),
      // An explicit, shared `manifestRegistry` — never either plugin's own internal fallback one —
      // since this is exactly the "composing multiple producers into one build" case
      // `AssetManifestRegistry`'s own doc describes: `assetsPlugin` (images/SVG) and `mediaPlugin`
      // (video/thumbnails) both contribute to the SAME `assets-manifest.json`, neither one ever
      // knowing the other exists. The manifest plugin itself is included exactly once, after every
      // producer, gated the same way each producer's own inclusion already is — no producer, no
      // manifest file, unchanged.
      ...assetsPlugins,
      ...mediaPlugins,
      ...(assetsDir ? [manifestRegistry.createManifestPlugin()] : []),
      {
        name: 'zanix-space-empty-entry',
        resolveId: (id) => id === syntheticEntryId ? id : null,
        load: (id) => id === syntheticEntryId ? 'export {}' : null,
      },
      ...plugins,
    ],
  })

  return {
    comets,
    outDir: resolvedOutDir,
    diagnostics: validationResult.diagnostics,
    validationSkipped: validationResult.skipped,
  }
}
