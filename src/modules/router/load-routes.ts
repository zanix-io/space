import { join, resolve, toFileUrl } from '@std/path'
import type { ClassConstructor } from '@zanix/server'
import { fileExists } from '@zanix/helpers'
import { InternalError } from '@zanix/errors'
import { ProgramModule } from '@zanix/server'
import logger from '@zanix/logger'
import { scanPageFiles } from './scan-page-files.ts'
import { resolvePendingPage, withPendingReplacement } from './page-decorator.ts'
import { setPageTree } from './page-tree-registry.ts'
import type { ResolvedSegment } from './page-tree-registry.ts'
import type { SpacePageController } from './space-page-controller.ts'
import type { HeadDescriptor } from './head-descriptor.ts'
import { setNotFoundComponent, setNotFoundHead, setRootLayout } from './app-shell-registry.ts'
import { getActiveRenderer } from './active-renderer.ts'

/** The shape any dynamic module import resolves to, as far as this module cares. `head`/`loader`
 * are only ever meaningfully present on a `layout.tsx` module — its own named exports, discovered
 * alongside the default export below, same import call, no separate file scan (see this module's
 * own segment resolution). */
export type ImportedModule = { default?: unknown; head?: unknown; loader?: unknown }

/** Options for {@linkcode loadRoutes}. */
export interface LoadRoutesOptions {
  /**
   * Overrides how a module is imported — defaults to native dynamic `import()`. A dev-server
   * passes a function backed by a `SpaceDevEngine`'s `ssrLoadModule` instead, so a LATER call for
   * the same `routesDir` (after a file change) picks up fresh content without a process restart —
   * see the note on repeated calls in {@linkcode loadRoutes}'s own doc.
   */
  importModule?: (filePath: string) => Promise<ImportedModule>
  /**
   * Scopes this call to only re-import/re-register the given page file path(s) — every OTHER
   * discovered page is left completely untouched (no `importModule` call, no register/compare
   * work for it at all). `scanPageFiles` itself still runs unscoped (needed either way, to
   * correctly detect a genuinely REMOVED page — see the orphan-cleanup pass below, which stays
   * unscoped too since it's cheap and this option changes nothing about which pages currently
   * exist).
   *
   * For `zanix space dev`'s own `onSsrModuleChanged` handler: a Comet's own edit never adds,
   * removes, or renames a route — only a page whose OWN file (or one of its ALREADY-existing
   * segment files) changed needs reimporting at all. Re-importing every OTHER, unaffected page on
   * every such edit was pure waste — each one's own `importModule` call was already a cache hit
   * (nothing in ITS graph was invalidated), but still real, avoidable async work through Vite's
   * own module runner, called once per page, on every single Comet save. Set this to
   * `event.affectedRoutes` (from `computeAffectedRoutes`, already exactly the page(s) a given file
   * change resolves to) to reload only those.
   *
   * Never appropriate for a structural change (a page file added/removed/renamed) — that case
   * needs the normal, unscoped call, so the orphan-cleanup/full-discovery pass actually runs
   * against every page.
   */
  onlyFilePaths?: readonly string[]
}

/**
 * Tracks which page class is currently registered for a given file path, across repeated
 * `loadRoutes()` calls — lets a later call for the SAME file tell apart "genuinely reimported
 * (needs the previous class's routes deregistered via `ProgramModule.unregisterRoutes`,
 * `@zanix/server`, before the new one registers)" from "reimported the identical, cached class
 * (nothing to do — it's still correctly registered from before)". See `loadRoutes`'s own doc for
 * the full reasoning. Production only ever calls `loadRoutes()` once per process, so this never
 * grows beyond a single generation there.
 */
const registeredPageTargets = new Map<
  string,
  ClassConstructor<SpacePageController>
>()

/**
 * Resolves a whole-app root singleton (`layout.tsx`/`not-found.tsx` directly under a `routesDir`
 * entry) across one or more directories — the FIRST directory (array order) that declares
 * `fileName` wins, app-wide; every later directory's own copy (if any) is never even imported. This
 * mirrors {@linkcode scanPageFiles}'s own first-match-wins rule for pages, but resolved once for the
 * whole app rather than per-route: `layout.tsx`/`not-found.tsx` at root have no "which page did this
 * come from" question to answer, so there's nothing to keep separate per directory the way a page's
 * own nested composition chain is.
 */
