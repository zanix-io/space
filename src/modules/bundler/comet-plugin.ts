import type { Plugin } from 'vite'
import type { CometManifest } from '../comets/comet-manifest.ts'
import { USE_COMET_DIRECTIVE } from './comet-directive.ts'
import { formatServerOnlyViolation, SERVER_ONLY_DIRECTIVE } from './server-only-directive.ts'

// `Plugin` is not re-exported here — same accepted `deno doc --lint` finding, for the same reason,
// as `spacePlugin`'s own (see that file's own comment): it's a deeply recursive Vite/Rolldown
// vendor type this package doesn't own, and returning a real `Plugin` object is unavoidable since
// `cometPlugin()` must compose into `vite.config.ts`'s `plugins` array like any other Vite plugin.

/** Options for {@linkcode cometPlugin}. */
export interface CometPluginOptions {
  /**
   * Absolute (realpath'd) paths of files the caller ALREADY passed as real `rollupOptions.input`
   * entries, treated as auto-comets for every purpose this plugin owns — both:
   *
   * - Skips this plugin's own `emitFile({ type: 'chunk' })` forcing for exactly these, since a real
   *   entry already gets its own chunk from Rollup with no forcing needed. Confirmed empirically
   *   before this option existed: forcing a chunk for a file that's ALSO a real entry produces a
   *   second, duplicate chunk for the same source — dead weight in the output, never referenced by
   *   the manifest (which only ever points at one of the two).
   * - Included in `comets-manifest.json` exactly like a real `'use comet'` file (`generateBundle`
   *   below writes an entry for every id in `cometSourceIds`, seeded from this option) — the same
   *   manifest `resolveCometModuleUrl` reads back, generically, for ANY source path, not only ones
   *   `defineComet` itself wrapped. `buildSpaceClient` passes BOTH `'use comet'`-discovered files
   *   (`discoverComets`) AND every route's own `error.tsx` here (React only — see that function's
   *   own doc) precisely to get this for free: an `error.tsx` is never author-marked `'use comet'`
   *   (it's auto-discovered by the router itself, see `error-boundary-marker.ts`'s own doc), so
   *   without this it would never enter `cometSourceIds` at all.
   *
   * Omit entirely for the common case (every comet only ever reached transitively, through a
   * page's own static import, and no `error.tsx` in this app) — unaffected either way.
   */
  knownEntryPaths?: Iterable<string>
}

const MANIFEST_FILE_NAME = 'comets-manifest.json'

/**
 * Reverses `@deno/vite-plugin`'s own wrapped module-id convention for a bare/remote specifier it
 * resolved (`deno::<loader>::<specifier>::<resolved>#deno`, NUL-prefixed — confirmed against that
 * package's real resolver output, the exact format `comet-manifest.ts`'s own
 * `toBrowserDenoSpecifier` builds in the opposite direction) back to the plain, resolved URL a
 * comet's own `import.meta.url` actually evaluates to at runtime. Returns `id` unchanged for
 * anything that never took this shape — an ordinary project-relative file Vite resolves without
 * this plugin's help never does.
 *
 * Needed here because a comet whose own SOURCE FILE is itself a remote/bare specifier — every
 * ready-made Comet this package ships (`SubmitGuard`, ...), used from a `jsr:`-installed consumer,
 * as opposed to a comet merely IMPORTING a remote package — is a real case, and this wrapped id's
 * own NUL byte makes `Deno.realPath` throw outright on it (confirmed empirically: an unhandled
 * build crash, not merely a silent manifest mismatch, without this unwrap step in place first).
 */
function unwrapDenoModuleId(id: string): string {
  const stripped = id.startsWith('\0') ? id.slice(1) : id
  if (!stripped.startsWith('deno::') || !stripped.endsWith('#deno')) return id
  const withoutSuffix = stripped.slice(0, -'#deno'.length)
  const lastSeparator = withoutSuffix.lastIndexOf('::')
  return lastSeparator === -1 ? id : withoutSuffix.slice(lastSeparator + 2)
}

