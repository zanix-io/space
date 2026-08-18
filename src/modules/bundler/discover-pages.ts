/**
 * One build-time pass over every page, producing everything a build needs to know about it
 * STATICALLY — its declared stylesheets, its resolved head, and what it says it is.
 *
 * Generalizes what used to be `discoverPageStyles`, which scanned and imported the same modules for
 * the sake of one field. Two consumers now read from a single pass: `build-client.ts` for CSS
 * entries, and document validation for everything else.
 *
 * **The boundary this module is careful about.** It reports only what is knowable without rendering,
 * and it never manufactures anything that belongs downstream. It does not build a `DocumentModel`
 * (that is a per-REQUEST value, assembled with a nonce, a theme, resolved loader data and the app's
 * runtime registries — none of which exist at build time), and it does not approximate
 * `DocumentSemantics` (that is extracted from real rendered HTML, and inventing one from
 * declarations would be a guess dressed up as a measurement). What it produces is the static slice
 * and nothing more; where a value genuinely cannot be known statically it says so — see
 * {@linkcode DiscoveredPage.headIsDynamic} — rather than supplying a plausible one.
 *
 * @module
 */
import { dirname, resolve, toFileUrl } from '@std/path'
import type { StylesheetRef } from 'modules/render/css-manifest.ts'
import type { HeadDescriptor, ResolvedHead } from 'modules/router/head-descriptor.ts'
import type { RedirectConfig } from 'typings/page.ts'
import { resolveHead } from 'modules/router/head-descriptor.ts'
import { scanPageFiles } from 'modules/router/scan-page-files.ts'

/** One page's own `static styles` entry, resolved to a real, on-disk CSS file. */
export type DiscoveredPageStyle = {
  /** This page's source file path, EXACTLY as `scanPageFiles` reported it for the SAME `routesDir`
   * value `loadRoutes()` will be called with — the identity `css-manifest.json`'s `pages` scope is
   * keyed by. Deliberately NOT realpath'd: its job is to match a string another process will
   * independently produce, not to resolve a file. */
  pageFilePath: string
  /** This entry's CSS file, realpath'd — resolved relative to the PAGE FILE's own directory. */
  resolvedCssPath: string
  media?: string
}

/** Everything one page contributes to a build, statically. */
export type DiscoveredPage = {
  /** Source path, as `scanPageFiles` reported it. */
  filePath: string
  /** Route path derived from the folder structure, e.g. `'products/:id'`. */
  routePath: string
  /** This page's own declared stylesheets, resolved. Empty for the overwhelming majority. */
  styles: DiscoveredPageStyle[]
  /**
   * The head resolved across this page's own declaration and every layout in its chain, through the
   * SAME `resolveHead` the renderers use. Never a second implementation: resolution has one
   * authority, and a build reading a different answer than a request would is precisely the class of
   * bug this avoids.
   */
  head: ResolvedHead
  /**
   * `true` when this page — or any layout in its chain — declares `head` as a FUNCTION of loader
   * data. The `head` above is then incomplete, because the missing part depends on data that does
   * not exist at build time.
   *
   * Reported rather than worked around. Calling the function with a fabricated argument would
   * produce a head this page will never actually have, and every rule reading it would be answering
   * a question about a document that does not exist.
   */
  headIsDynamic: boolean
  /** `true` when the page declares a `redirect` with no `condition` — it never renders a document. */
  hasUnconditionalRedirect: boolean
  /** Heads declared by layouts in this page's chain, each with its source path. Needed by rules
   * about WHERE a tag was declared, which stays knowable even when its VALUE does not. */
  layoutHeads: Array<{ filePath: string; head: HeadDescriptor }>
}

/** The static shape a page or layout module exposes, as far as this module reads it. */
type PageModuleShape = {
  default?: {
    styles?: StylesheetRef[]
    head?: HeadDescriptor | ((data: unknown) => HeadDescriptor)
    redirect?: RedirectConfig
  }
}

type LayoutModuleShape = {
  head?: HeadDescriptor | ((params: Record<string, string>) => HeadDescriptor)
}

/**
 * Imports a module by path. Split out so {@linkcode discoverPages} can be tested without a real
 * filesystem, and so the import strategy stays in one place.
 */
