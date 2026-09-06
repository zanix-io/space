import { join } from '@std/path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { Loader } from '@deno/loader'
import { InternalError } from '@zanix/errors'
import { USE_COMET_DIRECTIVE } from './comet-directive.ts'
import { getBrowserLoader, resolveDenoAt } from './deno-specifier-resolver.ts'

const IGNORED_DIR_NAMES = new Set([
  'node_modules',
  'dist',
  '.dist',
  '.vite',
  'coverage',
])
const SOURCE_EXTENSIONS = ['.tsx', '.jsx', '.ts', '.js']

/**
 * Walks `root`, handing every real source file's content to `onFile` — the shared directory walk
 * {@linkcode discoverComets} and {@linkcode discoverUsedCometImports} both build on, so a project
 * tree is only ever read once per caller, never duplicated between the two content-based checks
 * they each run over it.
 *
 * Skips common non-source directories (`node_modules`, build output, dep-optimizer caches, ...) —
 * never descends into them, both for correctness (a comet-looking file inside a dependency isn't
 * this app's own) and so a walk doesn't pay to visit potentially enormous trees that could never
 * contain a real comet anyway. A dotfile-prefixed directory (`.git`, `.github`, ...) is skipped the
 * same way, matching the same convention this package's own `deno.json` `exclude`s already use.
 *
 * @param root - Directory to walk. A directory that doesn't exist is treated as zero files, not an
 * error — the same convention {@linkcode scanPageFiles} already establishes for `routesDir`.
 * @param onFile - Called once per real source file found, with its full text content and its
 * (not-yet-realpath'd) path.
 * @param methodName - The calling function's own name, attached to a directory-read failure's
 * `InternalError` metadata, so it still points back at whichever discovery actually failed.
 */
async function walkSourceFiles(
  root: string,
  onFile: (content: string, entryPath: string) => void | Promise<void>,
  methodName: string,
): Promise<void> {
  async function visit(dir: string): Promise<void> {
    const entries: Deno.DirEntry[] = []
    try {
      for await (const entry of Deno.readDir(dir)) entries.push(entry)
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return
      // Build-time-only (never runs per-request) — see `comet-manifest.ts`'s own
      // `loadCometManifest` for why no `code`/`userMessage` here, matching `WebServerManager`'s
      // `readSslFile` precedent.
      throw new InternalError(`Failed to scan directory "${dir}" for comets.`, {
        cause: error,
        meta: { source: 'zanix', method: methodName, dir },
      })
    }

    await Promise.all(entries.map(async (entry) => {
      const entryPath = join(dir, entry.name)

      if (entry.isDirectory) {
        if (entry.name.startsWith('.') || IGNORED_DIR_NAMES.has(entry.name)) {
          return
        }
        await visit(entryPath)
        return
      }

      if (
        !entry.isFile ||
        !SOURCE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))
      ) return

      await onFile(await Deno.readTextFile(entryPath), entryPath)
    }))
  }

  await visit(root)
}

/**
 * Walks `root` looking for every file whose content starts with a `'use comet'` directive — the
 * exact same content-based recognition `cometPlugin` itself applies at build time
 * (`comet-directive.ts`'s shared `USE_COMET_DIRECTIVE`), just run once up front here so
 * `buildSpaceClient` knows which files to hand Vite as real `rollupOptions.input` entries. A
 * comet is deliberately NOT tied to any folder convention — `defineComet` itself doesn't care
 * where its own file lives — so this is a plain content scan, never a path-based one, the same
 * reasoning `cometPlugin`'s own detection already follows.
 *
 * @param root - Directory to walk. A directory that doesn't exist is treated as zero comets, not
 * an error — the same convention {@linkcode scanPageFiles} already establishes for `routesDir`.
 * @returns Every discovered comet file's real (symlink-resolved) path, in the order found (not
 * otherwise significant) — realpath'd for the same reason `cometPlugin`'s own `transform` hook
 * realpaths its own `id`: it's what `emitFile`/`facadeModuleId` matching ultimately compares
 * against, on a filesystem where a project root can itself be a symlink (macOS's `/tmp`/`/var`).
 */