/**
 * Resolves `id` to the identity {@linkcode cometSourceIds}/`serverOnlySourceIds`/`knownEntryPaths`
 * compare against, and `generateBundle` writes `comets-manifest.json` keyed by:
 * {@linkcode unwrapDenoModuleId}'s plain, resolved URL for a remote/bare specifier (never a real
 * filesystem path to `realPath`), or the realpath'd filesystem path for an ordinary local file
 * (falling back to the raw id on a `Deno.realPath` failure — a virtual/synthetic id, e.g. Vite's
 * own `\0`-prefixed ones this package doesn't otherwise recognize, simply never matches anything,
 * correctly, since a virtual module can never be a real `'use comet'`/`'server-only'` file).
 */
async function resolveComparableId(id: string): Promise<string> {
  const unwrapped = unwrapDenoModuleId(id)
  if (unwrapped !== id) return unwrapped
  try {
    return await Deno.realPath(id)
  } catch {
    return id
  }
}

/** Minimal shape this plugin needs from Rollup's real `PluginContext` to walk the module graph in
 * `buildEnd` — kept narrow (not `Rollup.PluginContext`) so this function stays trivially testable
 * and doesn't pull the full vendor type in just to describe two fields it actually reads. */
interface ModuleGraphReader {
  getModuleInfo(
    id: string,
  ): { importers: readonly string[]; dynamicImporters: readonly string[] } | null
}

/** Best-effort match against `knownRealIds` (`cometSourceIds`, in {@linkcode findChainToComet}'s
 * own use): `id`s coming out of `getModuleInfo` may or may not already be normalized the same way
 * {@linkcode resolveComparableId} normalizes `cometSourceIds`/`serverOnlySourceIds` themselves (same
 * ambiguity `transform`'s own call to it exists to route around). Tries the raw id first (the
 * common case, zero work), then {@linkcode unwrapDenoModuleId}'s plain URL, then a real
 * `Deno.realPath` — the identical three-step ladder `resolveComparableId` itself climbs, just
 * without committing to any one of them up front, since a match is all this needs. */
async function matchesKnownSource(id: string, knownRealIds: ReadonlySet<string>): Promise<boolean> {
  if (knownRealIds.has(id)) return true
  const unwrapped = unwrapDenoModuleId(id)
  if (unwrapped !== id && knownRealIds.has(unwrapped)) return true
  try {
    return knownRealIds.has(await Deno.realPath(id))
  } catch {
    return false
  }
}

/**
 * Breadth-first search over the module graph's REVERSE edges (an id's `importers`), starting at a
 * `'server-only'` module and walking outward until a known Comet source is reached (or the graph is
 * exhausted). Reverse edges are exactly what a violation needs to answer "who pulled this in?" — the
 * forward graph (`importedIds`) would only ever answer "what does this import?", the wrong direction
 * for attributing a violation back to the Comet responsible for it.
 *
 * @returns The chain from the offending Comet down to the `'server-only'` module
 * (`[comet, ...intermediates, serverOnlyId]`), or `null` if no Comet reaches it at all — the common
 * case, and never a false positive: a `'server-only'` module only ever enters this build's module
 * graph in the first place if SOMETHING reachable from a real entry imported it, and this build's
 * only entries are Comets (+ CSS/PWA/asset entries, which never import JS). A `'server-only'` module
 * nothing in the client graph ever reaches is simply never visited by Rollup at all, so it's never a
 * member of `serverOnlySourceIds`' BFS in the first place.
 */
