## CSS — Tailwind, CSS Modules, vanilla-extract, and the build plugin

This is the full reference the README's ["CSS"](../README.md#css) section points to — the
`@zanix/space/vite` build mechanics (`cssPlugin`, `loadCssManifest`, typed CSS Modules) and a few
framework-authoring conventions that aren't specifically about design tokens (that's
[`docs/theming.md`](./theming.md)'s own job).

### Setup

Tailwind v4 and CSS Modules by default, vanilla-extract as an opt-in — all three resolve to 100%
static CSS at build time, the property that matters most for a streaming-SSR framework (no runtime
style injection to coordinate with content arriving out of order via Suspense):

No `vite.config.ts` needed — `zanix space build`/`zanix space dev` never read one at all
(`configFile: false`, every option passed inline) and compose `cssPlugin`/`cometPlugin`/
`spacePlugin` internally. Tailwind/CSS Modules/vanilla-extract are detected and built automatically;
the only setup left is loading the manifest the build wrote:

```ts
// main.ts — after activateApps(), before bootstrapServers(), same convention as loadCometManifest
import { loadCssManifest } from '@zanix/space'

await loadCssManifest('./.dist/client/css-manifest.json')
```

Set `defineSpaceApp({ clientBuildDir: './.dist/client' })` instead to skip this (and every other
production manifest load — Comets, client entry, assets, PWA, sitemap) entirely: `setup()` calls
`loadCssManifest` automatically from there, in production only (`znx space dev` never touches it).
See `SpaceAppConfig.clientBuildDir`'s own doc for the exact ordering and dev/prod split.

`cssPlugin()` writes `css-manifest.json` next to the client build's other assets, listing every
built stylesheet's real, hashed URL; `loadCssManifest` reads it back so a full-document response
links to it automatically (`<link rel="stylesheet">`, hoisted into `<head>` via React 19's own
resource hoisting regardless of whether the root layout or the default shell owns `<head>`) — an
Orbit fragment never repeats it, since its styles are already loaded on the page it swaps into. In
dev, `SpaceDevEngine` serves each declared stylesheet directly (a `?direct` suffix on its URL, no
manifest, no hashing) — same shape, same `<link>`, just no build step in between.

### Responsive delivery: `media`, per-page `styles`, and comet-scoped CSS

Every stylesheet Space delivers — global, per-page, or a Comet's own `*.module.css` — is a
`StylesheetRef`: either a plain path/URL string, or `{ href, media }` for one that should carry a
`media` attribute through to the rendered `<link>`:

```ts
export type StylesheetRef = string | { href: string; media?: string }
```

**Global**, via `defineSpaceApp`:

```ts
export default defineSpaceApp({
  globalCss: [
    './styles/base.css',
    { href: './styles/mobile.css', media: '(max-width: 599px)' },
  ],
})
```

Order matters — a later entry can override an earlier one, both in the source and in the built
`css-manifest.json`'s `global` list, which always preserves declaration order regardless of the
output filenames Vite/Rollup hash them to.

**Per page**, a `static styles` field on the page controller, resolved relative to that page's own
file (co-located, the same convention a Comet's `import './x.module.css'` already resolves by —
deliberately not root-relative, unlike `globalCss`):

```ts
class ProductPage extends SpacePageController {
  static override styles: StylesheetRef[] = [
    './product.css',
    { href: './product-mobile.css', media: '(max-width: 599px)' },
  ]
  // ...
}
```

Genuinely scoped: linked only on a response for that page, never on any other — discovered at build
time by importing the page module (the same pass `loadRoutes()` already does at startup), no manual
registration beyond declaring the field. Not yet composed with a layout's own `styles` (page →
layout → root inheritance) — only a page's own direct declaration resolves today.

**Per component**, a Comet's own `*.module.css` import is scoped automatically — no config, no field
to declare. `cssPlugin` correlates each Comet's build entry to the CSS it actually imports; a
Comet's stylesheet ships only on a page that renders that Comet, never globally — never swept into
one flat global list the way a naive `generateBundle` asset scan would, which would ship a Comet
used on one page out of fifty to all fifty.

All three levels render under the same cascade, in the same order: **global → page → comet** — a
page's stylesheet can override a global rule, a Comet's can override a page's, following ordinary
CSS specificity rules (a heavier selector earlier still wins, same as CSS always behaves).

