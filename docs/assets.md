## Assets — static files, content-hashing, and image/video/audio optimization

This is the full reference the README's ["Assets"](../README.md#assets) section points to: serving
static files by a stable public path, opt-in content-hashing for production caching, and the whole
`@zanix/space/vite` optimization pipeline (image/SVG via `sharp`/`svgo`, video/thumbnail/voice-audio
via real system `ffmpeg`).

### Serving assets by a stable path

Static assets (images, fonts) a component/page references by a stable public path, served at
`/assets/<relative-path>`:

```ts
// space.app.ts
export default defineSpaceApp({ name: 'shop', assetsDir: './assets' })
```

```tsx
// any component — referenced by path, never by import (see below for why that distinction matters)
<img src='/assets/logo.svg' alt='Logo' />
```

`assetsDir` is resolved once, automatically, as part of this app's own `setup(ctx)` (same timing as
`routesDir`) — an author never scans or registers anything by hand. Omitted entirely by default: no
directory scanned, no route registered, zero cost — unlike `routesDir` (every app has pages, so it
defaults to `'./routes'`), not every app has assets beyond what Comets/`globalCss` already cover, so
this stays an explicit opt-in.

**Composing a host's own assets with a base app's — no new mechanism, same array precedent
`routesDir[]` already established**:

```ts
defineSpaceApp({
  name: 'shop-custom',
  assetsDir: ['./assets-override', './node_modules/@acme/shop-app/assets'],
})
```

First-match-wins by relative path: `assets-override/logo.svg`, if present, wins outright; any asset
the override doesn't declare falls back to the base app's own directory. Every file is resolved into
one precomputed `Map<relativePath, absolutePath>` — the ONLY source of truth for what actually gets
served, and served via a single route (`@zanix/server`'s own trailing catch-all,
`Get('/assets/:path*')`) that looks the requested path up directly against that Map, never
concatenating it against the filesystem — a path that was never actually resolved simply isn't a key
there and 404s like any other unmatched route. The exact same resolution/serving code runs in
`znx space dev` and production, with no separate build-time-only path to keep in sync.

### Content-hashed assets (`assetsPlugin`, `resolveAssetHref`)

Opt-in, on top of everything above — the stable `/assets/logo.svg` path keeps working exactly as
described whether or not you use this. `assetsPlugin` (`@zanix/space/vite`) hashes every file
`assetsDir` resolves during a real `zanix space build`, writing `assets-manifest.json`:

No `vite.config.ts` needed — `zanix space build`/`zanix space dev` never read one at all
(`configFile: false`, every option passed inline). `assetsPlugin` is composed internally from the
SAME `assetsDir` `defineSpaceApp` above already takes; an author never configures `assetsPlugin`
separately:

```ts
// main.ts, before activateApps()/bootstrapServers() — same convention as
// loadCssManifest/loadCometManifest/loadPwaBuildOutput
import { loadAssetsBuildOutput, loadAssetsManifest } from '@zanix/space'

await loadAssetsManifest('./dist/client/assets-manifest.json')
loadAssetsBuildOutput('./dist/client')
```

```tsx
import { resolveAssetHref } from '@zanix/space'

<img src={resolveAssetHref('logo.svg')} alt='Logo' />
```

