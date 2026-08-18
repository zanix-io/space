import { dirname, join } from '@std/path'
import type { StylesheetRef } from '../render/css-manifest.ts'

/** Root-relative-ifies `path` (leading `./` stripped, leading `/` added if missing) and appends
 * `?direct` — the shared tail every dev-mode CSS href needs, regardless of what it was resolved
 * relative to. See `resolveDevCssHrefs`'s own doc for why `?direct` exists at all. */
function toDirectHref(path: string): string {
  const withoutLeadingDot = path.replace(/^\.\//, '') // 'x.css'/'src/x.css', from './x.css'
  const rootRelative = withoutLeadingDot.startsWith('/')
    ? withoutLeadingDot
    : `/${withoutLeadingDot}`
  return `${rootRelative}?direct`
}

/**
 * Resolves each of `paths` (an app's declared `SpaceAppConfig.globalCss`, source-file paths
 * relative to the project root — e.g. `'./styles/app.css'`, or `{href, media}` for a
 * media-conditioned entry) to the url `SpaceDevEngine`'s own `transformClientAsset` can serve raw,
 * transformed CSS from, for a server-rendered `<link rel="stylesheet">`. Appends `?direct` to the
 * `href` only, never to `media` — the same query `renderToResponse`'s dev client script relies on
 * being absent for a Comet's own `import './x.css'` (see `dev-client-script.ts`'s own doc for why
 * that distinction exists at all): a `<link>` needs raw CSS text back, never the JS module Vite's
 * client runtime would otherwise inject as a `<style>` tag itself.
 *
 * A pure, dev-only path transform — never touches the filesystem or Vite itself. Mirrors
 * `getCssManifest()`'s production shape (an ordered list of `StylesheetRef`) so a caller can treat
 * both the same way.
 */
export function resolveDevCssHrefs(paths: StylesheetRef[]): StylesheetRef[] {
  return paths.map((path) => {
    const href = typeof path === 'string' ? path : path.href
    const media = typeof path === 'string' ? undefined : path.media
    const resolvedHref = toDirectHref(href)
    return media === undefined ? resolvedHref : { href: resolvedHref, media }
  })
}

/**
 * Same transform as {@linkcode resolveDevCssHrefs}, but for a PAGE's own `static styles` — each
 * `href` resolves relative to `pageFilePath`'s own DIRECTORY, not the project root, matching how a
 * page author writes it (`'./product.css'` sitting next to that page's own `page.tsx`, the same
 * co-located convention a Comet's real `import './x.module.css'` already resolves by, via the
 * language's own relative-import semantics — this function is the manual equivalent for a bare
 * string path, which has no such built-in resolution). `pageFilePath` itself is never included in
 * the result; only its directory matters.
 *
 * A pure, dev-only path transform, same as {@linkcode resolveDevCssHrefs} — never touches the
 * filesystem, never realpath's anything; a page whose declared `styles` points at a file that
 * doesn't actually exist simply 404s at request time, the same failure mode any other dev-mode
 * `?direct` href already has.
 */
export function resolveDevPageCssHrefs(
  pageFilePath: string,
  paths: StylesheetRef[],
): StylesheetRef[] {
  const pageDir = dirname(pageFilePath)
  return paths.map((path) => {
    const href = typeof path === 'string' ? path : path.href
    const media = typeof path === 'string' ? undefined : path.media
    const resolvedHref = toDirectHref(join(pageDir, href))
    return media === undefined ? resolvedHref : { href: resolvedHref, media }
  })
}
