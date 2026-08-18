import type { Plugin } from 'vite'
import { basename } from '@std/path'
import type { CometManifest } from '../comets/comet-manifest.ts'
import { USE_COMET_DIRECTIVE } from './comet-directive.ts'
import { SERVER_ONLY_DIRECTIVE } from './server-only-directive.ts'

// `Plugin` is not re-exported here — same accepted `deno doc --lint` finding, for the same reason,
// as `spacePlugin`'s own (see that file's own comment): it's a deeply recursive Vite/Rolldown
// vendor type this package doesn't own, and returning a real `Plugin` object is unavoidable since
// `cometPlugin()` must compose into `vite.config.ts`'s `plugins` array like any other Vite plugin.

/** Options for {@linkcode cometPlugin}. */
export interface CometPluginOptions {
  /**
   * Absolute paths of comets the caller ALREADY passed as real `rollupOptions.input` entries
   * (`buildSpaceClient` does this, via `discoverComets`) — this plugin skips its own
   * `emitFile({ type: 'chunk' })` forcing for exactly these, since a real entry already gets its
   * own chunk from Rollup with no forcing needed. Confirmed empirically before this option
   * existed: forcing a chunk for a file that's ALSO a real entry produces a second, duplicate
   * chunk for the same source — dead weight in the output, never referenced by the manifest
   * (which only ever points at one of the two). Omit entirely for the common case (a comet only
   * ever reached transitively, through a page's own static import) — unaffected either way.
   */
  knownEntryPaths?: Iterable<string>
}

const MANIFEST_FILE_NAME = 'comets-manifest.json'

/** Minimal shape this plugin needs from Rollup's real `PluginContext` to walk the module graph in
 * `buildEnd` — kept narrow (not `Rollup.PluginContext`) so this function stays trivially testable
 * and doesn't pull the full vendor type in just to describe two fields it actually reads. */
interface ModuleGraphReader {
  getModuleInfo(
    id: string,
  ): { importers: readonly string[]; dynamicImporters: readonly string[] } | null
}

/** Best-effort realpath match: `id`s coming out of `getModuleInfo` may or may not already be the
 * symlink-resolved path `cometSourceIds`/`serverOnlySourceIds` are keyed by (same ambiguity
 * `transform`'s own `realId` normalization exists to route around — see that hook's doc). Tries the
 * raw id first (the common case, zero syscalls), then falls back to a real `Deno.realPath`. A
 * virtual/synthetic module id (e.g. Vite's own `\0`-prefixed ones) simply never resolves and never
 * matches — correct, since a virtual module can never be a real `'use comet'`/`'server-only'` file. */
async function matchesKnownSource(id: string, knownRealIds: ReadonlySet<string>): Promise<boolean> {
  if (knownRealIds.has(id)) return true
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

/** Renders the violation exactly as a developer needs to fix it — the offending Comet first, the
 * `'server-only'` module last, everything in between the real reason it got pulled in. Uses each
 * file's own basename (never the full, often temp-dir-cluttered absolute path) — a chain is only
 * ever a handful of modules deep in practice, so the basenames alone are enough to locate the fix. */
function formatServerOnlyViolation(chain: string[]): string {
  const names = chain.map((id) => basename(id))
  const [head, ...rest] = names
  const lines = [head, ...rest.map((name, i) => `${'  '.repeat(i + 1)}→ ${name}`)]
  return `Server-only module imported into client Comet:\n\n${lines.join('\n')}`
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
  const cometSourceIds = new Set<string>()
  const serverOnlySourceIds = new Set<string>()
  const knownEntryPaths = new Set(options.knownEntryPaths ?? [])

  return {
    name: 'zanix-space-comets',
    apply: 'build',
    async transform(code, id) {
      if (USE_COMET_DIRECTIVE.test(code)) {
        // Rollup/Rolldown resolve a chunk's own `facadeModuleId` through the real
        // (symlink-resolved) filesystem path — realpath-ing here too, once per comet file at build
        // time, is what keeps this set matching that later in `generateBundle`, on a filesystem
        // where `id` itself isn't already the real path (e.g. a temp dir under macOS's symlinked
        // `/tmp`/`/var`).
        const realId = await Deno.realPath(id)
        cometSourceIds.add(realId)
        // Only force a NEW chunk for a comet reached transitively (e.g. through a page's own
        // static import) — one already given to Rollup as a real entry (`knownEntryPaths`) already
        // gets its own chunk on its own; forcing one anyway would emit a second, duplicate copy of
        // the same source (see `CometPluginOptions.knownEntryPaths`'s own doc for how this was
        // confirmed).
        if (!knownEntryPaths.has(realId)) {
          this.emitFile({ type: 'chunk', id: realId, preserveSignature: false })
        }
        return null
      }
      if (SERVER_ONLY_DIRECTIVE.test(code)) {
        serverOnlySourceIds.add(await Deno.realPath(id))
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
        if (
          chunk.type === 'chunk' && chunk.facadeModuleId &&
          cometSourceIds.has(chunk.facadeModuleId)
        ) {
          manifest[chunk.facadeModuleId] = `/${chunk.fileName}`
        }
      }

      this.emitFile({
        type: 'asset',
        fileName: MANIFEST_FILE_NAME,
        source: JSON.stringify(manifest, null, 2),
      })
    },
  }
}
