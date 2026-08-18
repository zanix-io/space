/**
 * The context a {@linkcode ThemeResolver} receives — `population` (the same segment/tenant id
 * `populationGuard`/`PageContext.population` already resolve, the natural axis to key branding
 * personalization on — see `populationGuard`'s own doc), `lang` (from this request's own `:lang`
 * route param, when this app follows the `routes/[lang]/...` convention `langPreHandler`
 * establishes — `undefined` for an app that doesn't), and the raw `request` for anything neither
 * of those covers.
 */
export type ThemeResolveContext = {
  population: string | undefined
  lang: string | undefined
  request: Request
}

/**
 * Resolves this request's own design-token overrides — a map of CSS custom-property names
 * (`--space-*`, by this package's own naming convention, though not enforced) to values, or
 * `undefined`/`{}` for "no override, the static tokens apply as-is." Registered once via
 * `defineSpaceApp({ theme: { resolve } })` — see that option's own doc (`typings/manifest.ts`)
 * for the full precedence chain and CSP implications.
 */
export type ThemeResolver = (ctx: ThemeResolveContext) => Record<string, string> | undefined

let themeResolver: ThemeResolver | undefined

/** Set once by `defineSpaceApp({ theme: { resolve } })`'s own `setup(ctx)` — not called directly. */
export function setThemeResolver(resolver: ThemeResolver | undefined): void {
  themeResolver = resolver
}

/** Read by `SpacePageController.handleGet`, once per request, to decide whether there's a theme
 * to resolve at all for this app. `undefined` when `defineSpaceApp` never declared `theme.resolve`
 * — the common case, and a real "off" state (never even a resolve call attempted), not just "an
 * empty result." */
export function getThemeResolver(): ThemeResolver | undefined {
  return themeResolver
}

/** Test-only — clears the registered resolver between tests. Not exported from this package's
 * public entry points. */
export function resetThemeResolver(): void {
  themeResolver = undefined
}
