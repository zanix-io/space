/**
 * The build's own entry point into document validation — the seam where discovery output becomes
 * validation input.
 *
 * Kept as its own module, and deliberately thin. It performs no checking of its own: every rule
 * lives in `modules/validation`, and everything this file does is assemble the static inputs those
 * rules expect. That separation is what keeps the build from quietly acquiring policy — a check
 * added here rather than in the catalog would have no code, no severity, no basis and no way for a
 * project to configure it.
 *
 * @module
 */
import { join } from '@std/path'
import type { PwaConfig } from 'typings/pwa.ts'
import type { Diagnostic } from 'modules/validation/mod.ts'
import type { StaticAppInput, StaticPageInput, ValidationConfig } from 'modules/validation/mod.ts'
import { validateDocuments } from 'modules/validation/mod.ts'
import type { DiscoveredPage } from './discover-pages.ts'

/** Options for {@linkcode validateBuild}. */
export type ValidateBuildOptions = {
  /** Every page, from `discoverPages` — the same single pass the CSS entries came from. */
  pages: DiscoveredPage[]
  /** Routes directory root(s), for locating the root layout. */
  routesDir: string | string[]
  /** `defineSpaceApp({ pwa })`, when configured. */
  pwa?: PwaConfig
  /**
   * Sitemap locations, when the app declares its sitemap as a literal ARRAY.
   *
   * Omitted for a function source, deliberately and not as an oversight: evaluating it would mean
   * running app code that may query a database, and doing so during a build to satisfy a
   * cross-check would be a surprising side effect. The rules that need it simply do not run — see
   * {@linkcode ValidateBuildResult.skipped}, which reports that rather than letting silence read as
   * a clean result.
   */
  sitemapLocations?: string[]
  /** Project validation configuration. */
  config?: ValidationConfig
}

/** What {@linkcode validateBuild} returns. */
export type ValidateBuildResult = {
  diagnostics: Diagnostic[]
  /**
   * Checks that could NOT run, and why.
   *
   * Reported explicitly because a validator that silently skips work reads exactly like one that
   * found nothing wrong. Anything bounded — a rule that needed data a build does not have, a source
   * that could not be read — says so here.
   */
  skipped: string[]
}

/** Reads the root layout's source, when there is one. Returns `undefined` rather than throwing for
 * an unreadable file: a missing root layout is the normal case, not an error. */
async function readRootLayout(
  routesDir: string | string[],
): Promise<{ filePath: string; source: string } | undefined> {
  for (const dir of Array.isArray(routesDir) ? routesDir : [routesDir]) {
    const filePath = join(dir, 'layout.tsx')
    try {
      // Sequential on purpose: first directory to declare a root layout wins, app-wide — the same
      // first-match rule `loadRoutes` applies. Reading a later directory's copy would be work for a
      // file this app has already decided not to use.
      // deno-lint-ignore no-await-in-loop
      return { filePath, source: await Deno.readTextFile(filePath) }
    } catch {
      continue
    }
  }
  return undefined
}

/**
 * Maps discovery output onto the validation module's static input.
 *
 * Written out field by field rather than relying on the two shapes being structurally compatible.
 * They are, today — but an implicit match means either side can change without the other noticing,
 * and this function is the one place that should fail to compile when they diverge.
 */
function toStaticPageInput(page: DiscoveredPage): StaticPageInput {
  return {
    filePath: page.filePath,
    routePath: page.routePath,
    head: page.head,
    headIsDynamic: page.headIsDynamic,
    hasUnconditionalRedirect: page.hasUnconditionalRedirect,
    layoutHeads: page.layoutHeads,
  }
}

/**
 * Runs static document validation for a build.
 *
 * @param options - See {@linkcode ValidateBuildOptions}.
 * @returns Diagnostics, plus an explicit account of anything that could not be checked.
 */
export async function validateBuild(
  options: ValidateBuildOptions,
): Promise<ValidateBuildResult> {
  const { pages, routesDir, pwa, sitemapLocations, config } = options
  const skipped: string[] = []

  const rootLayout = await readRootLayout(routesDir)

  const knownRoutes = pages.map((page) => page.routePath)
  const hasLangRoutes = knownRoutes.some((route) =>
    route === ':lang' || route.startsWith(':lang/') || route.includes('/:lang/') ||
    route.endsWith('/:lang')
  )

  if (sitemapLocations === undefined) {
    skipped.push(
      'Sitemap cross-checks (SEO004, SEO006): the app declares no sitemap, or declares it as a ' +
        'function whose evaluation a build will not trigger.',
    )
  }

  const dynamicHeadPages = pages.filter((page) => page.headIsDynamic)
  if (dynamicHeadPages.length > 0) {
    skipped.push(
      `Head content rules for ${dynamicHeadPages.length} route(s) whose head depends on loader ` +
        `data, which does not exist at build time: ${
          dynamicHeadPages.map((page) => page.routePath).join(', ')
        }.`,
    )
  }

  const app: StaticAppInput = {
    pwa,
    sitemapLocations,
    knownRoutes,
    rootLayout,
    hasLangRoutes,
  }

  return {
    diagnostics: validateDocuments(pages.map(toStaticPageInput), app, config),
    skipped,
  }
}