`resolveAssetHref('logo.svg')` returns the real hashed URL (`/assets/logo-a1b2c3.svg`) when a
manifest was loaded, falling back to the stable `/assets/logo.svg` path otherwise (dev, no build
yet, or a path the manifest simply doesn't have) — never throws, never asserts the file exists.

**The serving route tries two independent lookups, in order**: a request is first checked directly
against the loaded build output directory — a hit there is served with
`Cache-Control: public, max-age=31536000, immutable` and a real `ETag` (the hash IS the filename,
genuinely free — no separate computation). A miss falls through to the original, unhashed lookup
above, with no special caching (that content could change without its stable URL changing, unlike
the hashed one). Content that's uniquely named by its own hash gets both `immutable` and a real
per-file `ETag` — there's nothing to revalidate against time when the URL can only ever point at one
byte sequence.

### Image/SVG optimization (`assetsPlugin({ optimize })`)

Opt-in, on top of everything above — omitting `optimize` entirely keeps `assetsPlugin`'s behavior
byte-for-byte unchanged. Real `sharp`/`svgo`-based optimization, build-time only — neither
dependency ever runs in the deployed server, same boundary `pwaPlugin`'s own `sharp` usage already
establishes:

```ts
// space.app.ts — the SAME `optimize` `assetsPlugin({ optimize })` takes, forwarded unchanged;
// only ever takes effect when `assetsDir` also resolves to something
export default defineSpaceApp({
  name: 'shop',
  assetsDir: './assets',
  optimize: {
    images: { breakpoints: ['msm', 'mlg', 'dlg'], formats: ['webp'] },
    svg: true,
    include: ['img/**'], // omit to optimize every eligible asset
  },
})
```

**The one rule every code path obeys: an optimized output only replaces, or gets added next to, its
reference when it is strictly smaller in bytes** — measured, never assumed. Equal-or-larger always
keeps the reference bytes exactly.

- **`images: true`** (no `breakpoints`/`formats`) — the only shape that touches the original key's
  own bytes: recompresses in place (same dimensions/format, metadata stripped by sharp's own default
  — no `.withMetadata()` call), replacing `logo.jpg`'s bytes only if strictly smaller.
- **`images: { breakpoints }`** — additive only, the original key is never touched. Each named
  preset (`thum`/`msm`/`mlg`/`dmd`/`dlg`, overridable via `quality`/`width`) or raw pixel width
  (`720`, under a `w720` key) resizes with `withoutEnlargement: true` (a small source never
  upscales) and is compared against the **global original** — emitted as `logo.msm.jpg` only if it
  wins.
- **`images: { formats }`** (no `breakpoints`) — each requested format (`webp`/`avif`/...) is
  encoded at the ORIGINAL dimensions and compared independently against the **global original** —
  `webp` is never compared against `avif`, only each against the source.
- **`images: { breakpoints, formats }`** — a three-tier reference: each breakpoint's own same-format
  resize is the reference its OWN requested formats are compared against — never the global
  original, never another breakpoint, never another format. `logo.msm.webp` must beat `logo.msm.jpg`
  specifically, not merely beat `logo.jpg`.
- **`svg: true`** — `svgo` (runs cleanly under Deno, no native binary needed), safe transforms only
  (strip dimensions/metadata/comments, minify inline styles/ids) — deliberately **not** a whole-app
  CSS-selector purge (a bigger, separate concern, out of scope for a build-time asset transform).
  Same in-place, same-key, strictly-smaller-or-kept rule as `images: true`.
  - **A `<symbol id="...">` — the sprite pattern one or more `<use href="other-file.svg#name">`
    elsewhere depend on — is protected from `cleanupIds` automatically, with no config needed, on
    every file, every time.** A `<symbol>` never renders on its own; svgo only ever analyzes ONE
    file at a time, so left unguided it can't tell an id referenced from a SEPARATE document is
    "used," and deletes it — confirmed empirically against a real 17-symbol icon sprite
    (`@zanix/space-ui`'s own `catalog.svg`): a bare `svg: true`, nothing else declared, already
    keeps all 17. This works by scanning each file's own raw source for every `<symbol id="...">`
    before svgo runs, and handing that exact list to svgo's own `cleanupIds` plugin as its
    documented `preserve: string[]` option — exempting exactly those ids from both removal and
    renaming. It's precise, not all-or-nothing: a genuinely-dead id on some OTHER, non-symbol
    element in the SAME file still gets cleaned normally.
  - **`svg: { preserveIds: string[] }`** — an object form, alongside the bare `true` above. Glob
    patterns (same matching as `include`, against the same relative path) naming FILES whose ids
    must ALL survive byte-for-byte, regardless of whether they belong to a `<symbol>` — a matching
    file skips `cleanupIds` **entirely** (not reconfigured — `remove: false` alone isn't enough,
    since `minify: true` would still rewrite each surviving id's own text). This is a supplementary
    escape hatch, not required for a `<symbol>`-based sprite (already safe by default, above) —
    reach for it for the rarer case of a NON-symbol id meant to be referenced externally, e.g. a
    plain element's id used only via a `clip-path: url(other-file.svg#id)` from outside:
    ```ts
    // space.app.ts
    defineSpaceApp({
      name: 'shop',
      assetsDir: './assets',
      optimize: {
        svg: { preserveIds: ['icons/**'] }, // every id in a matching file survives, symbol or not
      },
    })
    ```
    A file NOT matching any `preserveIds` pattern still gets its own `<symbol id>`s protected
    automatically (the bullet above), plus normal `cleanupIds` for everything else.
- **`include`** — glob patterns matched against the same relative path the manifest keys on;
  omitted, every eligible asset is considered; a file outside the filter (or with an unsupported
  extension) is always left completely untouched.
- **`useWorker`** — offloads the actual sharp/svgo work to a real worker pool (`@zanix/utils`'s own
  `WorkerManager`, already a dependency — no new one added) instead of the same thread the build
  already runs on. `true` sizes a pool to the detected CPU count, a `number` is an explicit pool
  size. Purely an execution strategy — produces the exact same emit/discard decisions as leaving it
  off (the default), verified directly rather than assumed.

Every generated variant is just another `assets-manifest.json` entry — resolved the exact same way
via `resolveAssetHref('logo.msm.jpg')`, no new runtime API. Composing variants into
`<picture>`/`srcset`/responsive-selection markup is deliberately left to the rendering layer (a
future `space-ui` component), not this plugin: variants are resolved by breakpoint NAME against a
`<picture>` + `<source media="...">` pattern, not a `srcset` `w`-descriptor/`sizes` one, so this
plugin never needs each variant's real pixel dimensions.

### Space media transformation — image, video, thumbnail, audio

The full picture:

```text
Asset Transformation API (createAssetTransformer)
├── image      — sharp, via assetsPlugin({ optimize: { images, svg } })
├── video      — real system ffmpeg, via mediaPlugin({ optimize: { video } })
├── thumbnail  — real system ffmpeg, via mediaPlugin({ optimize: { thumbnails } })
└── audio      — real system ffmpeg, via mediaPlugin({ optimize: { audio } })
     └── voice — the only implemented audio PROFILE today; music/podcast/... are real,
                  designed-for extension points, not yet implemented
```

Image/video/thumbnail are documented above and in `mediaPlugin`'s own doc
(`modules/bundler/media-plugin.ts`). **Audio today means voice/speech optimization specifically —
not a generic audio system.** `mediaPlugin({ optimize: { audio: { voice: {...} } } })`:

- **Formats**: `aac` (`.m4a` — the universal-compatibility fallback) and `opus` (`.opus` — the
  efficient, modern choice) — the two audio encoders already guaranteed by this framework's own
  ffmpeg provisioning (no new Docker requirement). Neither MP3, Vorbis, nor FLAC is supported — each
  was evaluated and deliberately excluded (see `modules/media/audio/policies/voice.ts`'s own doc for
  the real evidence behind each exclusion).
- **Bitrate**: a single fixed target, `128kbps` by default (`bitrateKbps` overridable per call) — no
  breakpoints, no CRF/CQ, no `maxrate`/`bufsize` (those are video-specific concepts that don't apply
  to a standalone audio file).
- **Input**: only `.wav` (uncompressed) sources are ever transcoded. An already-compressed lossy
  file (`.mp3`, `.m4a`, `.opus`, ...) already in `assetsDir` is left completely untouched, even with
  `audio.voice` configured — re-encoding an already-lossy file risks real quality loss for uncertain
  savings, a trade-off this framework never makes automatically.
- **Never-worsen**: pure byte-size comparison (never a perceptual/quality judgment, consistent with
  every other "never worsen" rule in this framework) — an encode that isn't strictly smaller than
  the source is discarded; the untouched original is published instead.
- **No silent fallback, ever**: an unsupported profile/format is a real, actionable error — never a
  quiet substitution.

`@zanix/space` never installs or downloads ffmpeg itself — see `@zanix/cli`'s own `deploy.md` for
how Docker provisions it (the SAME `aac`/`libopus` encoders `video`/`thumbnails` already require —
voice audio added zero new provisioning requirements).

### What's NOT covered by this mechanism

**An asset is only overridable if referenced by this stable public path** — never via a bare
`import logo from './logo.svg'` inside a component, which resolves through Vite's own module graph,
entirely independent of `assetsDir`'s own resolution. A component meant to be host-overridable must
reference its asset by path; module-aliasing for the `import` case is a different, bigger mechanism,
deliberately not built here.

**Case-sensitive, like a real filesystem**: `/assets/Logo.svg` and `/assets/logo.svg` resolve to
different files if both genuinely exist on disk — the catch-all preserves the request's own casing.

**Not this mechanism**: PWA icons/favicon — those stay under `pwaPlugin`/`registerPwa` (see the
README's own [PWA](../README.md#pwa) section), a separate, already-working pipeline for site
identity, not general component-referenced content. Module-aliasing for the `import`-based case
above is deliberately deferred — separate, future work if a real need appears, never assumed to
already work. Hashing/manifest for production caching is no longer deferred — see
[Content-hashed assets](#content-hashed-assets-assetsplugin-resolveassethref) above.

## See also

- [`README.md`](../README.md#assets) — the "Assets" section this guide is the full reference for.
- [`docs/theming.md`](./theming.md) — design tokens; a static counterpart to this document's own
  static-vs-optimized asset distinction.