async function resolveRootSingleton(
  dirs: string[],
  fileName: string,
  importModule: (path: string) => Promise<ImportedModule>,
): Promise<ImportedModule> {
  for (const dir of dirs) {
    const filePath = join(dir, fileName)
    // Sequential on purpose, not parallelizable: this is a first-match-wins lookup, so a later
    // directory's copy must never even be imported once an earlier one has answered — importing it
    // would run its module side effects for a file this app has decided not to use.
    // deno-lint-ignore no-await-in-loop
    if (fileExists(filePath)) return await importModule(filePath)
  }
  return {}
}

/**
 * Serializes calls to {@linkcode loadRoutesOnce} — a call that arrives while a previous one for
 * this module is still running waits for it to finish before its own body starts, never running
 * concurrently with it. See `loadRoutesOnce`'s own doc for everything about what a call actually
 * discovers/registers and how repeated calls behave; this wrapper only controls their ORDER.
 *
 * This exists because `loadRoutesOnce` mutates shared, module-level state
 * ({@linkcode registeredPageTargets}, plus `ProgramModule.routes` via `@zanix/server`) with no
 * concurrency guard of its own. `zanix space dev` calls this once per SSR-affecting file change —
 * several rapid saves of the same file (mashing Ctrl+S) fire several such calls before the first
 * one finishes. Two overlapping calls for the same page each independently reimport it (Vite
 * genuinely re-evaluates on each), and both then race to register the same route path — whichever
 * finishes first wins, the second collides and throws. Worse, the LOSING call still overwrites
 * `registeredPageTargets`'s entry for that file with its own (never actually registered) class
 * before that throw, permanently pointing the bookkeeping at a class that owns no route — every
 * later call (for ANY file change anywhere in `routesDir`, since a call always reprocesses every
 * page) then hits the exact same collision forever, until the whole process restarts. Strictly
 * sequential calls make this corrupted state structurally impossible: a call always starts from
 * whatever consistent state the previous one left behind.
 *
 * Adds no latency to the common case (a single call, e.g. a normal boot) — the queue starts
 * pre-resolved. Never changes what an individual call resolves/rejects with — only the ORDER
 * calls run in.
 */
export function loadRoutes(
  routesDir: string | string[] = './routes',
  options: LoadRoutesOptions = {},
): Promise<void> {
  const run = loadRoutesQueue.then(() => loadRoutesOnce(routesDir, options))
  // Swallowed here, not on `run` — a rejected call must not wedge every LATER caller behind a
  // permanently-rejected chain; each call still observes its own real outcome via `run`, returned
  // below, unaffected by this `.catch`.
  loadRoutesQueue = run.catch(() => {})
  return run
}

/** The serialization chain {@linkcode loadRoutes} chains each call onto — see its own doc. Never
 * itself rejects (each call's own failure is swallowed here after being handed to that call's own
 * caller), so a failed call never wedges the ones queued behind it. */
let loadRoutesQueue: Promise<void> = Promise.resolve()

