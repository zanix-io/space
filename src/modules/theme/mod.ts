/**
 * Runtime, per-request design-token personalization — `defineSpaceApp({ theme: { resolve } })`
 * resolves a request's own `--space-*` custom-property overrides (keyed on `population`/`lang`/
 * `request`), injected as a nonced `<style>` block alongside the static `globalCss` convention
 * `docs/theming.md` already documents. App-wide only — no per-page override in this first version.
 *
 * @module
 */
export { getThemeResolver, setThemeResolver } from './theme-registry.ts'
export type { ThemeResolveContext, ThemeResolver } from './theme-registry.ts'
