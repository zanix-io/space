import { join, resolve, toFileUrl } from '@std/path'
import type { ClassConstructor } from '@zanix/server'
import type { ComponentType } from 'react'
import type { LayoutProps } from 'typings/page.ts'
import { fileExists } from '@zanix/helpers'
import { ProgramModule } from '@zanix/server'
import { scanPageFiles } from './scan-page-files.ts'
import { resolvePendingPage } from './page-decorator.ts'
import { setPageTree } from './page-tree-registry.ts'
import type { ResolvedSegment } from './page-tree-registry.ts'
import type { SpacePageController } from './space-page-controller.tsx'
import { setNotFoundComponent, setRootLayout } from './app-shell-registry.ts'

/** The shape any dynamic module import resolves to, as far as this module cares. */
export type ImportedModule = { default?: unknown }

/** Options for {@linkcode loadRoutes}. */
export interface LoadRoutesOptions {
  /**
   * Overrides how a module is imported — defaults to native dynamic `import()`. A dev-server
   * passes a function backed by a `SpaceDevEngine`'s `ssrLoadModule` instead, so a LATER call for
   * the same `routesDir` (after a file change) picks up fresh content without a process restart —
   * see the note on repeated calls in {@linkcode loadRoutes}'s own doc.
   */
  importModule?: (filePath: string) => Promise<ImportedModule>
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
const registeredPageTargets = new Map<string, ClassConstructor<SpacePageController>>()

/** Imports `filePath`'s default export, or `undefined` if the file doesn't exist — used for the
 * two whole-app files (`layout.tsx`/`not-found.tsx` directly under `routesDir`) that, unlike a
 * page's own composition chain, aren't tied to any specific route. */
async function importDefaultIfExists(
  filePath: string,
  importModule: (path: string) => Promise<ImportedModule>,
): Promise<unknown> {
  if (!fileExists(filePath)) return undefined
  return (await importModule(filePath)).default
}

/**
 * Discovers and imports every `page.tsx` file under `routesDir` (plus each one's own
 * `layout.tsx`/`loading.tsx`/`error.tsx` composition chain), registering each page's `Page()`-
 * decorated default export as a route — importing a module is what actually runs its decorators,
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
 * @param routesDir - The routes directory root, relative to the current working directory.
 * Defaults to `'./routes'`. A directory that doesn't exist yet is treated as zero pages.
 * @param options - See {@linkcode LoadRoutesOptions}.
 */
export async function loadRoutes(
  routesDir = './routes',
  options: LoadRoutesOptions = {},
): Promise<void> {
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
    importDefaultIfExists(join(routesDir, 'layout.tsx'), importModule),
    importDefaultIfExists(join(routesDir, 'not-found.tsx'), importModule),
  ])

  setRootLayout(rootLayout as ComponentType<LayoutProps> | undefined)
  setNotFoundComponent(notFound as ComponentType | undefined)

  await Promise.all(pages.map(async (page) => {
    const previousTarget = registeredPageTargets.get(page.filePath)

    const [pageModule, segments] = await Promise.all([
      importModule(page.filePath),
      Promise.all(page.segments.map(async (segment): Promise<ResolvedSegment> => ({
        layout: segment.layoutFilePath
          // deno-lint-ignore no-explicit-any
          ? (await importModule(segment.layoutFilePath)).default as any
          : undefined,
        loading: segment.loadingFilePath
          // deno-lint-ignore no-explicit-any
          ? (await importModule(segment.loadingFilePath)).default as any
          : undefined,
        error: segment.errorFilePath
          // deno-lint-ignore no-explicit-any
          ? (await importModule(segment.errorFilePath)).default as any
          : undefined,
      }))),
    ])

    const Target = pageModule.default as ClassConstructor<SpacePageController>

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