/**
 * The real implementation behind {@linkcode loadRoutes} — split out, and never exported, purely
 * so `loadRoutes` can serialize calls to this one without duplicating its logic. Never call this
 * directly; call `loadRoutes` instead.
 *
 * Discovers and imports every `page.tsx` file under `routesDir` (plus each one's own
 * `layout.tsx`/`loading.tsx`/`error.tsx` composition chain, and each `layout.tsx`'s own optional
 * `head`/`loader` named exports), registering each page's `Page()`-decorated default export as a
 * route — importing a module is what actually runs its decorators,
 * so this is the step that turns the file tree into real, dispatchable routes. For a page decorated
 * with a pathless `@Page()`, this is also the step that tells it its real route path (derived from
 * its file's own location — see `scanPageFiles`); for an explicit `@Page(path)`, that already
 * happened at decoration time and this is a no-op for that page.
 *
 * Also discovers `routesDir`'s own `layout.tsx` (the app's root layout — see `applyDocumentShell`)
 * and `not-found.tsx` (served by `createNotFoundHandler`), independently of whether any page
 * exists at all, so both work correctly even for an app with zero pages.
 *
 * `defineSpaceApp()` already calls this for you, as part of this app's own `setup(ctx)` — an
 * author never calls it directly. That matters beyond convenience: `setup(ctx)` runs inside
 * `@zanix/app`'s `ProgramModule.defineApplication(name, ...)` scope (an `AsyncLocalStorage`-backed
 * ambient context), so every page this function imports registers under THIS app's own Application
 * — never the default one. Calling `loadRoutes()` from outside `setup` (e.g. directly in a
 * `main.ts`) would register every page under the default Application instead, regardless of which
 * app declared them.
 *
 * A `layout.tsx`/`loading.tsx`/`error.tsx` shared by several pages (any ancestor directory) is only
 * ever imported once — resolved page-by-page in parallel, but deduplicated by file path.
 *
 * **Calling this more than once for the same `routesDir`** (a dev-server's job, never a plain
 * app's own) re-scans and re-imports every page again. Each page's re-import is compared by
 * identity against whatever class was registered for that same file path last time (see
 * {@linkcode registeredPageTargets}):
 * - **Same class reference** (e.g. plain `import()` hitting its own ES module cache — the file
 *   didn't actually change) — left alone entirely, exactly as if this were the only call ever
 *   made. This is what keeps a redundant/no-op call safe: deregistering an unchanged page here
 *   would remove a still-correct registration that nothing would restore, since a class whose
 *   module wasn't re-evaluated never re-runs its `@Page()` decorator.
 * - **A genuinely different class** (a real reimport — e.g. after `SpaceDevEngine`'s own
 *   `onSsrModuleChanged`, which only fires once Vite's module graph already guarantees a fresh
 *   module) — the previous class's routes are deregistered first, so the new one's `@Page()`
 *   registers cleanly instead of colliding.
 *
 * Layout/loading/error/not-found files aren't routes themselves, so they need no such
 * comparison/deregistration — they're simply re-imported and re-stored either way.
 *
 * **Known limitation, not solved by the above**: a page using an *explicit* `@Page(path)` (see
 * `Page`'s own doc) registers immediately, synchronously, during import itself — before this
 * function ever gets a chance to compare it against what was registered last time. Reimporting
 * such a page while its previous registration is still live throws the same collision this
 * mechanism otherwise avoids. Hot-reloading works reliably today only for the recommended,
 * pathless `@Page()` form, whose registration is deferred until after import.
 *
 * @param routesDir - The routes directory root(s), relative to the current working directory.
 * Defaults to `'./routes'`. A directory that doesn't exist yet is treated as zero pages. An array
 * lets a host compose a base app's pages with its own override directory (or several) without
 * forking either tree — see {@linkcode scanPageFiles} for the per-page first-match-wins rule this
 * applies, and `resolveRootSingleton` (this module) for the separate rule `layout.tsx`/
 * `not-found.tsx` (whole-app singletons, not per-page) follow: first directory to declare either
 * file wins, app-wide, regardless of which directory ends up serving any given page.
 * @param options - See {@linkcode LoadRoutesOptions}.
 * @throws {InternalError} If the active renderer is Preact (`defineSpaceApp({ renderer: 'preact' })`)
 * and any discovered route has a `loading.tsx` — rejected here, at registration time, rather than
 * left to fail confusingly the first time that route is actually requested: Preact core has no
 * `Suspense` to back a `loading.tsx` fallback with.
 */