export async function discoverComets(root: string): Promise<string[]> {
  const found: string[] = []
  await walkSourceFiles(root, async (content, entryPath) => {
    if (USE_COMET_DIRECTIVE.test(content)) found.push(await Deno.realPath(entryPath))
  }, 'discoverComets')
  return found
}

/** Matches a NAMED import clause from a non-relative specifier: `import { A, B as C } from
 * '<spec>'` — captures the clause body (group 1) and the specifier (group 3). Never a default or
 * namespace import — every ready-made Comet ever shipped (this package's own `SubmitGuard`, or any
 * third-party one) is imported by name, matching the one real, established convention, so this
 * scope limit costs nothing in practice. A heuristic regex, not a full parse — same deliberate
 * tradeoff `comet-directive.ts`'s own `USE_COMET_DIRECTIVE` already makes, for the same reason. */
const NAMED_IMPORT_RE = /import\s*\{([^}]*)\}\s*from\s*(['"])((?!\.)[^'"]+)\2/g

/** Matches a re-export clause: `export { A, B as C } from '<spec>'` — the SAME clause shape
 * {@linkcode NAMED_IMPORT_RE} matches for an import, reused by {@linkcode findReExport} to follow
 * a re-export barrel down to its own real source. Unlike `NAMED_IMPORT_RE`, `<spec>` here CAN be
 * relative — a package's own internal re-export (`export { default as X } from './y.ts'`) is
 * exactly the shape a real, published JSR package's own barrel file takes (confirmed against this
 * package's and `@zanix/space-ui`'s own published source — see {@linkcode resolveCometEntry}'s own
 * doc for why). */
const RE_EXPORT_RE = /export\s*\{([^}]*)\}\s*from\s*(['"])([^'"]+)\2/g

/** Parses a clause body (`A, B as C`) into `{source, local}` pairs — `source` is the name as the
 * specifier's OWN module exports it, `local` is what THIS scope calls it (itself, when there's no
 * `as`). The identical shape works for both an import clause (`import { source as local } from
 * spec`) and a re-export clause (`export { source as local } from spec`) — same syntax, same
 * meaning either way: "spec's own `source` becomes this scope's own `local`". */
export function parseClause(clause: string): Array<{ source: string; local: string }> {
  return clause
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const asMatch = /^(\S+)\s+as\s+(\S+)$/.exec(part)
      return asMatch ? { source: asMatch[1], local: asMatch[2] } : { source: part, local: part }
    })
}

/** One candidate worth resolving: a name imported from a non-relative specifier, actually
 * rendered as a JSX element somewhere in the SAME file — the cheap prefilter that keeps
 * {@linkcode discoverUsedCometImports} from ever attempting to resolve an ordinary,
 * non-comet-shaped import (a hook, a utility, `react` itself). `referrerFile` is the real,
 * absolute path of the file this was found in — needed to resolve `specifier` correctly. */
export interface CometUsageCandidate {
  specifier: string
  exportedName: string
  referrerFile: string
}

/** Finds every {@linkcode CometUsageCandidate} in one file's own content. A capitalized JSX-like
 * usage check (`<Name` followed by whitespace/`/`/`>`/`.`) is what filters out the overwhelming
 * majority of ordinary bare imports (hooks, utilities, `react` itself) at zero resolution cost —
 * only a name actually rendered as an element is ever a candidate at all. */
export function findCandidatesInFile(content: string, filePath: string): CometUsageCandidate[] {
  const candidates: CometUsageCandidate[] = []
  NAMED_IMPORT_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = NAMED_IMPORT_RE.exec(content))) {
    const [, clause, , specifier] = match
    for (const { source, local } of parseClause(clause)) {
      if (new RegExp(`<${local}[\\s/>.]`).test(content)) {
        candidates.push({ specifier, exportedName: source, referrerFile: filePath })
      }
    }
  }
  return candidates
}

/** Reads `url`'s own real text content — `Deno.readTextFile` for a local `file://` URL, a plain
 * `fetch` for a remote one (a real, published JSR file is a plain static asset, servable exactly
 * like `comet-plugin.test.ts`'s own suite already confirms against this package's real, published
 * `SubmitGuard` source). `null` on any failure — a missing/unreadable file is never a hard error
 * here, only a dead end for this one candidate. */
