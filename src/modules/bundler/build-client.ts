import type { Plugin } from 'vite'
import { build } from 'vite'
import deno from '@deno/vite-plugin'
import { relative, resolve } from '@std/path'
import type { PwaConfig } from 'typings/pwa.ts'
import { spacePlugin } from './space-plugin.ts'
import { cometPlugin } from './comet-plugin.ts'
import { cssPlugin, type CssPluginOptions } from './css-plugin.ts'
import { pwaPlugin } from './pwa-plugin.ts'
import { resolvePwaPluginOptions } from './resolve-pwa-plugin-options.ts'
import { discoverComets } from './discover-comets.ts'

// `Plugin` is not re-exported here — same accepted `deno doc --lint` finding as `spacePlugin`'s
// own doc comment.

/** Options for {@linkcode buildSpaceClient}. */
export interface BuildSpaceClientOptions {
  /** Project root — same meaning as `SpaceDevEngineOptions.root`. */
  root: string
  /** Where the built client assets are written, relative to `root`. @default 'dist/client' */
  outDir?: string
  /**
   * This app's own declared global stylesheet source paths (`SpaceAppConfig.globalCss`, read back
   * via `getGlobalCssPaths()` after importing `space.app.ts`) — included as real build entries
   * alongside every discovered comet, so `cssPlugin` actually emits them: a plain `.css` file
   * nothing else imports would otherwise never reach the output bundle at all, since Rollup only
   * emits a CSS asset for a file that's actually reachable from some real entry.
   */
  globalCss?: string[]
  /** Forwarded to {@linkcode cssPlugin} unchanged. */
  css?: CssPluginOptions
  /**
   * The SAME author-facing `PwaConfig` `defineSpaceApp({ pwa })` takes — resolved internally via
   * {@linkcode resolvePwaPluginOptions} into whatever `pwaPlugin` itself needs. An author never
   * configures `pwaPlugin` separately; omitted entirely (no PWA build step at all) when not
   * given, matching `SpaceAppConfig.pwa`'s own optionality (`pwa: false`/undefined).
   */
  pwa?: PwaConfig
  /** Extra Vite plugins, composed after this function's own. */
  plugins?: Plugin[]
  /** Forwarded to Vite's own `build.minify`. @default true */
  minify?: boolean
}

/** What {@linkcode buildSpaceClient} returns. */
export interface BuildSpaceClientResult {
  /** Every comet file this build discovered and built as its own real entry. */
  comets: string[]
  /** The resolved, absolute output directory every built asset was written under. */
  outDir: string
}

/** Derives a stable, collision-resistant Rollup entry name from an absolute file path — its path
 * relative to `root`, extension stripped, separators flattened to `-`. Two comets sharing a bare
 * `basename` (e.g. `a/counter.tsx` and `b/counter.tsx`) would otherwise silently collide in
 * Rollup's own `input` map (the later one winning, the earlier one dropped from the build
 * entirely) — confirmed empirically before relying on this shape instead of a bare basename. */
function toEntryName(root: string, filePath: string): string {
  return relative(root, filePath)
    .replace(/\.[^./]+$/, '')
    .replace(/[\\/]/g, '-')
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
    globalCss = [],
    css,
    pwa,
    plugins = [],
    minify = true,
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
  for (const comet of comets) input[toEntryName(realRoot, comet)] = comet
  const resolvedGlobalCss = await Promise.all(
    globalCss.map((stylesheet) => Deno.realPath(resolve(root, stylesheet))),
  )
  for (const resolved of resolvedGlobalCss) input[toEntryName(realRoot, resolved)] = resolved

  // Zero comets, zero declared global CSS, and no `pwa` configured is a valid (if unusual) app
  // state — a page whose entire UI renders server-side with nothing client-facing at all — not an
  // error. Confirmed empirically: Rollup itself throws `INVALID_OPTION` for an empty `input`, so
  // this is a real guard, not defensive filler for a case that can't happen.
  if (Object.keys(input).length === 0 && !pwa) return { comets, outDir: resolvedOutDir }

  // `pwaPlugin`'s own icon/service-worker generation happens in `generateBundle`, a hook Rollup
  // only ever runs as part of a real build — it needs SOME entry to resolve a chunk graph from at
  // all, even though `pwaPlugin` itself doesn't care what that entry is. Confirmed empirically: a
  // `pwa`-only app (no comets, no globalCss) hit the exact same `INVALID_OPTION` error above
  // without this. A tiny virtual, empty module (never touching the real filesystem) is enough —
  // its own output is negligible and irrelevant; only `pwaPlugin`'s own emitted assets matter.
  const syntheticEntryId = '\0zanix-space-pwa-only-entry'
  if (Object.keys(input).length === 0) input['pwa'] = syntheticEntryId

  await build({
    root,
    configFile: false,
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
      ...spacePlugin(),
      cometPlugin({ knownEntryPaths: comets }),
      ...cssPlugin(css),
      ...(pwa ? [pwaPlugin(resolvePwaPluginOptions(pwa, root))] : []),
      {
        name: 'zanix-space-pwa-only-entry',
        resolveId: (id) => id === syntheticEntryId ? id : null,
        load: (id) => id === syntheticEntryId ? 'export {}' : null,
      },
      ...plugins,
    ],
  })

  return { comets, outDir: resolvedOutDir }
}