async function findChainToComet(
  ctx: ModuleGraphReader,
  serverOnlyId: string,
  cometSourceIds: ReadonlySet<string>,
): Promise<string[] | null> {
  if (await matchesKnownSource(serverOnlyId, cometSourceIds)) return [serverOnlyId]

  const visited = new Set<string>([serverOnlyId])
  const parent = new Map<string, string>()
  const queue: string[] = [serverOnlyId]

  while (queue.length > 0) {
    const current = queue.shift()
    if (current === undefined) break
    const info = ctx.getModuleInfo(current)
    if (!info) continue

    // Every importer at THIS level is independent of the others, so their realpath lookups are
    // batched into one `Promise.all` rather than checked one at a time — but the BFS levels
    // themselves are a genuine sequential walk (level N's queue only exists once level N-1 has
    // been fully processed), the same shape `cjs-interop.ts`'s own recursive graph walk already
    // established a precedent for.
    const importers = [...info.importers, ...info.dynamicImporters].filter((id) => !visited.has(id))
    // deno-lint-ignore no-await-in-loop -- genuine sequential graph walk; see comment above
    const matches = await Promise.all(
      importers.map((importer) => matchesKnownSource(importer, cometSourceIds)),
    )

    for (let i = 0; i < importers.length; i++) {
      const importer = importers[i]
      if (visited.has(importer)) continue // a duplicate within this SAME level's importer list
      visited.add(importer)
      parent.set(importer, current)

      if (matches[i]) {
        const chain = [importer]
        for (let node = importer; node !== serverOnlyId;) {
          const next = parent.get(node)
          if (next === undefined) break
          node = next
          chain.push(node)
        }
        return chain
      }
      queue.push(importer)
    }
  }

  return null
}

/**
 * Finds every file marked `'use comet'` and forces it into its own build output chunk, then writes
 * a manifest (`comets-manifest.json`, in the client build's output directory) correlating each
 * comet's own source file to that chunk's real, hashed URL — read back at request time via
 * `loadCometManifest`, so `defineComet` can resolve a comet's real client URL instead of the raw
 * source location it only knows from `import.meta.url`.
 *
 * This split matters because a comet is typically also imported *statically* by whatever page
 * renders it server-side (`defineComet`'s wrapper needs the real component to produce real HTML).
 * Without forcing a separate chunk, a bundler has no reason to split that file out on its own — it
 * would simply inline it into the page's own chunk, and hydrating from it client-side would just
 * re-fetch code the page's own bundle already shipped, defeating the entire point of shipping less
 * JS per comet. `emitFile({ type: 'chunk' })` (Rollup's own established mechanism for exactly this
 * — the same technique lazy-route and precache-manifest plugins already use) is what prevents that.
 *
 * In dev, this plugin does nothing (`apply: 'build'`) — Vite's dev server already serves every
 * project file at its own root-relative path, so `resolveCometModuleUrl`'s own dev-mode fallback
 * already resolves a comet's URL correctly there with zero build step involved.
 *
 * Also enforces the `'server-only'` boundary (see {@linkcode SERVER_ONLY_DIRECTIVE}'s own doc): once
 * every module has been transformed, `buildEnd` walks the reverse module graph from every
 * `'server-only'`-marked file it saw and fails the build — via `this.error`, a real, fatal Rollup
 * error, not a warning — if any of them is reachable from a Comet, printing the exact import chain
 * that caused it. This only ever runs at build time (`apply: 'build'`, same as the rest of this
 * plugin) — nothing here adds a runtime check to the shipped bundle, and a `'server-only'` module
 * nothing in the client graph reaches is never even visited, so it can never produce a false
 * positive (see {@linkcode findChainToComet}'s own doc).
 *
 * @param options - See {@linkcode CometPluginOptions}.
 *
 * @example
 * ```ts
 * // vite.config.ts
 * import { defineConfig } from 'vite'
 * import { spacePlugin, cometPlugin } from '@zanix/space/vite'
 *
 * export default defineConfig({
 *   plugins: [...spacePlugin(), cometPlugin()],
 * })
 * ```
 */