async function readSource(url: string, isLocalFile: boolean): Promise<string | null> {
  try {
    return isLocalFile
      ? await Deno.readTextFile(fileURLToPath(url))
      : await (await fetch(url)).text()
  } catch {
    return null
  }
}

/** Finds, in `content`, a re-export clause whose own LOCAL name matches `targetName` — the next
 * hop {@linkcode resolveCometEntry} should follow, and the name to look for once it gets there
 * (`source`, per {@linkcode parseClause}'s own doc: what THIS clause's own specifier calls it). */
export function findReExport(
  content: string,
  targetName: string,
): { specifier: string; source: string } | null {
  RE_EXPORT_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = RE_EXPORT_RE.exec(content))) {
    const [, clause, , specifier] = match
    for (const { source, local } of parseClause(clause)) {
      if (local === targetName) return { specifier, source }
    }
  }
  return null
}

/** A re-export chain longer than this is treated as unresolvable — a generous bound for a real
 * barrel-of-barrels shape, never expected to matter for a real package (every confirmed real case
 * — this package's own `mod-react.ts`→`submit-guard-react.tsx`, `@zanix/space-ui`'s own
 * `nav-drawer.ts`→`NavDrawer/index.ts` — is a single hop) but cheap insurance against a genuine
 * re-export cycle the `visited` guard below would otherwise need to run several times over before
 * catching. */
const MAX_REEXPORT_DEPTH = 5

/**
 * Follows `candidate`'s own specifier — and, if it's merely a re-export barrel, every further hop
 * — down to the real file that actually carries the `'use comet'` directive, returning that file's
 * own real identity (a realpath'd local path, or a plain resolved `https://` URL) ready to feed
 * straight into `build-client.ts`'s own `input`/`knownEntryPaths`, the exact same shape
 * {@linkcode discoverComets} already returns for a project's own local comets. `null` for anything
 * that never bottoms out at a real comet file — an ordinary component, an unresolvable specifier,
 * a re-export chain longer than {@linkcode MAX_REEXPORT_DEPTH} — every one of those is a safe,
 * silent no-op: a false-positive CANDIDATE ({@linkcode findCandidatesInFile}'s own JSX-usage
 * prefilter can only ever over-select, never under-select) costs one wasted resolution attempt,
 * never a wrong registration, since nothing is ever registered without first confirming the real
 * file's own directive.
 *
 * A relative re-export specifier resolves via plain URL algebra (`new URL(specifier, referrer)`),
 * never `@deno/loader` — confirmed empirically that a real, PUBLISHED JSR package's own internal
 * cross-file imports are ALWAYS relative: JSR flattens a package's own local import-map aliases
 * into plain relative paths at publish time (confirmed directly against this package's own
 * published `define-space-app.ts` — `modules/render/...` locally, `../render/...` as published —
 * and `@zanix/space-ui`'s own published `nav-drawer.ts` — `components/NavDrawer/index.ts` in its
 * own still-unpublished local checkout, `../components/NavDrawer/index.ts` in the real, published
 * `2.0.0` this whole investigation is grounded in). This covers the realistic case without ever
 * needing a referrer-scoped import-map lookup — `@deno/loader`'s own `Workspace` is scoped to ONE
 * config for its whole lifetime, so it has no way to consult a DIFFERENT remote package's own
 * import map even if a referrer URL pointed at one; `resolveDenoAt` only ever needs to run for a
 * re-export naming an ENTIRELY DIFFERENT package (a fully-qualified `jsr:`/`npm:`-resolvable
 * specifier, needing no external import map of its own to resolve).
 */