**What `media` does and doesn't do**: a `<link media="...">` whose query doesn't match the current
viewport still downloads (the browser needs its CSSOM ready in case a resize/rotation makes it match
later) but does **not block rendering** and is fetched at lower priority. **`media` avoids
render-blocking — it does not reduce bytes transferred or requests made.** The bytes/requests
reduction comes from scope (comet/page CSS not shipping where it's never used), a separate,
orthogonal mechanism from `media`. Space doesn't ship a breakpoint preset (`sm`/`md`/`lg`, …) —
write the `media` query explicitly, or mirror whatever scale your app's CSS framework (Tailwind's,
typically) already uses.

**Manifest shape** (`css-manifest.json`, read back via `getCssManifest()`):

```ts
interface CssManifest {
  global: StylesheetRef[]
  pages?: Record<string, StylesheetRef[]> // keyed by a page's own file path
  comets?: Record<string, StylesheetRef[]> // keyed by a comet's own source URL
}
```

**Client-side navigation (Orbit)**: a navigation fragment carries the destination page's own
stylesheets (page + any Comet it renders) inline as real `<link>` tags; the client dedupes against
what the current document already has and inserts only what's missing before completing the swap —
see [`docs/orbit.md`](./orbit.md#css-during-navigation) for the full mechanism.

**Options** (all default to Tailwind + CSS Modules on, vanilla-extract off):

```ts
cssPlugin({ tailwind: true, modules: true, vanillaExtract: false })
```

`modules: false` disables the built-in `*.module.css` → JS class-map behavior app-wide — a
`.module.css` file becomes a plain side-effect CSS import at that point, same as any other
stylesheet, never a source of typed classes.

**Typed CSS Modules**: every `*.module.css` file gets a matching `*.module.css.d.ts` written next to
it (dev and build alike), so `import styles from './card.module.css'` is checked by `deno check`/CI
— a renamed or misspelled class is a real compile error, not a silently-dropped override.

### Design tokens and theming

Declaring/naming tokens, primitive vs. semantic, base → host precedence, light/dark, runtime
per-request personalization (`defineSpaceApp({ theme: { resolve } })`), and what a component
should/shouldn't do with a token are all covered in full in [`docs/theming.md`](./theming.md) —
start there for anything token-related. This document covers only the plugin mechanics above and the
framework-authoring conventions below.

**Recommended lint setup** (optional — not installed or enforced by this package):

```sh
npm install -D stylelint stylelint-config-standard stylelint-config-tailwindcss stylelint-declaration-strict-value
```

```js
// stylelint.config.js
export default {
  extends: ['stylelint-config-standard', 'stylelint-config-tailwindcss'],
  plugins: ['stylelint-declaration-strict-value'],
  rules: {
    'scale-unlimited/declaration-strict-value': [
      ['/color$/'],
      { ignoreValues: ['inherit', 'transparent', 'currentColor'] },
    ],
  },
}
```

That last rule rejects a raw color literal outside the `--space-*` token layer — verify
`stylelint-config-tailwindcss` against your exact Tailwind version before relying on it, it's a
third-party config, not maintained by Tailwind Labs itself.

### Styling the framework's own markup

`SpacePageController`'s Orbit outlet and every Comet boundary are already targetable with plain CSS
attribute selectors — `[data-space-outlet]`, `[data-comet]`, `[data-comet-strategy="visible"]` — no
override prop needed, a direct benefit of CSS being fully static, with no runtime class computation
to override. Both wrappers default to `display: contents` via a real, `nonce`'d `<style>` rule
emitted once in every full-document response — never an inline `style` attribute on the element
itself, which a strict `style-src` CSP (no `'unsafe-inline'`) silently drops — so they never break a
parent `display: grid`/`flex` layout by inserting an extra box. Override with more specific CSS
(normal cascade rules apply, since this is a real stylesheet rule, not an inline style) if a real
box is genuinely needed there.

**Fonts and other critical resources**: use `react-dom`'s own `preload`/`preinit`/`preconnect`
directly in a layout or page component — no framework-specific API needed, and verified to survive
`renderToResponse`'s own wrapper end-to-end:

```tsx
import { preload } from 'react-dom'

function RootLayout({ children }) {
  preload('/fonts/inter-var.woff2', {
    as: 'font',
    type: 'font/woff2',
    crossOrigin: 'anonymous',
  })
  return <html>...</html>
}
```

## See also

- [`README.md`](../README.md#css) — the "CSS" section this guide is the full reference for.
- [`docs/theming.md`](./theming.md) — design tokens and per-request theme resolution.