async function loadRoutesOnce(
  routesDir: string | string[] = './routes',
  options: LoadRoutesOptions = {},
): Promise<void> {
  const dirs = Array.isArray(routesDir) ? routesDir : [routesDir]
  const moduleCache = new Map<string, Promise<ImportedModule>>()
  const importFile = options.importModule ??
    ((filePath: string) => import(toFileUrl(resolve(filePath)).href))

  const importModule = (filePath: string): Promise<ImportedModule> => {
    let modulePromise = moduleCache.get(filePath)
    if (!modulePromise) {
      modulePromise = importFile(filePath)
      moduleCache.set(filePath, modulePromise)
    }
    return modulePromise
  }

  const [pages, rootLayout, notFound] = await Promise.all([
    scanPageFiles(routesDir),
    resolveRootSingleton(dirs, 'layout.tsx', importModule),
    resolveRootSingleton(dirs, 'not-found.tsx', importModule),
  ])

  setRootLayout(rootLayout.default)
  setNotFoundComponent(notFound.default)
  // A `not-found.tsx` may export a named `head` exactly like a `layout.tsx` may — same discovery,
  // same single import, no separate file scan. `createNotFoundHandler` falls back to this package's
  // own default when it declares none.
  setNotFoundHead(notFound.head as HeadDescriptor | undefined)

  // Deregisters a page whose file no longer exists under `routesDir` at all — a rename or delete,
  // never a plain edit (an edited-but-still-present file goes through the per-page comparison
  // below instead). Without this, `registeredPageTargets` only ever grows: the loop below only
  // ever visits pages `scanPageFiles` found THIS call, so a file that's gone is simply never
  // revisited by anything, and its previous registration survives forever — the live route table
  // keeps serving a path whose backing file no longer exists, until the whole process restarts.
  // Safe on a plain, single production boot too: `registeredPageTargets` starts empty there, so
  // this loop has nothing to compare against and does nothing on that first (and normally only)
  // call — same reasoning the per-page comparison below already relies on.
  const currentFilePaths = new Set(pages.map((page) => page.filePath))
  for (const [filePath, Target] of registeredPageTargets) {
    if (!currentFilePaths.has(filePath)) {
      ProgramModule.unregisterRoutes(Target, 'ssr')
      registeredPageTargets.delete(filePath)
    }
  }

  // See `LoadRoutesOptions.onlyFilePaths`'s own doc — narrows which pages the loop below actually
  // touches (`importModule` call, register/compare) without changing anything about discovery
  // (`pages`, `currentFilePaths`) or the orphan-cleanup pass above, both of which stay correct
  // (and cheap) run unscoped every time regardless.
  const onlyFilePaths = options.onlyFilePaths ? new Set(options.onlyFilePaths) : undefined
  const scopedPages = onlyFilePaths
    ? pages.filter((page) => onlyFilePaths.has(page.filePath))
    : pages

  await Promise.all(scopedPages.map(async (page) => {
    const previousTarget = registeredPageTargets.get(page.filePath)

    // Checked against `page.segments`' own RAW, pre-import shape (`scanPageFiles`'s own discovery
    // result), and BEFORE any of this page's segment files are imported below. Rejected at
    // registration time, before any request could ever reach it — not a runtime check inside the
    // render path, and not a behavior this package tries to approximate for Preact: Preact core has
    // no `Suspense` at all, so `loading.tsx`'s entire
    // contract (a Suspense fallback shown while a segment suspends) has no renderer underneath it to
    // run on. Checking BEFORE the import matters for real: a `loading.tsx` file is, by definition,
    // never meant to run under `--renderer=preact` — if importing it also happened to throw its own
    // unrelated error (a missing dependency, a typo), that raw import failure would reach the caller
    // INSTEAD of this guard's own clear, actionable message, defeating the whole point of "before any
    // request could reach it." A rejected file's own code must never even run, let alone determine
    // what error surfaces. `getActiveRenderer()` is read here, not passed as a parameter, because
    // `loadRoutes()`'s own public signature (used directly by app code in some test setups, not only
    // via `defineSpaceApp`) predates this option and adding a required parameter would be a breaking
    // change for every existing caller.
    if (getActiveRenderer() === 'preact') {
      const offendingIndex = page.segments.findIndex((segment) => segment.loadingFilePath)
      if (offendingIndex !== -1) {
        const loadingFilePath = page.segments[offendingIndex].loadingFilePath
        throw new InternalError(
          `loading.tsx is not supported under --renderer=preact: it requires Suspense, which ` +
            `Preact core does not have. "${loadingFilePath}" (route "${page.routePath}") must be ` +
            `removed, or this app switched to --renderer=react.`,
          { meta: { routePath: page.routePath, filePath: loadingFilePath } },
        )
      }
    }

    // Only ever wrapped while a real dev engine is installed (`options.importModule` is
    // `undefined` for every plain production boot — see `getDevImportModule`'s own doc) — a
    // production `import()` can never produce a genuinely different class for an unchanged file
    // path within one process anyway (Deno's own ES module cache is effectively permanent per
    // URL), so an explicit `@Page(path)`'s collision-on-reimport (see `withPendingReplacement`'s
    // own doc) is structurally a dev-only problem; gating here means a production boot never
    // touches `AsyncLocalStorage` for this at all, not merely that doing so would be a no-op.
    const importPage = () => importModule(page.filePath)
    const [pageModule, segments] = await Promise.all([
      options.importModule ? withPendingReplacement(previousTarget, importPage) : importPage(),
      Promise.all(
        page.segments.map(async (segment): Promise<ResolvedSegment> => {
          // One import call for `layout.tsx`, not three — `head`/`loader` (if declared) are their
          // own named exports on the SAME module `layout` (the default export) already comes from;
          // `importModule`'s own cache (above) would make a second call cheap too, but reading all
          // three off one already-awaited result is simpler and avoids relying on that cache.
          const layoutModule = segment.layoutFilePath
            ? await importModule(segment.layoutFilePath)
            : undefined
          return {
            layout: layoutModule?.default,
            head: layoutModule?.head as ResolvedSegment['head'],
            loader: layoutModule?.loader as ResolvedSegment['loader'],
            loading: segment.loadingFilePath
              ? (await importModule(segment.loadingFilePath)).default
              : undefined,
            error: segment.errorFilePath
              ? (await importModule(segment.errorFilePath)).default
              : undefined,
            // Realpath'd here, once, right where the file is already known to exist (the
            // `segment.errorFilePath ?` guard above already proved that) — see `ResolvedSegment`'s
            // own doc for why this exact form (not the raw, routesDir-relative path) is what
            // `resolveCometModuleUrl` needs to ever match `buildSpaceClient`'s own manifest key for
            // the SAME file.
            errorFilePath: segment.errorFilePath
              ? await Deno.realPath(resolve(segment.errorFilePath))
              : undefined,
          }
        }),
      ),
    ])

    const Target = pageModule.default as ClassConstructor<SpacePageController>

    // A `page.tsx` with no default export at all (`Target` is `undefined`) — most commonly the
    // normal, transient state of a page a developer is still scaffolding (create the folder,
    // create an empty `page.tsx`, THEN write the component and its `@Page()`). `setPageTree`/
    // `resolvePendingPage` below both key a `WeakMap` by `Target`, which throws an opaque,
    // unhelpful `TypeError: Invalid value used as weak map key` for anything that isn't a real
    // object reference — this reports the SAME real problem in an actionable way instead, and —
    // critically — `return`s rather than `throw`s: a `loadRoutes()` reload runs every page through
    // ONE `Promise.all`, so letting this reject would take down every OTHER already-working page's
    // own dev-reload the moment a new, still-empty page file exists, which is worse than just not
    // routing the incomplete one yet. Logged once per reload, same as any other page's own
    // re-registration — it stops once the file gains a real `export default`.
    //
    // Deliberately checks WeakMap-key validity (object or function, not `null`), never narrowed to
    // `typeof Target === 'function'` — this module's own test suite (and any caller using
    // `LoadRoutesOptions.importModule` to substitute a lightweight identity-stable stand-in rather
    // than a real `SpacePageController` subclass) legitimately resolves `default` to a plain
    // object; only `Page()`'s own decorator is responsible for rejecting a real class that doesn't
    // extend `SpacePageController` — narrowing this check to functions only would silently skip
    // every such test double instead of registering it, a real regression confirmed against
    // `load-routes-multi-dir.test.ts`'s own `fakeImportModule`.
    const isValidPageTarget = typeof Target === 'function' ||
      (typeof Target === 'object' && Target !== null)
    if (!isValidPageTarget) {
      logger.warn(
        `"${page.filePath}" (route "${page.routePath}") has no default export yet — skipped. ` +
          'A page.tsx must `export default` a class extending `SpacePageController`, decorated ' +
          'with `@Page()`.',
      )
      return
    }

    // Only deregister when the import genuinely produced a DIFFERENT class than last time (a
    // real reimport, invalidated by a dev-server) — never when it's the identical, cached
    // object (an unchanged file re-imported redundantly, or the very first call). Deregistering
    // unconditionally would remove a still-correct, still-needed registration in the unchanged
    // case, and `resolvePendingPage` below is a no-op for an already-resolved Target (its
    // `@Page()` decorator never re-runs for a module that wasn't re-evaluated) — nothing would
    // restore it, silently breaking every plain, repeated `loadRoutes()` call.
    if (previousTarget && previousTarget !== Target) {
      ProgramModule.unregisterRoutes(previousTarget, 'ssr')
    }

    registeredPageTargets.set(page.filePath, Target)
    resolvePendingPage(Target, page.routePath)
    setPageTree(Target, { segments, filePath: page.filePath })
  }))
}
