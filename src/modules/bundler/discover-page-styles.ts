import { dirname, resolve, toFileUrl } from '@std/path'
import type { StylesheetRef } from 'modules/render/css-manifest.ts'
import { scanPageFiles } from 'modules/router/scan-page-files.ts'

/** One page's own `static styles` entry, resolved to a real, on-disk CSS file — not yet an entry
 * name (that's `build-client.ts`'s own job, via the same `toEntryName` every other build entry
 * already goes through). */
export type DiscoveredPageStyle = {
  /** This page's own source file path, EXACTLY as `scanPageFiles` reported it for the SAME
   * `routesDir` value `loadRoutes()` itself will be called with — the identity `css-manifest.json`'s
   * `pages` scope is keyed by, and that `getPageTree(Target)?.filePath` resolves to at request time
   * (see `page-tree-registry.ts`'s own doc: "exactly as scanPageFiles reported it"). Deliberately
   * NOT realpath'd — unlike `resolvedCssPath` below, this value's only job is to match a STRING
   * another process (the real server) will independently produce from the same `routesDir`, not to
   * resolve a real file on disk itself.
   */
  pageFilePath: string
  /** This style entry's own CSS file, realpath'd — resolved relative to the PAGE FILE's own
   * directory (co-located, same convention a Comet's real `import './x.module.css'` already
   * resolves by), never relative to `root`/`routesDir` — deliberately different from `globalCss`'s
   * own root-relative resolution (`build-client.ts`'s own doc), since a page's `styles` are
   * declared inside that page's own file, not centrally in `space.app.ts`. */
  resolvedCssPath: string
  media?: string
}

/**
 * Discovers every page's own `static styles` declaration, reusing {@linkcode scanPageFiles} (the
 * exact same file-tree walk `loadRoutes()` itself uses) rather than a second, independent scan —
 * then IMPORTS each discovered page (native `import()`, the same mechanism `loadRoutes()` already
 * uses at server startup) to read its `styles` static field, since — unlike a Comet's `'use comet'`
 * directive — an arbitrary `StylesheetRef[]` class field genuinely can't be recovered from a plain
 * content scan.
 *
 * **Real consequence, not a new one**: importing a page module runs its `@Page()` decorator (a real
 * TC39 class decorator, evaluated at class-definition/import time), registering real
 * `Get`/`Post`/`SsrController` metadata into `@zanix/server`'s own composition-layer containers —
 * exactly the same side effect `loadRoutes()` already causes at REAL server startup, just now also
 * happening once during a BUILD. Safe in normal CLI usage (`zanix space build` and the deployed
 * server are separate processes with their own fresh module graphs — a build-time registration is
 * discarded when that process exits, never observed by anything); this codebase's own test suite
 * already tolerates many `@Page()`-decorated fixtures coexisting in one shared `deno test` process
 * (each keyed by its own unique route path), so this isn't a new category of risk this function
 * introduces.
 *
 * A page with no `styles` (the overwhelming majority) or an empty `styles` array contributes
 * nothing — this function's own cost only applies to a page that actually declares stylesheets of
 * its own.
 *
 * @param routesDir - Passed to `scanPageFiles` UNCHANGED (never resolved against a build's own
 * `root`, unlike `globalCss`/`assetsDir`) — deliberately, so `pageFilePath` above comes out in
 * EXACTLY the same shape `loadRoutes()` itself will produce for the SAME `routesDir` value at real
 * server startup. A real build script satisfies this simply by running from the same working
 * directory the deployed server also runs from (the same convention this whole framework already
 * assumes — `build-client.ts`'s own doc: production SSR runs directly against source, same tree,
 * same relative paths). A caller that genuinely needs `root` to differ from CWD (e.g. a test) can
 * still pass an ABSOLUTE `routesDir` — an absolute path resolves identically regardless of CWD, so
 * the same identity guarantee holds either way.
 */
export async function discoverPageStyles(
  routesDir: string | string[],
): Promise<DiscoveredPageStyle[]> {
  const pages = await scanPageFiles(routesDir)
  const discovered: DiscoveredPageStyle[] = []

  const perPage = await Promise.all(pages.map(async (page) => {
    const pageModule = await import(toFileUrl(resolve(page.filePath)).href) as {
      default?: { styles?: StylesheetRef[] }
    }
    const styles = pageModule.default?.styles
    if (!styles || styles.length === 0) return []

    const pageDir = dirname(page.filePath)
    // `Promise.all` over `styles.map(...)` (never a `for...of` with `await` inside) preserves this
    // page's own declaration order regardless of resolution timing — `Promise.all` always returns
    // results in the SAME order as its input array, whichever `Deno.realPath` call happens to
    // settle first.
    return await Promise.all(styles.map(async (stylesheet) => {
      const href = typeof stylesheet === 'string' ? stylesheet : stylesheet.href
      const media = typeof stylesheet === 'string' ? undefined : stylesheet.media
      return {
        pageFilePath: page.filePath,
        resolvedCssPath: await Deno.realPath(resolve(pageDir, href)),
        media,
      }
    }))
  }))

  for (const entries of perPage) discovered.push(...entries)
  return discovered
}