async function resolveCometEntry(
  candidate: CometUsageCandidate,
  loader: Loader,
): Promise<string | null> {
  let specifier = candidate.specifier
  let targetName = candidate.exportedName
  let referrer = pathToFileURL(candidate.referrerFile).href
  const visited = new Set<string>()

  for (let depth = 0; depth < MAX_REEXPORT_DEPTH; depth++) {
    const visitKey = `${referrer}\0${specifier}\0${targetName}`
    if (visited.has(visitKey)) return null
    visited.add(visitKey)

    let resolvedUrl: string
    let isLocalFile: boolean
    if (specifier.startsWith('.')) {
      resolvedUrl = new URL(specifier, referrer).href
      isLocalFile = resolvedUrl.startsWith('file://')
    } else {
      // deno-lint-ignore no-await-in-loop -- each hop's specifier/referrer comes from the PREVIOUS hop's own resolved content; there is nothing to parallelize
      const resolved = await resolveDenoAt(specifier, loader, referrer).catch(() => null)
      if (!resolved) return null
      isLocalFile = resolved.isLocalFile
      resolvedUrl = isLocalFile ? pathToFileURL(resolved.id).href : resolved.id
    }

    // deno-lint-ignore no-await-in-loop -- same reason as above: this hop's content is what decides whether there even IS a next hop
    const content = await readSource(resolvedUrl, isLocalFile)
    if (content === null) return null

    if (USE_COMET_DIRECTIVE.test(content)) {
      // deno-lint-ignore no-await-in-loop -- terminal hop, no further iteration follows this call
      return isLocalFile ? await Deno.realPath(fileURLToPath(resolvedUrl)) : resolvedUrl
    }

    const next = findReExport(content, targetName)
    if (!next) return null
    specifier = next.specifier
    targetName = next.source
    referrer = resolvedUrl
  }
  return null
}

/**
 * Which named imports from ANY non-relative specifier this project's own source actually renders
 * as JSX, resolved all the way down to each one's own real, `'use comet'`-marked file — generalizes
 * what a narrower, earlier version of this function only ever did for this package's OWN six
 * ready-made Comets (`SubmitGuard`, ...), imported specifically from `@zanix/space/comet/<renderer>`.
 * That narrower shape is no longer special-cased at all: a package's own `'use comet'` directive is
 * what actually makes something a Comet, never which package happened to ship it, so THIS package's
 * own ready-made Comets are discovered through the exact same generic path as any third-party one
 * (`@zanix/space-ui`'s own `NavDrawer`, built on this package's `defineComet` but shipped by a
 * completely different package) — one mechanism, not two parallel ones to keep in sync.
 *
 * Registered exactly like a project's own local comet (`discoverComets`) or auto-comet
 * (`error.tsx`): without this, `discoverComets`'s own local-filesystem walk never finds a
 * dependency-shipped Comet at all (it lives inside some OTHER package's own install location,
 * never this app's `routesDir`), silently degrading to an unattributed "Failed to hydrate a Comet
 * boundary" the moment an app composes one directly. Detected, not assumed: an app that never
 * renders any such Comet gets zero extra build output for it.
 *
 * Production-build-only, like every other caller of {@linkcode walkSourceFiles} — `zanix space dev`
 * needs no equivalent at all: it never reads a production manifest in the first place
 * (`resolveCometModuleUrl`'s own dev-mode branch resolves a remote Comet's URL directly from its
 * live `import.meta.url`), and a THIRD-PARTY Comet's `import.meta.url` is already correct there
 * once `ssr-module-evaluator.ts`'s own fix runs (see that file's own doc) — nothing about WHICH
 * package shipped a Comet changes anything on the dev side.
 *
 * Renderer-agnostic by construction, not by handling both cases: which renderer's own subpath a
 * project imports from (`@zanix/space/comet/react` vs `/preact`, or any other package's own
 * renderer-specific export) is already implicit in the project's own source text — there is no
 * separate renderer branch left for this function to take.
 *
 * @param root - Same meaning as {@linkcode discoverComets}'s own `root`.
 */
export async function discoverUsedCometImports(root: string): Promise<Set<string>> {
  const candidates: CometUsageCandidate[] = []
  await walkSourceFiles(root, (content, entryPath) => {
    candidates.push(...findCandidatesInFile(content, entryPath))
  }, 'discoverUsedCometImports')

  if (candidates.length === 0) return new Set()

  // Deduplicated by (specifier, exportedName) — the SAME package export imported from two
  // different files (a layout AND a page both rendering the same NavDrawer, say) only needs
  // resolving once.
  const uniqueCandidates = new Map<string, CometUsageCandidate>()
  for (const candidate of candidates) {
    uniqueCandidates.set(`${candidate.specifier}\0${candidate.exportedName}`, candidate)
  }

  const loader = await getBrowserLoader(root)
  const resolved = await Promise.all(
    [...uniqueCandidates.values()].map((candidate) => resolveCometEntry(candidate, loader)),
  )
  return new Set(resolved.filter((url): url is string => url !== null))
}
