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

### Responsive delivery: `media`, per-layout and per-page `styles`, and comet-scoped CSS

Every stylesheet Space delivers — global, per-layout, per-page, or a Comet's own `*.module.css` — is
a `StylesheetRef`: either a plain path/URL string, or `{ href, media }` for one that should carry a
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
registration beyond declaring the field.

**Per layout**, a named `styles` export in a `layout.tsx`, resolved relative to that layout's own
file, with the same entries as a page's `static styles` (a path string, or `{ href, media }`):

```tsx
// src/routes/chat/layout.tsx — every page under `chat/` links these, no page declares them
import type { StylesheetRef } from '@zanix/space'

export const styles: StylesheetRef[] = ['./chat.css', './chat-emoji.css']

export default function ChatLayout({ children }: { children: React.ReactNode }) {
  return <section data-area='chat'>{children}</section>
}
```

A layout's stylesheets link on every page whose composition chain contains that layout, and on no
page outside it: an app splits its CSS by area (a layout per area) instead of linking every area's
stylesheet on every page. They go through the same build as `globalCss` and a page's `styles` — one
hashed, minified file per entry, with any `@import` inlined — so a layout gets all of that for free.
A layout that declares no `styles` contributes nothing, and a `styles` that is not a list of
stylesheets is an error when the routes load, naming the layout. Fewer stylesheets per page also let
the page's module preloads follow them without delaying the first paint: see
["Preloading a comet's chunks"](./comets.md#preloading-a-comets-chunks-modulepreload).

The not-found page and the document a failing `loader` renders sit inside the app's **root** layout,
so they link the root layout's `styles` too.

**Why not a `<link>` in the layout's `head`?** A `head` link renders in the document and nowhere
else. It is a plain `href`: it never goes through the CSS pipeline (no hash, no minification, no
`@import` inlining, nothing in `css-manifest.json`), it is not part of an Orbit navigation fragment,
so a client-side navigation into the layout's area neither inserts it nor waits for it and the new
area appears unstyled, and its position among the other stylesheets is not the cascade order below
(React places it after the page's stylesheets, Preact before the global ones). Use `head` for the
`<link>` tags that are not your own stylesheets (`canonical`, `alternate`, icons, a font preload);
use `styles` for CSS.

**Per component**, a Comet's own `*.module.css` import is scoped automatically — no config, no field
to declare. `cssPlugin` correlates each Comet's build entry to the CSS it actually imports; a
Comet's stylesheet ships only on a page that renders that Comet, never globally — never swept into
one flat global list the way a naive `generateBundle` asset scan would, which would ship a Comet
used on one page out of fifty to all fifty.

All four levels render under the same cascade, in the same order: **global → layouts → page →
comet** — layouts from the root layout down to the page's nearest one, so a nearer layout can
override a farther one, the page can override its layouts, and a Comet's stylesheet can override the
page's, following ordinary CSS specificity rules (a heavier selector earlier still wins, same as CSS
always behaves). A stylesheet two of those levels both list links **once**, at its first position:
`href` is the identity, the same one the client uses to recognize a stylesheet already in the
document.

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
  layouts?: Record<string, StylesheetRef[]> // keyed by a layout's own file path
  pages?: Record<string, StylesheetRef[]> // keyed by a page's own file path
  comets?: Record<string, StylesheetRef[]> // keyed by a comet's own source URL
}
```

**Client-side navigation (Orbit)**: a navigation fragment carries the destination route's own
stylesheets (its layouts, the page, and any Comet it renders) inline as real `<link>` tags, never
`global`; the client dedupes against what the current document already has and inserts only what's
missing before completing the swap — navigating inside one layout requests nothing again, and
entering another area adds that area's layout stylesheets and waits for them — see
[`docs/orbit.md`](./orbit.md#css-during-navigation) for the full mechanism.

**Splitting a stylesheet with `@import`**: an entry that `@import`s other sheets (a `globalCss`
file, a page's or a layout's `styles` entry) is built into ONE stylesheet with the imports inlined,
rules in import order — the file the manifest lists is a single request, and its content hash
follows the imported files, so a change to any of them is a new URL. Splitting a large global
stylesheet into files by concern needs no extra request per file in production.

**`cssSources` and an explicit `globalCss`**: the app's declared `cssSources` (default styles a
package ships, as `iam` ships its screens') are built whoever calls `buildSpaceClient`. Without a
`globalCss` argument the build reads the app's own list, `getGlobalCssPaths()`, which already has
the materialized sources in front. With one, the build puts the sources in front of the caller's
list: an explicit `globalCss` replaces the app's own `globalCss`, never its `cssSources`. The order
is the one `zanix space dev` serves, so dev and production link the same stylesheets in the same
order and a package's defaults come before the app's rules, which override them by ordinary cascade:

```ts
// `iam` and `app-kit` ship cssSources; the app lists its own sheets
defineSpaceApp({ cssSources: [iamCssSource, appKitCssSource], globalCss: ['./theme/app.css'] })

// dev serves, and `css-manifest.json`'s `global` lists, in this order:
//   .space/css-sources/iam.css, .space/css-sources/app-kit.css, theme/app.css
await buildSpaceClient({ root }) // reads the app's list
await buildSpaceClient({ root, globalCss: ['./theme/app.css'] }) // the same three sheets
```

The merge is idempotent. A caller that read the list after the sources were files (and so already
names `./.space/css-sources/iam.css`) gets each sheet once, in the position it gave it; entries are
compared by the file they resolve to under `root`, so a relative path, a path without `./` and an
absolute one are the same stylesheet. A source that `@import`s other files is built like any other
entry, into one sheet with the imports inlined.

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
