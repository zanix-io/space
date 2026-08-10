/**
 * Resolves each of `paths` (an app's declared `SpaceAppConfig.globalCss`, source-file paths
 * relative to the project root — e.g. `'./styles/app.css'`) to the url `SpaceDevEngine`'s own
 * `transformClientAsset` can serve raw, transformed CSS from, for a server-rendered
 * `<link rel="stylesheet">`. Appends `?direct` — the same query `renderToResponse`'s dev client
 * script relies on being absent for a Comet's own `import './x.css'` (see
 * `dev-client-script.ts`'s own doc for why that distinction exists at all): a `<link>` needs raw
 * CSS text back, never the JS module Vite's client runtime would otherwise inject as a `<style>`
 * tag itself.
 *
 * A pure, dev-only path transform — never touches the filesystem or Vite itself. Mirrors
 * `getCssManifest()`'s production shape (an ordered list of hrefs) so a caller can treat both the
 * same way.
 */
export function resolveDevCssHrefs(paths: string[]): string[] {
  return paths.map((path) => {
    const withoutLeadingDot = path.replace(/^\.\//, '') // 'x.css'/'src/x.css', from './x.css'
    const rootRelative = withoutLeadingDot.startsWith('/')
      ? withoutLeadingDot
      : `/${withoutLeadingDot}`
    return `${rootRelative}?direct`
  })
}