export type ModuleImporter = (filePath: string) => Promise<unknown>

const nativeImport: ModuleImporter = (filePath) => import(toFileUrl(resolve(filePath)).href)

/**
 * Discovers every page under `routesDir`, in one pass.
 *
 * **Real consequence, unchanged from before this module existed**: importing a page module runs its
 * `@Page()` decorator, registering route metadata into `@zanix/server`'s containers — the same side
 * effect `loadRoutes()` already causes at server startup, now also happening once during a build.
 * Safe in normal CLI usage, where the build and the deployed server are separate processes.
 *
 * @param routesDir - Passed to `scanPageFiles` UNCHANGED, so `filePath` comes out in exactly the
 * shape `loadRoutes()` will produce for the same value at server startup.
 * @param importModule - Overrides how modules are imported. Defaults to native dynamic `import()`.
 */
export async function discoverPages(
  routesDir: string | string[],
  importModule: ModuleImporter = nativeImport,
): Promise<DiscoveredPage[]> {
  const pages = await scanPageFiles(routesDir)
  // One import per file across the whole run, however many pages share a layout.
  const moduleCache = new Map<string, Promise<unknown>>()
  const importOnce = (filePath: string): Promise<unknown> => {
    let pending = moduleCache.get(filePath)
    if (!pending) {
      pending = importModule(filePath)
      moduleCache.set(filePath, pending)
    }
    return pending
  }

  return await Promise.all(pages.map(async (page): Promise<DiscoveredPage> => {
    const pageModule = await importOnce(page.filePath) as PageModuleShape
    const declaration = pageModule.default

    // --- styles ---------------------------------------------------------------------------------
    const pageDir = dirname(page.filePath)
    const styles = await Promise.all(
      (declaration?.styles ?? []).map(async (stylesheet) => ({
        pageFilePath: page.filePath,
        resolvedCssPath: await Deno.realPath(
          resolve(pageDir, typeof stylesheet === 'string' ? stylesheet : stylesheet.href),
        ),
        media: typeof stylesheet === 'string' ? undefined : stylesheet.media,
      })),
    )

    // --- head -----------------------------------------------------------------------------------
    let headIsDynamic = false
    const pageHead = declaration?.head
    if (typeof pageHead === 'function') headIsDynamic = true

    // Layout heads, nearest-first — the exact order `resolveHead` expects after the page's own.
    const layoutHeads: Array<{ filePath: string; head: HeadDescriptor }> = []
    const descriptors: Array<HeadDescriptor | undefined> = [
      typeof pageHead === 'function' ? undefined : pageHead,
    ]

    for (let index = page.segments.length - 1; index >= 0; index--) {
      const layoutFilePath = page.segments[index].layoutFilePath
      if (!layoutFilePath) continue
      // Sequential on purpose: this loop walks the chain from nearest layout to root, and the
      // order it pushes descriptors in IS the precedence `resolveHead` consumes. Parallelising it
      // would need the results reordered afterwards to mean the same thing, for no gain — every
      // import here is already served from `importOnce`'s cache whenever layouts are shared.
      // deno-lint-ignore no-await-in-loop
      const layoutModule = await importOnce(layoutFilePath) as LayoutModuleShape
      const layoutHead = layoutModule.head
      if (typeof layoutHead === 'function') {
        // A layout's head function takes `params`, which a build does not have either.
        headIsDynamic = true
        descriptors.push(undefined)
        continue
      }
      if (layoutHead === undefined) continue
      layoutHeads.push({ filePath: layoutFilePath, head: layoutHead })
      descriptors.push(layoutHead)
    }

    return {
      filePath: page.filePath,
      routePath: page.routePath,
      styles,
      head: resolveHead(descriptors),
      headIsDynamic,
      hasUnconditionalRedirect: declaration?.redirect !== undefined &&
        declaration.redirect.condition === undefined,
      layoutHeads,
    }
  }))
}

/** Every discovered page's styles, flattened — the shape `build-client.ts` consumes. */
export function collectPageStyles(pages: DiscoveredPage[]): DiscoveredPageStyle[] {
  return pages.flatMap((page) => page.styles)
}