export function cometPlugin(options: CometPluginOptions = {}): Plugin {
  const knownEntryPaths = new Set(options.knownEntryPaths ?? [])
  // Seeded from `knownEntryPaths` itself — see that option's own doc for why every known entry
  // (whether a real `'use comet'` file or an auto-comet like `error.tsx`) belongs in the manifest
  // this plugin writes, not only the ones `transform` below discovers via the directive.
  const cometSourceIds = new Set<string>(knownEntryPaths)
  const serverOnlySourceIds = new Set<string>()

  return {
    name: 'zanix-space-comets',
    apply: 'build',
    async transform(code, id) {
      if (USE_COMET_DIRECTIVE.test(code)) {
        // `resolveComparableId` is what keeps this set matching `generateBundle`'s own lookup
        // later, regardless of whether `id` is an ordinary local file (realpath'd, same reasoning
        // as `'server-only'` below always needed) or a ready-made Comet resolved through a remote
        // specifier (`@deno/vite-plugin`'s own wrapped id for it — unwrapped back to its plain,
        // resolved URL instead, since `Deno.realPath` throws outright on that wrapped id's own NUL
        // byte, a real, confirmed build crash otherwise).
        const realId = await resolveComparableId(id)
        cometSourceIds.add(realId)
        // Only force a NEW chunk for a comet reached transitively (e.g. through a page's own
        // static import) — one already given to Rollup as a real entry (`knownEntryPaths`) already
        // gets its own chunk on its own; forcing one anyway would emit a second, duplicate copy of
        // the same source (see `CometPluginOptions.knownEntryPaths`'s own doc for how this was
        // confirmed). Every ready-made Comet this package ships is always registered as a known
        // entry (see `build-client.ts`'s own doc), so this branch only ever runs for an ordinary
        // local file in practice — `realId`'s realpath'd form is what keeps it matching
        // `generateBundle`'s own lookup on a filesystem where `id` itself isn't already the real
        // path (e.g. a temp dir under macOS's symlinked `/tmp`/`/var`).
        if (!knownEntryPaths.has(realId)) {
          this.emitFile({ type: 'chunk', id: realId, preserveSignature: false })
        }
        return null
      }
      if (SERVER_ONLY_DIRECTIVE.test(code)) {
        serverOnlySourceIds.add(await resolveComparableId(id))
      }
      return null
    },
    async buildEnd(error) {
      // A build that already failed for an unrelated reason leaves the module graph in whatever
      // partial state it stopped at — walking it here would risk a confusing SECOND error on top
      // of the real one, for no benefit (the build is already failing either way).
      if (error || serverOnlySourceIds.size === 0 || cometSourceIds.size === 0) return
      // Each `'server-only'` module's own graph walk is fully independent of the others', so all
      // of them run concurrently — only the first (in `serverOnlySourceIds`' own insertion order)
      // actual violation is ever reported, since one clear failure is all a build needs to fail on.
      const chains = await Promise.all(
        [...serverOnlySourceIds].map((id) => findChainToComet(this, id, cometSourceIds)),
      )
      const violation = chains.find((chain): chain is string[] => chain !== null)
      if (violation) this.error(formatServerOnlyViolation(violation))
    },
    generateBundle(_options, bundle) {
      if (cometSourceIds.size === 0) return

      const manifest: CometManifest = {}
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk' || !chunk.facadeModuleId) continue
        // A ready-made Comet resolved through a remote specifier gets a `facadeModuleId` wrapped
        // by `@deno/vite-plugin`'s own resolver, never the plain URL `cometSourceIds` holds for it
        // (an ordinary local file's `facadeModuleId` is already plain, so this is a no-op there).
        const sourceKey = unwrapDenoModuleId(chunk.facadeModuleId)
        if (cometSourceIds.has(sourceKey)) manifest[sourceKey] = `/${chunk.fileName}`
      }

      this.emitFile({
        type: 'asset',
        fileName: MANIFEST_FILE_NAME,
        source: JSON.stringify(manifest, null, 2),
      })
    },
  }
}
