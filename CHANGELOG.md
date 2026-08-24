# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/) and this project
adheres to [Semantic Versioning](http://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-08-24

### Added

- **Client-bundled code no longer imports the server `@zanix/logger` — `hydrate-comets.ts`/
  `hydrate-comets-preact.ts`/`comet-persistence.ts` now log through one shared browser-safe instance
  (`modules/client/client-logger.ts`, built via `@zanix/utils@3.1.0`'s new `createClientLogger`).**
  Previously, importing `@zanix/logger` in these files pulled `WorkerManager`/`Deno.readTextFile`
  into the client bundle — invisible at runtime (no thrown error, no console warning), but real dead
  weight in every app's shipped JS. This client logger POSTs each already-formatted log entry to a
  new backend relay, **`POST /api/log`** (`modules/log-api/`, `createLogApiController`), always
  registered as part of `defineSpaceApp`'s own `setup()` — core observability plumbing, not an
  opt-in `SpaceAppConfig` field, unlike `assetsApi`. The handler validates only `level`
  (`LoggerMethods`) and relays the rest of the body into the server's own `@zanix/logger` default
  instance via `Logger#ingest`, per `@zanix/utils`'s own documented relay contract — so a
  browser-originated log persists through whatever backend (file, Elasticsearch, a custom sink) the
  server's own logger is already configured with, with no separate wiring needed. No full auth on
  this route — the same genuinely-public posture `sitemap.xml`/`robots.txt` already establish, since
  the whole point is accepting a POST from any anonymous browser tab that ever loaded this app's
  client bundle — but it's not unguarded: see the new default `rateLimitGuard` entry below.
- **`POST /api/log` now forwards `data.origin` into `Logger#ingest`'s new `origin` parameter**
  (`ingest(type, origin = 'client', ...data)`, per `@zanix/utils`'s own updated contract) instead of
  relying on `Logger#ingest`'s previous, origin-less signature. `client-logger.ts`'s own `postLog`
  deliberately does NOT tag `origin` itself — this route's only real caller is always a browser
  client, so `Logger#ingest`'s own `'client'` default already covers it; the handler just passes
  `data.origin` through as `undefined` when absent, never resolving that default a second time
  itself. A caller relaying from somewhere else (not this package's own client) can still send an
  explicit `origin` to override it.
- **`POST /api/log` now has a mandatory default `rateLimitGuard`** (new `@zanix/auth` dependency,
  `createLogApiController`), replacing the previous "rate limiting is left to the app's own reverse
  proxy/CDN" stance — that framing had zero precedent anywhere else in the ecosystem and is now
  fixed at the source instead. Default: `anonymousLimit: 30` requests per `windowSeconds: 60`,
  `trustProxyHeader: true` (per-caller IP+User-Agent buckets, not one shared bucket) — a
  deliberately low, human-tab-sized budget ("poco límite"), sized well above real page-load/error
  telemetry but well short of meaningful storage write amplification from a runaway/abusive caller.
  Two new, DIFFERENT `SpaceAppConfig.logApi` knobs over this same default: `guards` lets an
  integrator append EXTRA guards after it — unlike `assetsApi.guards` (which replaces its
  `[denyAllGuard]` placeholder once configured), this default is the decided policy and is never
  replaceable via `guards`, only extended; `rateLimit`
  (`{ anonymousLimit?, windowSeconds?,
  trustProxyHeader? }`) is the real "change the floor"
  surface instead, for an app whose traffic profile or deployment topology (whether it genuinely
  sits behind a trusted reverse proxy) differs from the framework's own default — every field
  optional, falling back to the default above when omitted. `rateLimitGuard` itself needs a
  `'cache'` core provider registered in-process (typically via `import '@zanix/datamaster/core'` in
  the host app's own bootstrap, the same expectation `@zanix/admin`'s hub composition already
  documents); since `@zanix/space` deliberately never depends on `@zanix/datamaster` itself, an app
  that hasn't registered one gets this default guard failing OPEN (a one-time `warn` log, request
  allowed through unthrottled) rather than every relayed log turning into a `500` — confirmed
  empirically, not a hypothetical edge case.
- **New dependency: `@zanix/auth` (`jsr:@zanix/auth@^0.8.0`)** — a valid direct dependency per
  `zanix-dependency-direction`'s tier rules (domain infrastructure, the same tier `@zanix/admin`
  already depends on); only `rateLimitGuard` is used today, for `POST /api/log`'s new default guard
  above.
- **`@zanix/logger/client` alias** (`jsr:@zanix/utils@^3.1.2/logger/client`) added to `deno.jsonc`,
  alongside bumping the existing `@zanix/errors`/`@zanix/logger`/`@zanix/helpers`/`@zanix/workers`/
  `@zanix/validator`/`@zanix/types` aliases from `^3.0.3` to `^3.1.2` (same underlying package) —
  the first published release with `Logger#ingest`'s `origin` parameter and `createClientLogger`'s
  `disableGlobalAssign` default, both required by this change.

### Changed

- **BREAKING (pre-release, no known consumers): three framework-owned request headers renamed to the
  ecosystem-wide `X-Znx-` namespace** — `x-csrf-token` → `X-Znx-Csrf-Token` (`csrfGuard`'s default
  `headerName`, still customizable), `x-asset-filename` → `X-Znx-Asset-Filename`
  (`readUploadedAssetFromRequest`), `x-space-navigate` → `X-Znx-Space-Navigate`
  (`ORBIT_FRAGMENT_HEADER`, also the `Vary` value every Orbit-negotiated response sets). These were
  the only custom headers in the whole ecosystem outside that namespace, confirmed via a full
  12-repo audit — a client/proxy sending or matching the old literal names needs updating.

### Fixed

- **The published package no longer contains `/// <reference lib="dom" />` triple-slash directives**
  — JSR's own publish-time linter bans them, since they leak into a consuming project's own type
  environment. The nine `src/modules/client/*.ts` files that relied on this directive now get their
  DOM types from a scoped `compilerOptions.lib` override on a new `src/modules/client/deno.jsonc`
  instead — same types resolve for a consumer, only the mechanism changed. Kept out of the repo root
  config deliberately: applying it there would also hand every server-side file `document`/`window`
  as if they existed, masking a real bug (a server file referencing a browser-only global that
  should never type-check as if it could).
- **`LogIngestRTO`'s `data` field now validates correctly — previously, EVERY real `POST /api/log`
  request, even well-formed ones, failed with `400 BAD_REQUEST`
  (`"The 'data'
  property must be defined."`).** `@zanix/validator`'s own `@Expose()` "must be
  defined" check is keyed off the raw request body's OWN `data` property, which never exists as a
  literal top-level key on the wire — `data` is `LogIngestRTO`'s own constructor-computed
  rest-spread of "everything except `level`", not a field with a matching payload key. Never caught
  before because no functional/integration test had ever exercised this route over real HTTP (only
  direct RTO construction, which bypasses the validation decorators entirely). Fixed with
  `@Expose({ optional:
  true })`.
- **`langGuard`/`langPreHandler`/`populationGuard`'s cookies now include `Secure`** (built from
  `@zanix/utils`'s new `PUBLIC_COOKIE_ATTRIBUTES`, the client-readable counterpart to
  `SESSION_COOKIE_ATTRIBUTES`) — the only cookies in the ecosystem missing it, confirmed via the
  same 12-repo audit above. A browser could previously attach these cookies over a plain-HTTP
  connection.
- **`csrfGuard`/`langGuard`/`langPreHandler`/`populationGuard` now throw at construction
  (`@zanix/utils`'s new `assertZnxCookieName`) if a custom `cookieName` doesn't start with
  `X-Znx-`** — previously this was documented as a hard requirement but never enforced: a typo'd
  `cookieName` silently became invisible to `@zanix/server`'s `cookiesGuard` (or, for
  `langPreHandler`, just inconsistent with the ecosystem-wide naming convention) instead of failing
  loudly where the mistake was actually made. `csrfGuard` additionally requires the name contain
  `Csrf`, so a customized name stays recognized by `@zanix/utils`'s sensitive-key redaction pattern.
- `deno lint`'s own `@zanix/utils` plugin (`deno-zanix-plugin`) is now version-pinned (`^2.6.1`),
  matching every other `@zanix/utils` import in `deno.jsonc` — it used to resolve unpinned, so a
  lint run could silently pick up a newer, unreviewed plugin version.
- **`createLocalFilesystemAssetStorage` confines every `key` to `rootDir` before touching disk,**
  same fix and same reason as `@zanix/datamaster`'s `createLocalFilesystemObjectStorage` (routed
  through the shared `@zanix/helpers`'s `confinePath`) — `bytesPath`/`metaPath` used to join `key`
  straight onto `rootDir` with no containment check.
- **`AssetIdParamsRTO.id` (the `GET /assets/:id`, `/:id/status`, `/:id/download` route param) is
  validated as a real UUID (`@IsUUID`) instead of an unrestricted string.** `id` is always a
  `generateUUID()` value minted server-side by `AssetService` — rejecting anything else at the API
  boundary also closes off a path-traversal-shaped `id` (`../`, an absolute path) before it can
  reach `AssetStorage`, in addition to the containment fix above.
- **`csrfGuard`'s token cookie now includes `Secure`,** via `@zanix/helpers`'s new
  `SESSION_COOKIE_ATTRIBUTES` — the same constant `@zanix/auth`'s own session cookies now use, so
  the two can't drift apart. Without it, a browser would still attach the cookie over a plain-HTTP
  connection.
- **Closed the `ensureStylesheetsLoaded` coverage gap this file's own `[0.1.0]` entry below
  explicitly flagged as untested.** `@zanix/space-ui` had already established `happy-dom` (over
  `jsdom`, zero transitive dependencies) as this monorepo's answer to the same class of problem —
  real DOM mutation a plain string/object fixture can't reach — so this closes that gap with a
  working precedent one repo over, rather than leaving it deferred indefinitely. Not shared with
  `space-ui`'s own copy: `space-ui` depends on `@zanix/space` (importing the reverse would be
  circular), and its surface need (focus/keyboard/resize, for Menu/Slider/Modal) doesn't overlap
  with what `ensureStylesheetsLoaded` touches (`document.head`/`createElement`/a `<link>`'s own
  `load`/`error`) — its own narrow bootstrap lives in `src/@tests/unit/client/dom-test-setup.ts`
  instead. 9 new tests against a real `happy-dom` document: a missing stylesheet is inserted and
  resolves on `load`; `media` survives onto the real `<link>` (and is omitted when absent);
  declaration order is preserved across multiple inserts; a stylesheet already present ANYWHERE in
  the document (not just `<head>`) is never re-inserted and needs no event to resolve; `error`
  resolves the swap exactly like `load`; a stylesheet that never fires either still resolves via the
  4s timeout ceiling (a fake-timer helper, mirroring `space-ui`'s own `installTimerMock`); two
  overlapping requests for the same href never produce a duplicate `<link>`.
  `ensureStylesheetsLoaded` itself is now exported (only `swapOutlet` calls it in real client code)
  so the test can reach it directly.
- **`AssetService.createAsset()` now enforces a real, configurable per-kind upload size cap
  (`AssetServiceOptions.limits`, default 25MB image / 50MB audio / 200MB video).** Two layers: a
  fast reject against `UploadedAsset.size` (`Content-Length`) when the client sent one, followed by
  the real enforcement — `readBoundedBytes()` aborting the drain (`reader.cancel()`) the instant the
  cap is exceeded while buffering, which is what actually matters since `Content-Length` is optional
  (absent with chunked transfer-encoding) and client-controlled. Previously the upload stream was
  buffered whole into memory with no cap at all, regardless of what `Content-Length` claimed.
- **`runImageTransformation` now verifies the uploaded bytes actually match their declared
  `Content-Type`'s real file signature (jpeg/png/webp magic bytes, `magic-bytes.ts`), not just the
  client-supplied header.** Runs after the size cap above, on already-bounded bytes, before the
  bytes ever reach `sharp`/`transformImage`. Previously the jpeg/png/webp allowlist only checked the
  header — nothing verified the bytes genuinely were what the header claimed.

### Documentation

- **README's "CLI scaffolding" line no longer says "not yet implemented."** `zanix new space`/
  `zanix new spacecraft` (`@zanix/cli`) are real, tested commands — file-based routing, a Comet
  example, `--renderer`, and an opt-in `--icons` catalog — and have been for a while; the README had
  simply never been updated to say so.
- **Removed a stale "Not implemented yet" paragraph in the CSS/theming section that contradicted the
  paragraph immediately above it.** Runtime, per-request token personalization
  (`defineSpaceApp({ theme: { resolve } })`) is real and already fully documented there
  (sanitization, CSP, ETag folding) and in `docs/theming.md`; the removed paragraph was leftover
  text from before that feature existed, incorrectly claiming it was deferred pending the
  i18n/population subsystem.
- **README's PWA `space.app.ts` example used two fields (`iconsDir`, `swPath`) that don't exist on
  `PwaConfig`,** left over from before `loadPwaBuildOutput` replaced them, and was missing the
  type's actually-required `icon` field — as written it wouldn't type-check. Now shows the real
  `defineSpaceApp({ pwa: { icon } })` shape plus the separate `main.ts`-side `loadPwaBuildOutput`
  call `registerPwa` actually reads, matching the `loadCssManifest`/`loadCometManifest` convention
  the CSS/Comets sections already document correctly.
- **Closed six `deno doc --lint` gaps** (`AssetsOptimizeOptions`, `MediaOptimizeOptions`,
  `SsrModuleChangedEvent` now re-exported, type-only, from `mod.ts`; `DevClientScriptOptions` now
  re-exported, type-only, from `mod-react.ts`/`mod-preact.ts`) — each was already a real field on a
  documented public type (`SpaceAppConfig.optimize`/`.media`, `RenderToResponseOptions.devClient`/
  `RenderToResponsePreactOptions.devClient`) or parameter (`broadcastSsrModuleChanged`) without
  itself being public. Verified type-only (no new code edge into `modules/bundler/`) against the
  existing `dependency-boundary.test.ts` suite. `renderToResponse` (Preact)'s own reference to
  `preact`'s `VNode` is now called out as an accepted finding, same as `spacePlugin`'s/
  `cometPlugin`'s own `vite`-owned `Plugin`/`PluginOption`.
- **README split from 1690 to 604 lines**, past the ~600-line soft ceiling this ecosystem's own
  `docs-readme-audit` convention flags for a doc file. Eight new focused guides
  (`docs/{comets,orbit,middleware,i18n,css,assets,pwa}.md`) join the existing
  `docs/{theming,seo,validation}.md`, following the same pattern those three already established —
  README keeps a short teaser + working example per topic, the full contract moves to its own file.
  No content was dropped or altered in the move (verified: every internal link/anchor across
  README + `docs/*.md` still resolves); the "Current status" feature list and several sections
  (Not-found page, Head management, Document shell, SEO helpers) were also tightened in place — same
  facts, less restatement of what the section right below (or the linked guide) already says.
- **`setAssetsManifestState`'s own doc comment no longer claims it isn't exported from a public
  entry point.** `deno.jsonc`'s `./assets-manifest` subpath maps `assets-manifest.ts` directly, so
  this test-only escape hatch — unlike every sibling `set*`/`reset*` test hatch, each of which sits
  behind a curated barrel that omits it — really is reachable as `@zanix/space/assets-manifest`. No
  export or routing changed; the comment now says so and notes it's still not meant for production
  use.
- **New `docs/assets-api.md`** — the full reference for `@zanix/space/assets-api` (the Asset HTTP
  upload/transform/download API added earlier in this same `[Unreleased]` window:
  `createAssetService`/ `createAssetsController` composition, the deny-by-default `denyAllGuard`,
  the upload contract (`readUploadedAssetFromRequest`'s streaming/no-multipart shape), the
  `AssetLimits` size caps and magic-byte content verification fixed above, the `AssetStatus`
  lifecycle, and the storage/ repository adapters — including the structural-typing story for
  `@zanix/datamaster`'s `S3ObjectStorage`/`MongoFileRepository`, which this package never imports
  directly. Previously this subpath had JSDoc only, with zero coverage in `docs/` or the README;
  README's "Assets" section now links to it, disambiguated explicitly from the unrelated build-time
  pipeline `docs/assets.md` already documents.

### Changed

- **BREAKING — `@zanix/space` no longer ships a renderer: `@zanix/space/react` and
  `@zanix/space/preact` are now separate entry points.** Importing the framework never evaluates
  `react`, `react-dom/server` or `preact` any more — verified on the real import graph (0 value AND
  0 type edges from `.`, `./vite`, `./dev`, `./testing`) and by a real Preact SSR render in a
  subprocess where React is poisoned to throw on evaluation
  (`@tests/functional/render/renderer-isolation.test.ts`).

  Three eager React defaults caused the coupling and are gone: the page-renderer registry, the
  not-found-renderer registry and the Comet element factory. All three are now installed by
  whichever renderer entry point an app imports, symmetrically, through one seam
  (`router/renderer-runtime.ts`).

  **Migration** — add one import to the app's own main module, matching what it already declares:

  ```diff
  + import '@zanix/space/react'   // or '@zanix/space/preact'
    import { defineSpaceApp } from '@zanix/space'

    export default defineSpaceApp({ name: 'storefront' })
  ```

  `defineSpaceApp({ renderer })` remains the single source of truth for which renderer a project
  uses; the entry point supplies the implementation and the two are checked against each other at
  startup, so a mismatch (or a missing import) fails immediately with a message naming both. No
  renderer detection, no second configuration key.

  **Exports that moved** — from `@zanix/space` to `@zanix/space/react`: `renderToResponse`,
  `RenderToResponseOptions`, `RequestCacheProvider`, `useRequestCache`, `RequestCache`. They cannot
  be re-exported from `.` for compatibility: a value re-export recreates the very edge this change
  removes. The Preact serializer is now public too, as `@zanix/space/preact`'s own
  `renderToResponse` (previously internal).

  Everything else stays exactly where it was — `defineSpaceApp`, `SpacePageController`, `Page`,
  `loadRoutes`, `defineComet`, `createNotFoundHandler` and the whole document/SEO/PWA/i18n/
  middleware/validation surface are renderer-agnostic and unmoved.

  Calling `getPageRenderer()`/`getNotFoundRenderer()` with no entry point imported now throws an
  explicit `InternalError` naming the import to add, instead of silently rendering with React.

### Added

- **Voice audio optimization — the first real, implemented audio capability
  (`modules/media/audio/`), reached via `AssetTransformer.transformAudio()` and, at build time,
  `mediaPlugin({ optimize: { audio: { voice } } })`.** Preceded by a real audit (legacy `js`
  monorepo, `@zanix/cli`, real ffmpeg capability probing on both this dev machine and the exact
  Debian trixie build Docker provisions) that found no standalone-audio precedent anywhere in this
  codebase's own history — only an embedded VIDEO audio track (`MAX_AUDIO_BITRATE_KBPS`) and a
  legacy "copy `.mp3` verbatim, never transform" static-asset rule. Implemented once a concrete
  product mandate (voice/speech optimization, explicitly NOT a generic audio system) made the policy
  decision real rather than invented by analogy with video.
  - **`AssetKind` is no longer a 3-of-4-implemented type** — `'audio'` graduated from a typed-only
    extension point to a real kind. `ImplementedAssetKind` is now `= AssetKind` (all four);
    `isImplementedAssetKind` always returns `true`. `'audio'` itself is a FAMILY of profiles
    (`voice` today; `music`/`podcast`/... are real, designed-for extension points, not implemented)
    — `AudioTransformOptions` is a discriminated union on `profile`, so a future profile adds its
    own `policies/*.ts` module and one union member, never a change to `AssetTransformer`,
    `TransformCacheStore`, or `AssetManifestRegistry`.
  - **Policy (`modules/media/audio/policies/voice.ts`)**: `aac` (`.m4a`) and `opus` (`.opus`) — the
    two audio encoders already unconditional members of `ffmpeg-availability.ts`'s own
    `REQUIRED_ENCODERS` (baseline for video's audio track), so voice added **zero new Docker
    provisioning requirement**. MP3/Vorbis/FLAC deliberately excluded: a real encode-matrix
    benchmark (synthetic sine-tone and pink-noise fixtures) found no advantage over AAC at equal
    bitrate for MP3; Vorbis is confirmed absent from a common macOS/Homebrew ffmpeg build (the same
    dev/runtime inconsistency already solved once for WebP, not repeated here); FLAC is lossless,
    the wrong tool for a byte-reduction "optimize" use case. `VOICE_DEFAULT_BITRATE_KBPS
    = 128`
    — the SAME real number as the legacy video pipeline's own embedded-audio ceiling, re-approved as
    voice's own independent policy (not imported from `video-breakpoints.ts`) by explicit product
    decision. No breakpoints, no CRF/CQ, no `maxrate`/`bufsize` — video-specific concepts that don't
    apply. Sample rate/channels are never touched (no `-ar`/`-ac`); confirmed empirically that Opus
    always outputs 48kHz regardless of source (an intrinsic codec property, surfaced honestly in
    `AudioTranscodeResult.sampleRateHz`, never silently misreported) while channels are preserved by
    both codecs.
  - **Input scope, deliberately conservative**: only `.wav` (uncompressed) sources are transcoded —
    `isVoiceSource`. An already-lossy file already in `assetsDir` (`.mp3`, `.m4a`, `.opus`, ...)
    stays exactly what it already was: hashed and copied untouched by `assetsPlugin`'s existing
    fallback, even with `audio.voice` configured. Headerless `.pcm` is explicitly excluded (no
    self-describing sample rate/channels for `ffprobe` to read safely).
  - **Never-worsen — a real conflict with video's own precedent, surfaced and resolved, not silently
    invented**: video's never-worsen is scoped to same-container re-encodes only (its own doc: a
    cross-format conversion "has no valid 'original' to substitute... would produce a mislabeled,
    broken file"). Voice's transform is ALWAYS cross-format (`.wav` → `.m4a`/`.opus`), the exact
    scenario video's own doc warns about — resolved by applying that SAME principle:
    `system-ffmpeg-audio-transcoder.ts` still returns a valid file with the source's own honest
    mimeType/format when never-worsened, and `mediaPlugin` never publishes that outcome under the
    target's `.m4a`/`.opus`-named manifest key (the untouched original, already published
    unconditionally, is the correct representation). Byte-size comparison only, strictly `<` — never
    a percentage margin (no audio-specific legacy precedent for one).
  - **Cache: the same shared `TransformCacheStore`, no `AudioCache`.** Identity is
    `sha256(source) + "voice:<format>:b<bitrateKbps>" + VOICE_TRANSFORM_POLICY_VERSION` — the
    literal `voice:` prefix is what keeps a future `music:aac:b128` from ever colliding with this
    profile's own `voice:aac:b128`, same format and bitrate notwithstanding. `TransformCacheEntry`
    gained one small, purely-additive extension (`meta?: Record<string,
    unknown>`, opaque, never
    interpreted by the cache module itself) so a cache HIT can replay
    `sampleRateHz`/`channels`/`durationSeconds` without spawning a real `ffprobe` subprocess —
    preserving this whole cache system's own core guarantee (a hit costs zero real transformer/probe
    invocations, of any kind) that a naive "always re-probe the output" design would have quietly
    regressed. No other existing consumer (image, video, thumbnail) is affected.
  - **`mediaPlugin`'s own scan is fully opt-in**: a `.wav` is only ever considered when
    `optimize.audio` is present at all — omitted entirely, existing `.wav`/`.mp3` assets are
    completely unaffected, exactly as before this feature existed. Manifest key:
    `{base}.voice.{extension}` (mirrors `{base}.thumb.{extension}`'s own fixed-descriptor convention
    — audio has no breakpoint dimension). `audio.include` scopes voice sources independently of
    video's own top-level `include`.
  - 72 new tests across 4 layers (confirmed against the real before/after suite total: 1379 → 1451):
    unit (pure `voice.ts` policy functions, `ffprobe-audio.ts` parsing, `buildAudioTranscodeArgs`,
    isolated real-subprocess throw/passthrough/success/ never-worsen cases against a deterministic
    fake ffmpeg, the full cache hit/miss/corrupt/ policy-version/profile-collision matrix),
    integration (real ffmpeg WAV → AAC/Opus with real `ffprobe` verification, real never-worsen,
    real ffmpeg-failure handling, zero leaked temp files), and build (the official `znx space build`
    path: real voice variants, real idempotency via cache-blob mtime snapshots across two builds,
    image+video+audio coexisting in ONE shared manifest with no collision, `.wav` left untouched
    when `audio` is omitted).

- **Video-provider detection — `detectVideoSource`/`buildProviderEmbedUrl`
  (`modules/assets/video-source.ts`)** — a rescue of the legacy pipeline's own `getDataSource`, kept
  deliberately UI-agnostic so both this package and `@zanix/space-ui`'s new `Video` component share
  exactly one detection pass. `detectVideoSource(src)` classifies a string into a real discriminated
  union: `'provider'` (YouTube/Vimeo, with the video id already extracted), `'iframe'` (any other
  embeddable `http(s)` URL — Facebook/Instagram/Twitter/TikTok included, same outcome the legacy
  pipeline already reached for those four), `'file'` (a recognized video container, real
  `Content-Type` resolved via `content-type.ts`, now extended with the legacy pipeline's full
  container list), or `'unknown'`. `buildProviderEmbedUrl(source,
  options)` builds the real embed
  URL — options typed PER PROVIDER (`YoutubeEmbedOptions`/`VimeoEmbedOptions`), not one shared
  shape, fixing two real legacy bugs a shared shape had made possible: Vimeo's real embed parameter
  is `muted`, not YouTube's `mute` (the legacy sent `mute` for both, off one shared query template);
  YouTube only loops a _single_ video when `playlist=<id>` also accompanies `loop=1` (the legacy
  sent `loop=1` alone, which YouTube's player silently ignores). Passing a
  `'file'`/`'iframe'`/`'unknown'` source to `buildProviderEmbedUrl` is a compile-time error via
  overloads, never a runtime branch a caller has to remember to guard.
  - **`.m3u8` is explicitly `'unknown'`, never `'iframe'`** — checked before the generic-URL
    fallback specifically so an absolute `https://…/stream.m3u8` URL doesn't fall through to it. A
    raw HLS manifest is neither a playable file (`<video src="…m3u8">` only plays natively in
    Safari; this package ships no JS HLS player) nor an embeddable web page (an iframe would show
    garbled text or force a download) — `'unknown'` is the only classification that doesn't imply a
    playback path this package can't actually deliver. `.m3u8` is deliberately excluded from
    `content-type.ts`'s own table for the same reason: the legacy pipeline listed it as an input
    format but never actually implemented HLS segmentation behind it.
  - The generic-URL fallback (`'iframe'`) uses real `URL` parsing restricted to `http:`/`https:`,
    replacing the legacy `genericUrlType` regex — which, read literally, only matched `https:` (not
    `http:`) and never actually had a capturing group despite the legacy code trying to read
    `match[1]` off it. Confirmed empirically that `javascript:`/`data:`/`file:` and structurally
    invalid URLs all resolve to `'unknown'`, never `'iframe'`.
  - Exported from `.` (`mod.ts`) and from two new narrow subpaths, `./video-source` and
    `./assets-manifest` — added so a consumer that wants ONLY this (today: `@zanix/space-ui`'s own
    `Video`) never pulls in the full framework or the heavier build-time-only `sharp`/`svgo`
    dependencies `modules/assets/` also holds.
  - 50 new tests: the 6 legacy provider cases (YouTube ×3 URL forms, Vimeo, Facebook/Instagram/
    Twitter/TikTok all collapsing to `'iframe'`), the full legacy file-extension allowlist, the
    `mute`/`muted` and missing-`playlist` bug fixes, the `.m3u8`/scheme-restriction cases above, and
    the discriminated union's own compile-time narrowing.

- **React Compiler adoption, exclusive to `renderer: 'react'`, zero impact on `'preact'`** —
  `spacePlugin({ renderer: 'react' })` (the default) now always compiles through
  [React Compiler](https://react.dev/learn/react-compiler), via `@vitejs/plugin-react@6`'s own
  first-party `reactCompilerPreset()` integration (the documented replacement for the older
  `babel.plugins` option, which v6 dropped entirely alongside its move to Rolldown's native
  `oxc.jsx` transform). No opt-out flag — this reflects a real architectural decision, not just a
  deferred backlog item: RSC was evaluated and explicitly rejected (it doesn't fit the single
  `PageRenderer` seam both renderers share, and has no Preact equivalent at all), React Compiler was
  evaluated and adopted.
  - **Preact isolation, verified structurally, not assumed**: the `@rolldown/plugin-babel` import
    backing this is a dynamic `import()`, evaluated ONLY inside `space-plugin.ts`'s `'react'`
    ternary branch — for `renderer: 'preact'`, that `import()` is dead code, never reached, never
    evaluated. A real integration test builds the same comet shape under both renderers: the
    `'react'` build carries React Compiler's own `useMemoCache` runtime helper and a real
    per-component memo-cache-array pattern; the `'preact'` build has zero trace of
    `compiler-runtime`/`react-compiler`/`plugin-babel`, and doesn't even reference `'react'` at all.
  - **`spacePlugin()`'s own public return type widened from `Plugin[]` to `PluginOption[]`** (a
    strict superset, non-breaking for every existing caller) to carry that lazily-resolved
    `Promise<Plugin>` entry through unchanged — no caller needs to `await` anything, Vite resolves
    it internally during its own config-loading phase. The same widening was needed one level
    further at `createSpaceDevEngine`'s own `plugins` option, since `zanix space dev`'s real
    orchestration (`cli/src/commands/space/dev/command.ts`) feeds `spacePlugin()`'s result directly
    into it.
  - **SSR/streaming provably unaffected** — production SSR runs directly against source, never
    through this Vite/Rolldown pipeline at all (this package's own unbundled-server design); a
    dedicated regression test renders a page shaped exactly like the compiled comet fixture through
    the real (uncompiled) SSR path and confirms byte-correct output.
  - **Real Fast Refresh/HMR validated in a real browser** (Playwright + Chrome), in an isolated
    fixture reproducing only `space-plugin.ts`'s own `react()` +
    `babel({ presets:
    [reactCompilerPreset()] })` composition (no
    `@zanix/server`/`@zanix/app`/monorepo-local imports involved): a real component with
    `useState` + a derived value + an event handler renders correctly compiled, Fast Refresh detects
    a real on-disk edit, the module updates without breaking, React state is preserved exactly where
    React's own contract says it should be, the derived value recomputes correctly post-edit, and
    zero console/page errors reference React duplication, `compiler-runtime`, Babel/OXC, or Fast
    Refresh. Verified as a real, disposable spike (same convention already used for the original
    Preact renderer decision) — not a permanent Playwright dependency added to this package's own
    test suite.
  - **One separate, pre-existing gap explicitly NOT closed by this work**: a full `zanix space dev`
    session against this repo's own already-existing local cross-package dev configuration
    (`@zanix/server`: `../server/mod.ts`, unrelated to React Compiler) currently fails —
    `@deno/vite-plugin` resolves an entire SSR module graph against one flat import map, and
    `@zanix/server` has its own internal `modules/`-prefix convention identical in shape to Space's
    own, causing a collision. This would block `zanix space dev` today regardless of React Compiler;
    it is not evidence against this adoption, and fixing it is out of scope here.
- **Orbit navigation-time CSS (the final slice of the CSS delivery architecture)** — a client-side
  Orbit navigation now guarantees every stylesheet the destination page needs (its own `styles`, and
  any Comet's own CSS) is loaded BEFORE the visual swap completes, closing the one remaining FOUC
  risk this whole architecture's own design doc had flagged from the start: fragment responses used
  to omit page/Comet CSS entirely, relying on whatever the CURRENT document already had loaded.
  - **No new protocol, no parallel CSS endpoint, no client-side CSS registry** — investigated the
    real Orbit implementation first: the fragment response is HTML-only, with exactly one existing
    metadata channel (`<title>`, embedded in the body text and extracted client-side via
    `extractFragmentTitle`'s own regex) — and, critically, Orbit's own prefetch cache
    (`prefetch.ts`) stores ONLY the response body text, discarding headers entirely. A response
    header for CSS metadata would have silently broken for every prefetched navigation — ruled out
    for that reason, not by preference. The chosen design reuses the SAME body-embedding convention
    `<title>` already established: a destination page's own `styles` now render as real
    `<link rel="stylesheet">` elements directly in the fragment body (only in the `fragmentOnly`
    branch — a full document is completely unaffected). A Comet's own CSS needed ZERO server changes
    at all — `CometBoundary` already renders its own `<link>` unconditionally, regardless of
    full-document or fragment.
  - **One unified mechanism, not "page CSS" and "Comet CSS" handled separately**: SSR produces the
    real, final list of `<link>`s a destination needs (via the exact same `CssManifest`/
    `StylesheetRef` resolution a full SSR render already uses); the fragment simply contains them;
    Orbit's client discovers them, moves/dedupes the missing ones into `<head>`, waits, then swaps.
    New `extractStylesheetLinks()` (`modules/client/orbit.ts`) treats every
    `<link
    rel="stylesheet">` in a fragment identically, whether it came from a page's own
    `styles` or a Comet — a plain regex (the same convention `extractFragmentTitle` already
    established, DOM-free so it stays unit-testable without a browser), deduplicated by `href`
    within the fragment, order-preserving, robust to attribute order and to React/Preact not
    necessarily agreeing on self-closing void-element syntax.
  - New `ensureStylesheetsLoaded()` (`orbit.ts`) — awaited BEFORE `swapOutlet`'s own `swap` closure
    is even defined, so the swap never runs before every required stylesheet is ready. Extracted
    stylesheets are checked against `document.querySelectorAll('link[rel="stylesheet"]')` (the WHOLE
    document, not just `<head>` — a Preact full-document load can leave a Comet's own CSS inline in
    `<body>`, never hoisted, so `<head>`-only dedup would have missed it); missing ones are appended
    to `document.head` synchronously, in a plain loop (cascade order is never left to
    Promise-resolution timing), each preserving its own `media` attribute unchanged. Every extracted
    `<link>` is stripped from the swapped body — the outlet's own content never ends up carrying a
    stylesheet link of its own after the swap.
  - **Never blocks navigation indefinitely**: each newly-inserted stylesheet is awaited via `load`/
    `error`/a bounded timeout (4s) — whichever fires first — and the awaiting promise NEVER rejects,
    so a failed or slow-loading stylesheet degrades gracefully instead of hanging Orbit. The timeout
    exists specifically for the case neither `load` nor `error` ever fires at all — including any
    genuine cross-browser uncertainty around whether a `media`-mismatched `<link>`'s own `load`
    event behaves identically to a matching one (never assumed; this bound makes the answer
    irrelevant either way, since real cross-browser `<link>` load-event verification isn't something
    this environment can exercise — see the test-coverage note below).
  - **Safe for concurrent/overlapping navigations sharing the same missing stylesheet**: an
    in-flight tracker (`pendingStylesheetLoads`, cleared as soon as each stylesheet settles) lets a
    second overlapping navigation that needs the SAME missing href reuse the first one's real
    `<link>`/load-wait instead of inserting a duplicate — an ephemeral loading-state tracker, never
    a cache of "what CSS exists" (that stays the server's own manifest, exactly as this whole
    architecture already establishes for every other scope). Orbit's own pre-existing race behavior
    (whichever navigation's `swap()` call happens to execute last wins, independent of which one was
    clicked first) is unchanged in KIND by this — the new CSS-await step is simply one more
    variable-latency source feeding the SAME already-nondeterministic race, not a new failure mode.
  - **Real bug found and fixed while building this**: a destination page's own new `<link>` (no
    `precedence`) rendered AFTER a Comet's own resource-managed `<link>` (`precedence='space'`) in
    the final fragment HTML despite appearing BEFORE it in the JSX tree — React 19 flushes
    `precedence`-managed resources ahead of ordinary content regardless of tree position, even with
    no real `<head>` in a bare fragment render. Silently broke the global → page → comet cascade
    order this whole architecture promises. Fixed by giving the page's own fragment-only `<link>`
    the SAME `precedence='space'` a Comet's already carries — putting both on equal footing restores
    first-encounter order (page CSS, declared before the outlet, precedes any Comet's own, declared
    inside it). Preact needs no equivalent — it has no hoisting at all, so source order was already
    the final order there.
  - **Test coverage, and an explicit boundary**: 24 new tests — 11 unit (`extractStylesheetLinks`,
    fully DOM-free: destination page CSS, destination Comet CSS in the identical shape, both
    together in order, same-href dedup within one fragment, `media` preserved/omitted, declaration
    order, self-closing vs. non-self-closing tags, attribute-order robustness, a link with no
    `href`), 10 functional (React + Preact mirrored: a fragment carries the destination's own page
    CSS as real `<link>`s; a Comet's own CSS is unaffected and still present; both together,
    deduplicated and ordered correctly — each test also round-trips the SERVER's real fragment HTML
    through the CLIENT's real `extractStylesheetLinks`, closing the loop end-to-end without a
    browser; a page with no `styles` produces byte-identical fragments to before this
    navigation-time CSS work; a full document is completely unaffected for a page that HAS
    `styles`), plus updates to the existing `orbit.ts` unit suite. **`ensureStylesheetsLoaded`'s own
    DOM orchestration — actual `document.head` mutation, real `load`/`error`/timeout firing, dedup
    against the live DOM, `swapOutlet`'s full sequencing — is NOT covered by an automated test.**
    This project has no DOM-shim dependency anywhere — a deliberate infrastructure choice, out of
    scope to revisit here. That half was verified by code review against the real DOM/HTML APIs
    involved, matching the exact same, already-established boundary this project already draws
    around `onClick`/`swapOutlet`/`startViewTransition` — stated plainly rather than silently
    glossed over.
  - **CSS resolution architecture verification**: traced all four render paths (full-document ×
    React/Preact, `fragmentOnly` × React/Preact) to confirm a single CSS resolution source of truth
    — `resolveCssHrefs()` (global), `resolvePageCssHrefs()` (page), and `getCometCssHrefs()` (comet,
    called from exactly one place in the whole codebase, `CometBoundary`) are each called
    identically across all four paths; `HeadDescriptor`/`resolveHead()` never participates in CSS
    resolution at all — it's a separate, author-declared `{title, meta, link}` merge system that
    coincidentally shares `<link>` as its output element with the CSS delivery system, nothing more.
    Found and fixed one real (if minor) redundancy this same verification surfaced: React's
    full-document path called `resolvePageCssHrefs()` twice with identical arguments in the same
    function execution — Preact's own path already called it once and reused the result. Fixed to
    match; same output, one fewer redundant manifest/dev-path lookup per full-document React render.
- **Per-page CSS (a slice of the CSS delivery architecture)** — `SpacePageController` gains a new
  `static styles: StylesheetRef[]` field, resolved into every response for THAT page only — global
  CSS still applies everywhere, but a page's own `styles` are genuinely scoped: a stylesheet
  declared by page A is never linked when rendering page B. Cascade order is `global → page → comet`
  on every full-document response.
  ```ts
  class ProductPage extends SpacePageController {
    static override styles: StylesheetRef[] = [
      './product.css',
      { href: './product-mobile.css', media: '(max-width: 599px)' },
    ]
  }
  ```
  - Extends the SAME `CssManifest`/`StylesheetRef` architecture already established by earlier
    slices of this work — no new manifest, no new resolution mechanism. `CssManifest` gains a third
    scope, `pages?: Record<string, StylesheetRef[]>`, keyed by a page's own source `filePath` — the
    EXACT same identity `page-tree-registry.ts` already stores (`PageTree.filePath`, previously only
    used for the dev-client's hot-reload targeting) and that `getPageTree(Target)?.filePath` already
    reads at request time — no new identity scheme, no normalization needed (unlike a Comet's
    `file://` `sourceUrl`).
  - Build-time discovery reuses `scanPageFiles` directly — the SAME file-tree walk `loadRoutes()`
    itself already uses — never a second, independent scan. A new `discoverPageStyles()`
    (`modules/bundler/discover-page-styles.ts`) then imports each discovered page (the same
    mechanism `loadRoutes()` already uses at server startup) to read its `styles` static field,
    since an arbitrary array — unlike a Comet's `'use comet'` directive — genuinely can't be
    recovered from a plain content scan. `cssPlugin({pageEntries})` correlates each page's own CSS
    file to its real build output the SAME way `cometEntries`/`globalEntries` already do
    (`chunk.viteMetadata.importedCss`), grouped per page instead of flattened, preserving
    declaration order within each page.
  - **A page's own `styles` paths resolve relative to THAT page's own file** — co-located, the same
    convention a Comet's real `import './x.module.css'` already resolves by — deliberately different
    from `globalCss`'s own root-relative resolution, since these are declared inside the page's own
    file, not centrally in `space.app.ts`. Both build-time (`discoverPageStyles`) and dev-time
    (`resolveDevPageCssHrefs`, `modules/dev/dev-css-hrefs.ts`) resolve this the same way.
  - **Real bug found and fixed while building this**: `build-client.ts`'s own `toEntryName` helper
    didn't sanitize characters Vite/Rollup themselves sanitize internally when assigning a chunk's
    `name` (e.g. a dynamic-route folder's `[id]` becomes `_id_` in Rollup's own internal chunk name)
    — for any file path containing such characters, the ENTRY NAME `toEntryName` computed (used both
    as the `rollupOptions.input` key and as `cssPlugin`'s own later lookup) silently diverged from
    Rollup's real `chunk.name` for that same entry, so `cssPlugin`'s correlation loop never found a
    match and that page's CSS silently fell into the flat `global` scope instead of `pages` —
    confirmed via a real build against a `routes/products/[id]/page.tsx` fixture, not assumed.
    `toEntryName` now sanitizes to `[a-zA-Z0-9_-]` the same way Rollup does, fixing this for
    comets/`globalCss` too (neither had ever been exercised with such characters before this).
  - Rendering needed no new mechanism: `render-page-react.tsx`/`render-page-preact.ts` simply
    concatenate `resolveCssHrefs() ++ resolvePageCssHrefs(filePath, styles)` into the SAME
    `cssHrefs` list already passed to `renderToResponse`/`applyDocumentShell` — global-then-page
    ordering falls out of array order, and `→ comet` ordering falls out of document position (a
    Comet always renders later, in the body) — zero changes to the actual `<link>` rendering code in
    either renderer.
  - Not yet composed with a layout's own styles (page → layout → root inheritance) — deliberately
    out of scope for this first version, same as the design doc's own stated limit; not Orbit-aware
    yet either (that comes in a later slice).
  - 20 new tests: 6 unit (`discoverPageStyles` — declaration order, media, per-page isolation,
    empty/missing `styles`, identity matching `scanPageFiles`' own output), 2 integration
    (`cssPlugin` — real multi-entry builds proving `pageEntries` scoping and order; a page entry
    with no CSS contributes nothing), 2 integration (`buildSpaceClient` — the real end-to-end build,
    including the `[id]`-bracket regression fixture that found the `toEntryName` bug; a page with no
    `styles` writes no `pages` scope at all), 10 functional (5 React + 5 Preact, mirrored: page
    A/page B scope isolation with real SSR HTML; declaration order + `media` preserved in the real
    `<head>`; a page with no `styles` is byte-identical to before this per-page CSS work; global →
    page → comet cascade order confirmed in real rendered HTML for both renderers; dev mode resolves
    a page's own `styles` relative to that page's own directory).
- **Global CSS `media` + declaration-order fix (a slice of the CSS delivery architecture)** —
  `globalCss` entries now accept the SAME `StylesheetRef` shape already introduced
  (`string |
  {href, media?}`), and `css-manifest.json`'s `global` scope is now written in the
  EXACT order `globalCss` declared it, fixing a real, confirmed bug: the manifest used to be written
  in whatever order `Object.values(bundle)` yielded (alphabetical by hashed output filename),
  silently contradicting `globalCss`'s own documented "declaration order matters, later entries can
  override earlier ones" contract.
  - `defineSpaceApp({ globalCss: [{href: './mobile.css', media: '(max-width: 599px)'}, './base.css'] })`
    — a plain string entry is the byte-for-byte original contract; `media` is the same opaque,
    author-supplied string `StylesheetRef` already defined, never parsed/validated, no breakpoint
    presets/names introduced. `media` only ever affects render-blocking/applicability — it does not
    reduce bytes transferred; the browser still downloads a non-matching stylesheet, it just doesn't
    block first render on it. Real bytes/request savings come from SCOPE (per-page and per-comet
    CSS), never from `media` alone — a distinction this whole architecture deliberately never
    conflates.
  - `cssPlugin({ globalEntries })` (new option, wired automatically by `build-client.ts` from each
    `globalCss` entry — no app config needed) correlates each declared entry to its own build output
    the same way `cometEntries` already does (`chunk.viteMetadata.importedCss`), building `global`
    by walking `globalEntries` in order instead of sweeping the bundle — an entry's own `media`
    travels through into the manifest at the same time. Omitted entirely: `global` falls back to the
    original unordered sweep, byte-for-byte unchanged from before this option existed — a direct
    `cssPlugin()` caller that never passes it (or has none) sees no behavior change.
  - `resolveDevCssHrefs()` (dev mode) threads `media` through the same way, appending `?direct` to
    the `href` only, never to `media`.
  - Rendering already supported `StylesheetRef` end-to-end since the Comet-scoped CSS work
    (`render-to-response.tsx`/`document-shell-preact.ts` both already conditioned the `media`
    attribute on the ref shape) — this slice's own new tests are the first to actually exercise a
    `media`-carrying GLOBAL entry through both renderers, confirming real parity: React and Preact
    both emit `<link media="...">` identically, with no `precedence`-specific quirk for `media` the
    way an earlier slice found for `nonce`.
  - **CSP verified byte-identical** (nonce aside) whether or not a `globalCss` entry carries `media`
    — `style-src` governs origin/nonce, has no concept of `media`, confirmed with a dedicated test
    extending the same CSP-stability pattern established earlier in this work.
  - 12 new tests: 2 integration (`cssPlugin` — a real multi-entry Vite build proves `globalEntries`
    produces `manifest.global` in DECLARATION order with `media` threaded through; omitting
    `globalEntries` falls back to the original unordered sweep, unchanged), 1 integration
    (`buildSpaceClient` — the same order/`media` proof through the real production pipeline), 1
    functional (CSP byte-identical with/without `media`), 2 functional (`renderToResponse`/
    `render-page-preact` — a `{href, media}` entry renders its `media` attribute in React and in
    Preact; a plain string entry renders none), 2 unit (`resolveDevCssHrefs` threading `media`
    through the dev `?direct` transform, string/object entries mixing freely in order).
- **Comet-scoped CSS (the first slice of the CSS delivery architecture)** — fixes a real, confirmed
  bug: a Comet's own CSS Module (`import styles from './widget.module.css'` inside a `'use comet'`
  file) used to ship on **every** full-document response, whether or not that page actually rendered
  the Comet — proven with a real `buildSpaceClient()` build plus a real SSR render of a page that
  never used the Comet, not just inferred from reading `cssPlugin`'s own code. The fix scopes a
  Comet's CSS to follow the Comet itself: unused on a page → never linked; used → linked exactly
  where that Comet renders.
  - New `StylesheetRef` type (`string | { href: string; media?: string }`) — a plain string is the
    byte-for-byte pre-existing contract; the object form is strictly additive, carrying an opaque,
    author-supplied `media` string (never parsed/validated beyond `typeof === 'string'`, rendered as
    a normal JSX attribute — no injection surface). `CssManifest` changed from a flat `string[]` to
    `{ global: StylesheetRef[]; comets?: Record<string, StylesheetRef[]> }` — `global` is the
    direct, unchanged translation of `globalCss`; `comets`, keyed by the same source identity
    `comets-manifest.json` already uses, is that Comet's own CSS, resolved only via the new
    `getCometCssHrefs(sourceUrl)` at the exact point a Comet renders — never folded into `global`,
    never linked unconditionally.
  - `cssPlugin({ cometEntries })` (new option, wired automatically by `build-client.ts` — no app
    config needed) correlates each Comet's own forced build entry to its real, hashed CSS output via
    Vite's own `chunk.viteMetadata.importedCss`, claiming those filenames out of the flat sweep that
    used to populate `global` unconditionally. A Comet entry with no CSS of its own contributes
    nothing; an app with zero Comets writes no `comets` field at all — fully backward compatible.
  - `CometBoundary` (`define-comet.tsx`) renders its own resolved CSS `<link>`s inline, at the
    Comet's own tree position — React and Preact reach the same outcome through two genuinely
    different, deliberately NOT unified mechanisms, since React alone has native support for the
    first: **React** gives the link `precedence='space'`, and React 19's own resource hoisting/dedup
    — confirmed empirically, including for a Comet used twice on the same page, producing exactly
    one `<link>` in the real `<head>` — moves it there automatically, from any tree depth, with zero
    custom tracking needed. **Preact** has no such hoisting (confirmed absent, same finding this
    package's own `themeStyle` mechanism already documented) and renders fully synchronously with no
    way to inject into `<head>` after the fact, so its `<link>` renders exactly where declared, with
    no `precedence` prop (meaningless there) — an accepted, documented trade-off: a Comet used twice
    on the same Preact page repeats its own `<link>` rather than deduping (harmless — same URL, CSS
    re-application is idempotent).
  - `resolveCssHrefs()` stays strictly `global`-scoped, unaffected; `normalizeSourceKey`
    (`comet-manifest.ts`) is now exported so `css-manifest.ts` and `build-client.ts` share the exact
    same source-identity format `comets-manifest.json` already uses, guaranteeing the two manifests
    never drift into different keys for the same Comet.
  - 13 new tests: 2 integration (`cssPlugin` with real multi-entry Vite builds — a Comet-only CSS
    Module correlates under `manifest.comets` keyed by its own source identity while an unrelated
    global stylesheet stays in `manifest.global`; a Comet entry with no CSS of its own contributes
    nothing) and 11 functional (`defineComet`/`SpacePageController.handleGet`: a Comet's own CSS
    renders inline when present in the manifest; a Comet absent from `manifest.comets` renders no
    link at all, never a broken href; no manifest loaded renders no link, never throws; the object
    `StylesheetRef` form renders its `media` attribute, the string form renders none; comet CSS is
    never reachable via `resolveCssHrefs()`; `precedence='space'` is set under the default `react`
    renderer and omitted under `preact`; **the actual bug fix**, verified on two real pages sharing
    one production manifest — the page rendering the Comet links its CSS, the page that never
    renders it does not; a Comet used twice on one React full document produces exactly one `<link>`
    inside the real `<head>`; a manifest with no `comets` field at all — an app with zero Comets, or
    one built before this change — never throws and leaves `global` unaffected).
- **Runtime, per-request design-token personalization** (`defineSpaceApp({ theme: { resolve } })`) —
  the one thing `docs/theming.md`'s own static `globalCss`/`--space-*` token convention can't
  express: a token whose VALUE depends on which request is being served (e.g. per-tenant branding),
  not just on which app/host declared it. Layers on top of the existing static convention, never
  replaces it.
  - `resolve(ctx)` receives `{ population, lang, request }` for the current request — `population`
    is the same id `populationGuard`/`PageContext.population` already resolve (the natural axis to
    key branding on, same one `loadMessages()` already keys i18n content on); `lang` comes from this
    request's own `:lang` route param when this app follows the `routes/[lang]/...` convention,
    `undefined` otherwise. Returns `Record<string, string> | undefined` — `--space-*`
    custom-property overrides, or `undefined`/`{}` for "no override, the static tokens apply as-is."
    **App-wide only** in this first version — no per-page override.
  - Injected as a plain, nonced `<style nonce>` on every full-document response (never a
    fragment-only Orbit response — already in effect on the page it's swapping into, same reasoning
    as `cssHrefs`/`pwaHead`), positioned right after the static stylesheet `<link>`s so normal CSS
    cascade order lets it correctly override their own `:root` declarations. Deliberately NOT given
    a `precedence` prop the way `cssHrefs` is: confirmed empirically that React 19 silently drops a
    manually-set `nonce` prop on a `precedence`-managed `<style>` tag (it wants the nonce via
    `renderToReadableStream`'s own render option instead) — a real footgun avoided by using the same
    plain-`<style>`-with-explicit-nonce pattern this file's PWA service-worker script already uses.
    Preact support is genuinely parallel, not an afterthought: `DocumentHeadExtras`
    (`document-shell-preact.ts`) gained the same `themeStyle` field, rendered the same way (Preact
    has no hoisting at all, so placement in the tree IS the final position).
  - **`DEFAULT_CSP_DIRECTIVES` now includes `style-src` with the SAME nonce `script-src` already
    uses** — unconditionally, even for an app that never configures `theme` (an unused nonce
    permission is inert; `'self'` adds nothing `default-src 'self'` didn't already imply). A page or
    app supplying its OWN CSP (replacing the framework's default entirely, per the
    `Page explicit >
    Guard > Space default` precedence already established) must grant its own
    `style-src` + matching nonce for a resolved theme override to actually apply — the exact same
    disclosure already required of a custom policy that restricts `script-src`.
  - **Values are validated/escaped before interpolation, never trusted verbatim**: a token name must
    be a real custom-property name (`--foo-bar`); a value containing `;`/`{`/`}`/`<`/`>`/a
    backtick/CR/LF is dropped entirely (not escaped — simply excluded), closing every injection
    vector this module's own `:root{name:value;...}` serialization format is actually exposed to
    (declaration-smuggling via a bare `;`, rule-smuggling via `{`/`}`, and `<style>`-breakout via
    `<`/`>`/backtick). New `theme/theme-style.ts` (`sanitizeThemeTokens`/`serializeThemeStyle`) —
    small, dependency-free, no CSS parser needed for this narrow a surface.
  - **`computeEtag` gained an optional second `extra` parameter**, folded into the hash alongside
    `loader`'s own data — `SpacePageController.handleGet` passes this page's own `population`
    whenever `theme.resolve` is configured. Fixes a real, narrow gap: without it, two populations
    sharing identical `loader` data (a page whose CONTENT doesn't vary by population, only its
    resolved theme does) would collide on the exact same ETag, and a stale `304` could serve one
    population's resolved theme to another — a same-origin revalidation bug, not a caching-strategy
    question. **Deliberately narrow, does not change general caching semantics**: says nothing
    about, and does not attempt to fix, a SHARED cache (CDN/proxy) potentially serving one
    population's cached response to another BEFORE ever revalidating at all — that partitioning
    question is a separate, already-documented architectural boundary (`populationGuard`'s own doc:
    "nothing in `@zanix/space` itself assumes a shared cache exists today") and stays explicitly out
    of scope. `cacheControl` itself remains the page author's own explicit responsibility,
    completely unaffected for any page/app that never configures `theme.resolve` — verified by a
    dedicated regression test asserting the EXACT SAME ETag `computeEtag` always produced before
    this parameter existed.
  - Prefetch needs no theme-specific handling at all: a resolved theme is entirely an SSR-time
    concern (the `<style>` block is just more text inside whatever HTML gets cached/served), so
    Orbit's hover/viewport prefetch already behaves correctly by construction — verified by a
    dedicated test, not just asserted.
  - Investigated before designing anything: `docs/theming.md` already stated this exact gap
    explicitly ("Not implemented yet... would require an actual `population`/i18n-style subsystem
    this package doesn't have yet") — now that subsystem exists (`populationGuard`, shipped earlier
    this same roadmap), closing it. Also investigated whether `@zanix/space-ui` should ship a
    default BRANDED visual identity as part of this work (a precedent from the legacy component's
    own styling was raised) — found to be dead code there (never imported by any component, no
    `Theme` type anywhere), and a real reversal of `@zanix/space-ui`'s own explicit, already-stated
    headless design philosophy — deliberately NOT done here, a separate decision if it's ever
    wanted.
  - 42 new tests: 12 unit (`sanitizeThemeTokens`/`serializeThemeStyle`'s full validation matrix), 4
    unit (`theme-registry.ts`'s own set/get/reset round-trip), 3 unit (`computeEtag`'s new `extra`
    parameter: two populations sharing loader data get different ETags, the same population+theme
    stays stable, omitting `extra` is byte-for-byte identical to before this parameter existed), 9
    functional via real `handleGet()` calls (exact nonce equality between the `<style>` tag and the
    CSP header's `style-src`/`script-src` directives, with no `unsafe-inline` present, verified
    against the real HTML+header output rather than React's internal tree; the theme `<style>`
    renders after a real static stylesheet `<link>` in document order, so removing `precedence`
    introduces no cascade-order regression; `undefined` renders no `<style>` at all; two populations
    render two different themes; an unsafe resolver value never reaches the response raw; an Orbit
    fragment omits `themeStyle`; `cacheControl` + `theme.resolve` produces different ETags per
    population; `cacheControl` WITHOUT `theme.resolve` is completely unaffected), 3 functional
    Preact-specific (`DefaultDocumentShell` renders the nonced `<style>` in the right cascade
    position, omitting `themeStyle` renders no `<style>` at all, a custom root layout receives
    `themeStyle` via its own `headExtras` prop — real parity coverage, not just shared-code
    inference), and 2 unit (`defineSpaceApp` forwards `theme.resolve` into `setThemeResolver`
    eagerly, same timing as `headers`).
- **Orbit prefetch** (`initOrbit({ prefetch })`) — warms a link's fragment ahead of a click, so the
  real navigation often finds it already cached. Two independent triggers: `onHover`
  (`mouseenter`/`focusin`, debounced ~120ms, **on by default**) and `onViewport`
  (`IntersectionObserver`, **opt-in** — a lower-intent signal than hover, off by default to avoid
  aggressive prefetching during an ordinary scroll on a page with many links). `prefetch: false`
  disables it entirely.
  - Same eligibility rules as a real click (`data-orbit-hard`, same-origin, `target="_self"`, never
    a same-document hash-only link — factored into a new shared `resolveLinkInfo`/`findAnchor`
    module, `link-info.ts`, so `onClick` and every prefetch trigger can never drift apart on what
    counts as "the same kind of link"), plus a connection guard: never starts when
    `navigator.connection.saveData` is on or `effectiveType` is `'slow-2g'`/`'2g'` — a silent guard
    on the OPTIMIZATION only, never on real navigation (a click/`popstate` always proceeds
    regardless of connection quality).
  - **Deliberately isolated from navigation semantics**: `Map<href, Promise<string>>` cache,
    deduplicated per URL, TTL-bounded (20s — the only thing bounding staleness for a page without
    `cacheControl`; a page WITH `cacheControl` doesn't strictly need it, since the browser's own
    HTTP cache already revalidates via `ETag` for the same request), capped at 4 concurrent
    prefetches (a trigger past the cap is dropped silently — no queue, no retry), `AbortController`
    used ONLY to replace a stale entry for the same href (never triggered by `mouseleave`/`blur`/
    leaving the viewport — those only ever cancel a still-PENDING hover debounce timer, never an
    already-started fetch; structurally, `.abort()` is called from exactly one place in the whole
    module). `swapOutlet` only ever _consults_ this cache before falling back to the exact same
    fetch it always made — a prefetch that fails, expires, or was never attempted changes nothing
    about what a click does. **A failed prefetch is evicted from the cache immediately** (not left
    "fresh," and reusable, for the rest of its own TTL) — so a real click on a link whose prefetch
    already failed always gets a genuinely fresh, normal `fetch()` of its own, never a guaranteed
    replay of a failure that may have been transient. No existing cache/HTTP client in the Zanix
    ecosystem was reusable here: `@zanix/server`'s `RestClient` does ETag-revalidation caching, not
    TTL/dedup, and is server/Deno-only (`ZanixConnector`-based) regardless — this needed its own
    small, dependency-free, browser-safe cache.
  - Same `x-space-navigate` header a real navigation sends, so on a `cacheControl` page the
    browser's own HTTP cache can serve the real navigation from the very same entry the prefetch
    already warmed.
  - 23 new tests: 14 unit (`shouldPrefetch`'s full eligibility matrix, `isConnectionSlow`'s
    saveData/effectiveType matrix — both pure, DOM-free, mirroring `shouldInterceptNavigation`'s own
    testable-decision-function pattern) and 9 functional, against a real `Deno.serve()` (dedup to
    exactly one request, the real `ORBIT_FRAGMENT_HEADER` sent, the concurrency cap dropping a 5th
    href without ever fetching it, an expired entry already unreachable before any new schedule
    call, an expired entry then correctly triggering a real second request, a rejected entry evicted
    immediately rather than lingering for its own TTL, the same immediate eviction for a
    network-level failure — not just a non-2xx response, proving eviction is keyed on rejection — a
    failed prefetch rejecting rather than throwing synchronously, and an unscheduled href returning
    `undefined`). The DOM-dependent trigger wiring itself (`mouseenter`/`focusin`/
    `IntersectionObserver`) is untested directly, matching this project's own established convention
    for `onClick`/`swapOutlet` — no DOM-shim dependency added.
- **`SpaceAppConfig.assetsDir?: string | string[]`** — static assets (images, fonts) served at
  `/assets/<relative-path>`, resolved once in `setup(ctx)` (same timing as `routesDir`), an explicit
  opt-in (omitted entirely by default — no directory scanned, no route registered, zero cost, unlike
  `routesDir`'s own always-on `'./routes'` default). An array (`routesDir[]`'s own precedent) lets a
  HOST compose a base app's assets with its own override directory without forking either tree —
  first-match-wins by relative path, evaluated independently per file (no ancestor chain to keep
  from crossing directories, unlike a page's own nested layout chain).
  - Resolved into a single, precomputed `Map<relativePath, absolutePath>` (`scanAssets`) — the ONLY
    source of truth for what gets served; a path that was never actually resolved (including any
    attempted traversal) simply isn't a key there and 404s like any other unmatched route.
  - Served via ONE route, `@zanix/server`'s own new trailing catch-all (`Get('/assets/:path*')`, see
    that package's own CHANGELOG) — `ctx.payload.params.path` (case-preserved) is looked up DIRECTLY
    against the Map, never concatenated against the filesystem. The exact same resolution/serving
    code runs in `znx space dev` and production — no separate build-time-only path to keep in sync,
    unlike `globalCss`'s own dev/prod split.
  - **An asset is only overridable if referenced by this stable public path** (`/assets/logo.svg`) —
    never via a bare `import logo from './logo.svg'` (resolved by Vite's own module graph,
    independent of `assetsDir`). Module-aliasing for that case is explicitly out of scope.
  - PWA icons/favicon are explicitly out of scope too — still `pwaPlugin`/`registerPwa`'s own,
    separate, already-working pipeline; `assetsDir` is for general component-referenced content.
  - Explicitly NOT included (deliberately deferred, separate future task if ever needed): module
    aliasing for `import`-based assets. Hashing/manifest for production caching is no longer
    deferred — see `assetsPlugin` further below.
  - 27 new tests across `scan-assets.test.ts`, `asset-registry.test.ts`,
    `define-space-app.test.tsx`, and a new `functional/assets/assets-serving.test.tsx` — covering
    base + host override + fallback, multiple directories, nested levels, case-sensitive names, 404,
    backward compatibility, dev/prod consistency, and a real end-to-end scenario where a
    page/component's own unchanged `<img src="/assets/logo.svg">` resolves to whichever file
    `assetsDir`'s own composition currently resolves — proving the override never touches the page
    or component.

- **`SpaceAppConfig.routesDir` accepts `string | string[]`** — lets a host compose a base app's
  pages with its own override directory (or several) without forking either tree, mirroring
  `@zanix/core`'s own `rootDir: string[]`. Two distinct resolution rules: pages resolve
  first-match-wins by route path across `routesDir`'s own order; `layout.tsx`/`not-found.tsx`
  directly at a directory's root are whole-app singletons, resolved once — first directory to
  declare either wins, app-wide. A page's own nested `layout.tsx`/`error.tsx`/`loading.tsx` chain is
  always resolved entirely within the SAME directory that provided that page — never completed by
  reaching into a different `routesDir` entry for a missing ancestor, avoiding "Frankenstein pages"
  assembled from mismatched directories. A single `string` (the default, `'./routes'`) behaves
  exactly as before this array support existed.
- **`addGlobalCssPaths(paths)`** (`.`, `./render`) — appends to the process-wide `globalCss` list
  instead of replacing it, and is now what `defineSpaceApp({ globalCss })` itself calls internally
  (previously `setGlobalCssPaths`, a hard replace). Lets a HOST compose a base app's own `globalCss`
  automatically: if the base app's own `defineSpaceApp()` call executes first, its stylesheets
  already occupy the front of the list by the time a host's own customization app's
  `defineSpaceApp
  ({ globalCss: [...] })` call appends its own — `['./base.css']` then
  `['./custom.css']` composes to `['./base.css', './custom.css']`, with neither app referencing the
  other's file paths. Order is simply WHEN each `defineSpaceApp()` call executes, same "declaration
  order wins" principle `activateApps()`'s own `onStart` sequencing already follows.
  `setGlobalCssPaths` itself is unchanged — still an exact hard replace/reset, for tests or an
  advanced caller that genuinely wants to discard whatever was accumulated.
- **`populationGuard`** (`.`) — resolves which population (segment/tenant content variant) a request
  is for: route param, then query string, then a persisted `X-Znx-Population` cookie, in that order,
  exposed as `ctx.population` inside `loader`. Resolved **on the server**, not just the client —
  deliberately, since a client-side-only fallback would reintroduce the flash-of-wrong- content
  problem `@zanix/space`'s SSR-first design otherwise avoids. Purely additive (never rejects a
  request), so — unlike `csrfGuard` — safe to apply globally via `defineMiddleware`. Sets the cookie
  (not `HttpOnly`; client code is expected to read it too) when the value came from the param/query
  and doesn't already match it, closing a real gap in the legacy component this replaces: there,
  nothing ever wrote the cookie its own read side depended on.
- **`langPreHandler`** (`.`) — a `PreHandler` (`@zanix/server`'s pre-route-matching hook, not a
  guard — guards only ever run after a route has already matched) that 301-redirects a request
  missing its canonical `/{lang}/...` prefix, resolved from a persisted cookie, then
  `Accept-Language`, then a configured `defaultLang`. Every route is expected to live under a
  uniform `routes/[lang]/...` convention — no per-route opt-out, simpler than the legacy mechanism
  this replaces (which tracked "missing language segment" and "invalid language segment" as two
  separate cases with different redirect codes; this collapses both into one check). Never redirects
  a framework-internal route (`/health`, `/ready`, `/assets/`, `/icons/`, `/manifest.webmanifest`,
  `/sw.js`); `ignorePrefixes` extends that list. The redirect also sets the resolution to a cookie
  (`X-Znx-Lang` by default, configurable via `cookieName`) so a later visit to another un-prefixed
  URL honors the same choice without re-resolving `Accept-Language` — pair it with `langGuard` (see
  below) to also keep that cookie fresh while browsing entirely under an already-prefixed URL, which
  this `PreHandler` alone structurally can't do (it only ever runs before route matching, and can
  only return a full `Response` or `null` — no way to attach a header to a response it isn't
  building).
- **`langGuard`** (`.`) — the companion `MiddlewareGuard` to `langPreHandler`, for the one case that
  `PreHandler` can't cover itself: a request that's already correctly prefixed (`/es/products`)
  never goes through a redirect at all, so `langPreHandler` never gets a chance to refresh a stale
  cookie from an earlier visit. Guards run AFTER route matching and CAN merge `headers` into the
  eventual response — `langGuard` reads the language back out of the matched route's own `:lang`
  param and, when it differs from the persisted cookie, re-issues `Set-Cookie`. Purely additive,
  same as `populationGuard`; opt in via `@Guard(langGuard())` or `defineMiddleware([langGuard()])`.
  Requires `@zanix/server >= 3.2.0` — closing this gap surfaced a real bug in `mainGuard`'s own
  header accumulation (see that package's own CHANGELOG: two guards returning the same header used
  to silently clobber each other via a plain object spread, which would have broken
  `populationGuard` and `langGuard` coexisting on the same route).
- **`loadMessages`** (`.`) + **`SpaceAppConfig.messagesDir?: string | string[]`** — the content-
  resolution half of i18n: given a `(lang, population)` pair, resolves a flat message catalog —
  `{messagesDir}/{lang}/index.json` (base) shallow-merged with
  `{messagesDir}/{lang}/populations/{population}.json` (override), cached for the process lifetime.
  Ports the legacy component's real pattern (flat catalogs, shallow override merge, module-lifetime
  cache) deliberately WITHOUT its `react-intl` coupling — returns a plain `Record<string, string>`;
  formatting is entirely the consuming app's own concern. `messagesDir` is stored as-is by
  `defineSpaceApp()`'s own `setup()` (same timing as `assetsDir`/`routesDir`) — unlike `assetsDir`,
  resolution itself is lazy, per `(lang, population)` key, not an eager directory scan, since a
  message catalog has a small, bounded key space instead of an assets route's arbitrary request
  path. Accepts an array, same `routesDir`/`assetsDir` host-composition precedent, resolved
  independently for the base file and the override file.
  - Real, verified fixes over the legacy pattern (confirmed by reading its actual source, not
    assumed): the base and override files are now read and validated INDEPENDENTLY — a malformed
    override degrades to base-only instead of discarding an otherwise-valid base render (the legacy
    wrapped both in one try/catch); the cache key is an explicit `${lang}:${population ?? ''}`
    composite instead of bare string concatenation (`lang + population`, which only worked because
    the legacy's language codes were a fixed-width union); a missing/malformed catalog always
    resolves to `{}` (never `undefined`, unlike the legacy's inconsistent return shape across its
    sync/async implementations); and concurrent calls for the same not-yet-cached key now share a
    single in-flight resolution instead of each independently redoing the same file I/O (the legacy
    had no de-duplication at all); and the cache is now automatically bypassed under `znx space dev`
    (`isDevClientEnabled()`) — an edited message file is reflected on the very next request, no
    restart needed, the same live-edit story `assetsDir` already gives. This closes what the legacy
    only half-built: its equivalent (`refresh: true`) was fully plumbed through `IntlRequest` but
    never actually triggered by anything in that repo — dead code, presumably meant to be driven by
    an external CLI's watch-mode HTTP layer that never shipped. Here it's automatic and driven by
    the same dev-mode flag every other Space dev-time behavior already reads, not an opt-in flag a
    caller has to remember to pass.
  - Deliberately deferred, not ported: a secondary "lazy content" tier fetched after first paint.
    That tier existed in the legacy to solve a problem specific to a CSR-first app bolting SSR on —
    `@zanix/space` is SSR-first, so a page's `loader` already embeds whatever it calls
    `loadMessages()` for in the initial serialized state; there's no post-hydration gap to fill the
    same way. A Comet fetching its own subset on hydration is the natural fit if a real page ever
    needs this, not a bespoke fetch layer copied from the legacy.
  - 23 new tests: 15 in `load-messages.test.ts` (including dev-mode cache bypass and its interaction
    with in-flight de-duplication), 4 in `messages-registry.test.ts`, 3 `defineSpaceApp` wiring
    tests, and 1 functional end-to-end test — covering base/override resolution, independent error
    handling per file, cache reuse, concurrent de-duplication, dev-mode bypass, and `messagesDir[]`
    composition.
- **`getMessagesDir`** (`.`) — public read-back of `defineSpaceApp({ messagesDir })`'s own value,
  same `getGlobalCssPaths`/`getPwaConfig` precedent: an external orchestrator that only imports a
  project's `space.app.ts` manifest (`zanix space build`, which never calls `activateApps()`) can
  now locate the configured directory to compile it — `@zanix/cli`'s own `writeCompiledMessagesTree`
  is the first real consumer. `@zanix/space` itself still never inspects a catalog's own content;
  this only exposes the path string a project already declared.
  - **Fix, not just an addition**: `messagesDir` used to be stored inside `defineSpaceApp()`'s own
    `setup()` — the same composition scope `assetsDir`'s directory SCAN runs in, but unlike
    `assetsDir`'s own PATH (`setAssetsDirConfig`, already eager for exactly this reason),
    `messagesDir`'s path was never split out. That meant `getMessagesDir()` returned `undefined` for
    any orchestrator that imports the manifest without calling `activateApps()` — invisible to
    `zanix space build` specifically, the one thing that needed it. Moved to the same eager point
    `assetsDir`'s own path already uses; `loadMessages()`'s own resolution timing is completely
    unaffected — still per-`(lang, population)` key, on first access, never eager.
  - 4 new tests in `define-space-app.test.tsx` covering the eager timing directly (readable
    immediately after `defineSpaceApp()` returns, before `setup()` ever runs, for both a single
    string and an array), plus that omitting `messagesDir` still never touches the registry.
- **Head management** (`SpacePageController.head`, a `layout.tsx`'s own named `head` export,
  `resolveHead`/`HeadDescriptor`/`HeadLinkTag`/`HeadMetaTag`) — the first iteration of this
  package's own `<title>`/`<meta>`/`<link>` resolution: `title`/`meta`/`link` only, `style`/`script`
  deliberately deferred until a real use case exists. Every descriptor in a page's composition chain
  (the page's own `head`, then each `layout.tsx` from nearest to root) merges into one final,
  deterministic result — resolved as plain data BEFORE either renderer renders anything, the same
  timing `loader` already resolves data at. Precedence: page wins over its nearest layout, which
  wins over the next one out, checked field-by-field (`title`)/per-identity-key (`meta`/`link`),
  never whole-descriptor-replaces-whole-descriptor. Deduplication: `meta` by identity key (`name`/
  `property`/`httpEquiv`, whichever is set — a tag with none of the three is never deduplicated
  against another); `link` by `rel`+`href` (see the Fixed entry below for why `hreflang` also
  matters here).
  - **Coexists with a hand-authored JSX `<title>`/`<meta>`/`<link>` — never suppressed.** The
    resolved head renders BEFORE a page's own element tree; under React 19 this is what makes it the
    document's FIRST `<title>` (hoisting flushes tags into `<head>` in encounter order, and the HTML
    Living Standard defines `document.title` as the first `<title>` element) — confirmed empirically
    with a dedicated test asserting exact ordering, not just presence. Under Preact (no hoisting at
    all), the resolved head is the only content ever placed inside the real `<head>` element; a
    hand-authored `<title>` inside page content simply renders wherever it is in `<body>` and never
    becomes `document.title`. Both renderers land on the same deterministic rule through each
    renderer's own real mechanism — neither an author's own tag nor React's own hoisting is ever
    disabled to make this true.
  - A custom root `layout.tsx` receives the resolved head automatically under React (native hoisting
    needs zero cooperation from the layout) and via an explicit `headExtras` prop under Preact — a
    real, found gap fixed here: a custom root layout previously never received `cssHrefs`/`pwaHead`
    at all under Preact, silently dropped rather than merely unused.
- **`buildHreflangLinks`**/**`buildCanonicalLink`** (`.`) — SEO helpers built on Head management
  above. `buildHreflangLinks` produces one `alternate` link per `availableLangs` (always including a
  self-reference for the current language) plus an `x-default` pointing at the default language's
  own version of the current page. `buildCanonicalLink` strips the query string by default
  (`keepParams` opts specific params back in) and always uses `url.origin`. Neither is a port of the
  legacy components they replace — real fixes/gaps documented in the Fixed/`### Added` entries below
  and each function's own doc.
- **`SpaceAppConfig.sitemap?: SitemapSource`** + **`buildSitemapXml`**/**`registerSitemap`** (`.`) —
  `sitemap.xml` registered as a real `GET` route, not a build-time static file. **This is a
  deliberate architectural decision, not an accidental limitation**: `@zanix/space` has no general
  build-time data-generation phase at all today (`zanix space build` only ever bundles the client),
  and building one solely to freeze a sitemap was evaluated and explicitly rejected in favor of the
  live route — see this package's own roadmap for the full comparison against a legacy Zanix stack
  that did generate sitemap output at build/CLI time. Two precisely-guaranteed behaviors per source
  kind, each covered by dedicated tests: a static array is **never recomputed** — the exact same
  reference is kept for the process lifetime, no snapshot at registration, nothing to re-invoke
  (verified by mutating the array after registration and observing the change on the next request);
  a function is **called once, then cached in memory for the process lifetime** (verified by a
  call-counter test), the same pattern `loadMessages()` already uses — a function doing real work (a
  database query for a live product catalog) doesn't repeat it on every crawler hit. What's cached
  is the resolved entries, never the final XML string, so a cached result stays correct even under
  multiple origins (the XML is still rebuilt per request against the current one). Concurrent
  requests racing before the first resolution settles share a single in-flight call (verified by a
  dedicated test). **Bypassed entirely under `znx space dev`**, same dev-mode convention
  `loadMessages()` already establishes. The accepted production trade-off: a function's result is
  only as fresh as the last process start, not the last request — a deliberate choice for a
  low-traffic, crawler-only path, evaluated against a build-time-static-freeze alternative (rejected
  — see the roadmap) and against a legacy Zanix stack that also generated its own sitemap once at
  server-startup, never per request. Every `loc`/`alternates[].href` may be relative (resolved
  against the request's own origin) or absolute. Omitted entirely by default — no route registered,
  same convention as `assetsDir`/`messagesDir`.
- **`SpaceAppConfig.robots?: SpaceRobotsConfig`** + **`buildRobotsTxt`**/**`registerRobots`** (`.`)
  — `robots.txt` registered as a real `GET` route. A raw `string` is served byte-for-byte; a
  structured `{ rules, includeSitemap? }` config auto-appends a `Sitemap:` line when `sitemap` is
  also configured. Genuinely new, not a port — the legacy component this replaces had no
  `robots.txt` mechanism at all (confirmed by reading its source — every "robots" hit there was its
  unrelated per-page `<meta name="robots">` tag convention).
  - 31 new tests across `hreflang.test.ts` (5), `canonical.test.ts` (4), `sitemap.test.ts` (10),
    `robots.test.ts` (6), and 2 new functional end-to-end test files (6) — covering hreflang
    self-reference/`x-default` correctness, canonical query-string handling, sitemap XML
    escaping/`alternates` cross-referencing/relative-URL resolution, the static-array-never-
    recomputed guarantee, the function-source cache/dev-bypass/in-flight-dedup guarantees, robots
    rule rendering/`Sitemap:` auto-append, and both routes' "omitted = never registered" backward
    compatibility.
- **`assetsPlugin`** (`@zanix/space/vite`) + **`loadAssetsManifest`**/**`loadAssetsBuildOutput`**/
  **`resolveAssetHref`** (`.`) — optional content hashing for `assetsDir`, on top of its existing
  stable-path serving (unchanged, works identically whether or not this is used). Hashes every file
  `assetsDir` resolves during a real `zanix space build`, via Rollup's own
  `emitFile({type:
  'asset'})` (confirmed empirically: a nested `name` like `'icons/favicon.png'`
  preserves its own directory structure in the hashed output — Rollup does not flatten it), writing
  `assets-manifest.json` — same `generateBundle`-scanning pattern `cssPlugin`/`cometPlugin` already
  establish, just reached differently (this plugin explicitly emits each asset itself, since nothing
  ever `import`s one through the module graph the way a CSS/JS chunk naturally is).
  `resolveAssetHref('logo.svg')` returns the real hashed URL when a manifest was loaded, falling
  back to the stable `/assets/logo.svg` path otherwise (dev, no build yet, or a path the manifest
  doesn't have) — never throws.
  - `SpaceAppConfig`'s existing `assetsDir` value is now ALSO read eagerly by `buildSpaceClient()`
    (`getAssetsDirConfig()`, same `globalCss`/`renderer` eager-registry pattern already established)
    — a build script that already imports `space.app.ts` gets `assetsPlugin` wired in automatically,
    with zero changes needed to whatever already calls `buildSpaceClient()`.
  - **Real fix over the legacy server this replaces (`server-core`), confirmed by reading its
    source**: its own static-asset handler set `Cache-Control: max-age=31536000` with NEITHER
    `immutable` NOR a real per-file `ETag` (only a `Last-Modified` timestamped once at process
    startup, not per file) — despite its own assets already being content-hashed by that stack's own
    build tool. `register-assets.ts`'s own route now tries the loaded build output directory FIRST —
    a hit is served with `Cache-Control: public, max-age=31536000, immutable` and a strong `ETag`
    derived from the request path itself (the hash IS the filename, genuinely free to reuse) —
    falling through to the original, unhashed lookup (no special caching, since that content could
    change without its URL changing) on a miss.
  - Real image/SVG optimization is now implemented — see the dedicated `assetsPlugin({ optimize })`
    entry below. Video/audio transcoding stays deliberately out of scope (see that same entry for
    why).
  - 17 new tests: 3 integration (`assets-plugin.test.ts`, real `vite build()` runs, same reasoning
    `comet-plugin.test.ts` already documents), 4 new `build-client.test.ts` cases (explicit
    `assetsDir`, the eager default, an `assetsDir`-only app still building, and the never-configured
    case writing no manifest), 2 new `define-space-app.test.tsx` cases (the eager
    `setAssetsDirConfig` call and its own omitted case), 7 unit (`assets-manifest.test.ts`), and 1
    functional end-to-end test proving the real `immutable`/`ETag` headers on a hashed hit and the
    unchanged, uncached fallback on a miss.

- **`assetsPlugin({ optimize })`** — opt-in, build-time-only image (`sharp`) and SVG (`svgo`)
  optimization, layered on top of `assetsPlugin`'s existing hash-and-emit behavior (unchanged when
  `optimize` is omitted). Ported from the same legacy Zanix media pipeline referenced above —
  breakpoints/qualities reused verbatim, this time actually implemented.
  - **One invariant every code path obeys**: an optimized output only replaces, or gets added next
    to, its reference when it is strictly smaller in bytes than that reference — never assumed,
    always measured. Equal-or-larger always keeps the reference bytes exactly. Verified directly
    with deterministic synthetic byte arrays (`pickSmaller`, extracted as the single choke point
    every "never worsen" decision goes through), not inferred from whether a particular real photo
    happened to compress well.
  - **`images: true`** (no `breakpoints`/`formats`) is the ONLY shape that touches the original
    key's own bytes — recompresses in place at the same dimensions/format, replacing them only if
    strictly smaller. Every other shape (`breakpoints`/`formats` specified) leaves the original key
    completely untouched and only adds new, derived keys (`hero.msm.jpg`, `hero.webp`, ...) — purely
    additive, `assets-manifest.json`'s own flat shape never changes, `resolveAssetHref` needs zero
    changes to resolve a derived key.
  - **The three-tier reference rule** (`breakpoints` + `formats` together): each breakpoint's own
    same-format resize is computed as that breakpoint's OWN reference — every additional format
    requested for that breakpoint is compared ONLY against that reference, never the global
    original, never another breakpoint, never another format. `hero.msm.webp` must beat
    `hero.msm.jpg` specifically, not merely beat the (much bigger) `hero.jpg`.
  - **Breakpoints accept a named legacy preset (`'msm'`) or a raw pixel width (`720`, under a `w720`
    key)** — `ImageBreakpoint = ImageBreakpointName | number` — a consumer that wants a specific
    width never needs to learn the legacy preset names. Presets (`thum`=40/q50, `msm`=360/q85,
    `mlg`=720/q90, `dmd`=1440/q95, `dlg`=1920/q100) are the same legacy sizes/qualities, kept as
    documented, overridable defaults — `dlg`'s `quality: 100` is a deliberately inherited legacy
    decision, only emitted when it actually beats the original. `withoutEnlargement: true` always —
    a breakpoint wider than the real source clamps down, never upscales. Config-time validation
    rejects a literal duplicate breakpoint or two entries that resolve to the identical pixel width
    (would only produce equivalent variants); a small source causing two DIFFERENT breakpoints to
    clamp to the same real (width, quality) pair at runtime is deduplicated internally instead (not
    a config error) — keyed by BOTH width and quality, not width alone, after a real bug (two
    presets with different default qualities silently sharing one preset's cached bytes) was caught
    by this module's own tests before shipping.
  - **No `.withMetadata()` call anywhere in the pipeline** — confirmed empirically that sharp's own
    DEFAULT output already strips EXIF/ICC metadata, and that calling `.withMetadata({})` (as the
    legacy pipeline did, under a now-stale `// delete metadata` comment) does the OPPOSITE in
    current sharp versions — it PRESERVES metadata. `exiftool-vendored` was never needed for this;
    not added.
  - **Deliberate deviations from the legacy encode settings**: no `nearLossless: true` on webp, no
    `lossless: true` on avif — both typically produce output LARGER than plain lossy encoding at the
    same quality, directly counter to the "never worsen" mandate the legacy pipeline itself
    otherwise followed everywhere else.
  - **`optimize.svg`** — `svgo` (confirmed to run cleanly under Deno with no native binary via a
    real spike, not assumed), safe transforms only (strip dimensions/metadata/comments, minify
    inline styles/ids). Deliberately NOT the legacy CSS-selector `purge` step (a whole-app source
    scan, out of scope) and unrelated to a sprite `<use>` icon pattern by default — confirmed by
    reading the real legacy `Media`/`Image` component that neither concept is the same mechanism.
  - **`<symbol id>` protection, automatic, no config** — `cleanupIds` (with its default
    `remove: true`) is provably unsafe for a multi-symbol sprite (`<symbol id="name">` elements
    meant for an external `<use href="other-file.svg#name">`, the pattern the bullet above is
    careful to call unrelated **by default**): svgo only ever analyzes one file at a time, so it has
    no way to see that an id is referenced from a SEPARATE document, and deletes every one of them.
    Confirmed empirically against a real 17-symbol icon sprite (`@zanix/space-ui`'s own
    `catalog.svg`, its first real consumer): svgo's plain default config strips all 17 ids. Rather
    than require a project to know and declare an exception, `svg-optimize.ts`'s own
    `extractSymbolIds` scans each file's raw source for every `<symbol id="...">` BEFORE svgo runs,
    and hands that exact list to svgo's own `cleanupIds` plugin as its documented
    `preserve: string[]` param (verified directly against `svgo@3.3.4`'s own `cleanupIds.js` — it
    exempts listed ids from both removal and renaming) — on EVERY file, every time, no config
    needed. Precise, not all-or-nothing: a genuinely-dead id on some OTHER, non-symbol element in
    the same file still gets cleaned normally. A bare `optimize: { svg: true }`, with nothing else
    declared, now already keeps a real `<symbol>`-based catalog's ids intact.
  - **`optimize.svg.preserveIds`** — an object form of `optimize.svg` (`{ preserveIds?: string[] }`,
    alongside the existing bare `true`), scoping which SVGs skip `cleanupIds` ENTIRELY, by the same
    glob matching `optimize.include` already uses. No longer required for a `<symbol>`-based sprite
    (see above) — kept as a supplementary escape hatch for the rarer non-symbol case, e.g. a plain
    element's id referenced only via a `clip-path: url(other-file.svg#id)` from outside, where
    symbol detection doesn't apply. `remove: false` alone was confirmed insufficient for that case
    (svgo's `minify: true` would still rewrite each surviving id's own text, breaking the very
    external reference this exists to protect), so `cleanupIds` is dropped from the pipeline
    entirely for a matching file, not reconfigured. A file NOT matching `preserveIds` still gets its
    own `<symbol id>`s protected automatically (the bullet above), plus normal `cleanupIds` for
    everything else. Threaded through both the inline and `useWorker` execution paths identically —
    an execution strategy never changes what gets optimized, same invariant `optimize.useWorker`'s
    own entry below already established for images.
  - **`optimize.include`** — glob patterns (`@std/path`'s own `globToRegExp`, Deno's std, no new
    dependency) matched against the same relative path the manifest already keys on. Omitted: every
    eligible asset; an asset outside the filter, or one whose extension isn't supported by
    `images`/`svg` at all, is always left completely untouched.
  - **`optimize.useWorker`** — offloads the actual sharp/svgo work to a real worker pool
    (`@zanix/utils`'s own `WorkerManager`, already a pinned dependency via its `errors`/`logger`/
    `helpers` subpaths — a new `workers` subpath, no new package). `true` sizes a pool to the
    detected CPU count, a `number` is an explicit size. Purely an execution strategy: produces the
    exact same emit/discard decisions and pixel-identical output as leaving it off (the default,
    inline on the same thread `buildStart` already runs on) — verified directly. Every worker task
    pins `sharp.concurrency(1)`: sharp/libvips already parallelizes internally (its own default
    concurrency matches the detected CPU count), so leaving it at default inside a worker would let
    N concurrent workers each ALSO spin up their own multi-threaded pool, oversubscribing the real
    cores several times over — svgo, pure single-threaded JS, needs no equivalent adjustment.
  - **Real bug found and fixed during design, not left for a flaky test to surface later**: a worker
    task that throws hung `WorkerManager`'s own `onFinish` callback indefinitely instead of ever
    rejecting — traced to its internal error-logging path (`Znx.logger.error`) stalling when nothing
    in the process had ever imported `@zanix/utils`'s logger singleton (this package's own bundler
    chain never did). Fixed by an explicit `@zanix/logger` import in the worker-task module —
    confirmed empirically (utils' own test suite passes because ITS test file imports the logger
    module first; a fresh spike without it reproduced the hang, then importing it fixed it
    immediately).
  - **Real, empirically-found finding, not assumed**: sharp/libvips' JPEG re-encode is not
    guaranteed byte-for-byte deterministic between a genuinely separate worker thread and the main
    thread (confirmed: identical `sharp.concurrency()` value on the SAME thread stays byte-for-byte
    identical; only crossing a real worker-thread boundary introduces a handful of differing bytes,
    most likely mozjpeg's own trellis/entropy-coding step) — even though the DECODED pixel content
    is 100% identical either way (also confirmed directly, not assumed). The `useWorker`-equivalence
    test compares decoded pixel data/dimensions/format for raster variants accordingly; svgo (pure
    JS, no native threading) stays genuinely byte-for-byte equal between modes.
  - **`assets-dimensions.json`/a `srcset`-building helper were considered and deliberately NOT
    built** — confirmed by reading the real legacy `Media`/`Image` component end-to-end that it
    resolves responsive variants entirely by breakpoint NAME against a `<picture>` +
    `<source media="...">` art-direction pattern, never a `srcset` `w`-descriptor/`sizes` one — it
    never read or needed a variant's real pixel dimensions. `resolveAssetHref('hero.msm.jpg')` (zero
    new API) is already sufficient; a future `space-ui` port of that component would consume it
    directly. Composing `<picture>`/`srcset`/responsive-selection markup stays a rendering-layer
    concern, deliberately not built into `assetsPlugin`.
  - **Video/audio transcoding deliberately out of scope, documented not implemented**: a real spike
    found `fluent-ffmpeg` deprecated upstream, and `ffmpeg-static`'s install-time binary download
    blocked by Deno's own default npm-script sandboxing (confirmed: `deno run` printed "Ignored
    build scripts... Run deno approve-scripts", and the binary never materialized on disk). Three
    undecided provisioning options documented (a vendored binary via explicit `approve-scripts` opt
    -in, a system/Docker-provided `ffmpeg` binary, or an external transcoding service/CDN) — an
    infrastructure decision, not an implementation one, left for separate, future work.
  - Real Deno-native library reuse over new dependencies where one already existed: `@zanix/utils`
    (`workers`, `logger`) and `@std/path` (`globToRegExp`) — both already dependencies of this
    package (or, for `workers`, the same package under a new subpath) — instead of any third-party
    alternative.
  - 44 new tests: 11 unit (`image-breakpoints.test.ts` — preset resolution, raw-width resolution,
    override application, duplicate/collision validation), 5 unit (`pick-smaller.test.ts` — the
    exhaustive, deterministic "never worsen" rule proof), 12 integration (`image-optimize.test.ts` —
    real `sharp`, all four `images` option shapes, the three-tier rule, no-upscale, cross-breakpoint
    dedup with differing qualities, metadata stripping, unsupported-format passthrough, raw numeric
    breakpoints), 4 integration (`svg-optimize.test.ts` — real `svgo`,
    improvement/no-improvement/malformed-input/purge- boundary), 5 new integration
    (`assets-plugin.test.ts` — the unchanged-by-default guarantee, additive breakpoint variants
    through the full `loadAssetsManifest`+`resolveAssetHref` flow, SVG optimization, `include`
    scoping, unsupported-extension passthrough), and 7 integration (`optimize-runner.test.ts` —
    inline/worker output equivalence for both images and SVG, pool -size contention, the
    worker-error-not-silenced regression test, identical error behavior inline). Suite: 606/606
    passing.
- **Server-only import guard for Comets, enforced at build time.** `cometPlugin()`'s `transform`
  hook now records every module marked `'server-only'` (same directive-prologue mechanism as
  `'use comet'`); its new `buildEnd` hook then does a real BFS over the module graph's reverse edges
  and fails the build — `this.error`, a genuine fatal Rollup error, not a warning — if any of them
  is reachable from a Comet, even transitively through other modules, printing the exact import
  chain from the offending Comet down to the violation. Lives entirely in the bundler layer: never
  branches on the active renderer (verified identical under `react` and `preact`), and adds no
  runtime check to the shipped client bundle — a build that never crosses this boundary pays no
  measurable cost (confirmed via an isolated build-time benchmark: median delta was within ordinary
  system noise at both 50 and 150 comets, with zero `'server-only'` files present — the common case;
  the BFS only ever runs at all when something Comet-reachable already imported a `'server-only'`
  module, i.e. only on a build that's about to fail regardless). 7 new integration tests
  (`server-only-guard.test.ts`): a clean build with no violation, a direct import, a transitive
  import through an intermediate module, two-comet isolation (only the actual offender is named),
  renderer parity, a `'server-only'` module no Comet ever imports never producing a false positive,
  and the real production entrypoint (`buildSpaceClient`), not just an isolated plugin call.
- **Orbit now preserves a Comet's client-side state across navigation, opt-in via a new `persist`
  prop.** `<Counter comet='visible' persist='cart-widget' />` — instead of always tearing a Comet
  down and re-hydrating it fresh on every Orbit swap, a `persist`-marked Comet's real DOM node and
  component instance are retained across the swap and reused whenever the SAME comet (same module +
  export) reappears under that key on a later fragment, covering A→B→A, not just A→B. Backed by
  `RetainedCometCache`, a flat, module-private LRU cache (`MAX_RETAINED_COMETS = 5`, an
  implementation detail, not a public option) — bounded, not scoped by URL/history entry, so state
  survives however many intermediate pages the user visits before returning, up to the cap.
  Renderer-agnostic by construction: a `WeakMap<Element, OrbitPersistHandle>`, populated by each
  renderer's own hydration code (`hydrate-comets.ts`/`hydrate-comets-preact.ts`), is the only
  renderer-specific surface — `orbit.ts`/`comet-persistence.ts` themselves never branch on renderer.
  12 new DOM-free unit tests (`comet-persistence.test.ts`) prove the cache's own correctness
  (insertion, LRU eviction order, identity-mismatch handling — a module-URL or export-name change is
  treated as a real identity change, not a reuse — duplicate-key safety, `clear()`); the
  DOM-touching half (`detachPersistedComets`/`reuseRetainedComets`) is verified by direct code
  review against the real React/Preact/DOM APIs involved, not an automated real-browser test — a
  real-browser lifecycle test was attempted and reproduced an intermittent dev-server `import()`
  race unrelated to this feature, so it's documented as an environment limitation rather than kept
  as committed test infrastructure. Isolated micro-benchmark: ~0.1–0.2µs per `set()`+`take()` cycle
  at the real cap, with no growth in per-op cost across 2,000,000 cycles — the added bookkeeping is
  not a meaningful cost on its own; the hydration work actually avoided by reuse could only be
  measured in a real browser, which this environment cannot currently do reliably (same limitation
  as above).
- **The server→client serialization contract, formalized.** `initial-state-global.ts` now documents,
  explicitly, the exact behavior of the one data channel that crosses the server/client boundary in
  Space — `renderToResponse`'s own `initialState` option and a Comet's own props, both plain
  `JSON.stringify()`/`JSON.parse()`, nothing richer. Every value `JSON.stringify` can't represent
  faithfully now has one, explicitly documented behavior: `undefined`/a function is omitted as an
  object property or nulled as an array element; `Date` serializes via its own `toJSON()` to a plain
  ISO string; `Map` and `Set` **both** serialize to `{}` (confirmed empirically — `Set` does NOT
  become `[]`, since `JSON.stringify` only ever produces array output for a real `Array`); a
  circular reference or `BigInt` throws. Deliberately not a richer format — no tree/element
  serialization, no Server-Action-style references — matching this project's own conclusion, after
  evaluating React Server Components against Space's real Comets/Orbit architecture, that Space's
  real usage has never needed more than flat, JSON-safe data. Also fixes two real bugs the
  formalization surfaced: a circular reference or `BigInt` anywhere inside `initialState` used to
  make `renderToResponse` (React) throw a raw `JSON.stringify` `TypeError` instead of resolving,
  escaping its own documented "always resolves, never throws" contract (Preact's own
  `JSON.stringify` call was already fully unguarded — same gap). Both now resolve gracefully —
  `onError` (if given) receives the real error, the function returns a `500` — matching how a real
  render error already behaves in both. A Comet's own props hitting the same case now throw a clear,
  Space-authored `InternalError` naming the offending Comet, instead of a raw `TypeError` —
  deliberately a throw, not a graceful failure, since a Comet's props are evaluated mid-render,
  where an uncaught throw is already the correct, pre-existing propagation path. 7 new tests across
  `render-to-response.test.tsx`, `render-to-response-preact.test.ts`, and `define-comet.test.tsx`
  (circular value and `BigInt` for both renderers, the full undefined/function/`Date`/`Map`/`Set`
  degradation asserted on the literal serialized output, and the `defineComet` error case) —
  byte-for-byte behavior for every already-supported JSON-safe value is unchanged (confirmed via the
  full existing suite, unmodified).

### Fixed

- **`resolveHead`'s own `link` deduplication silently dropped a real, distinct `hreflang` entry
  whenever it shared an `href` with another one.** `rel`+`href` alone was the dedup key — correct
  for `canonical`/`stylesheet`/`manifest` links, but not for `rel="alternate"` hreflang links: an
  `x-default` entry legitimately points at the SAME URL as another language's own entry whenever
  that language happens to be the site's default (a common case, not an edge case — most visitors
  land on a default-language site), yet the two are semantically distinct signals that must both
  survive. Found while wiring `buildHreflangLinks` (above) through a real end-to-end test — the
  `x-default` link was silently missing from the rendered `<head>` despite being present in the
  resolved data passed in. Fixed by including `hreflang` in the dedup key (`rel`+`href`+`hreflang`,
  falling back to `''` when unset) — every other `<link>` kind, which never sets `hreflang`, dedupes
  by `rel`+`href` exactly as before.
- **`defineSpaceApp({ renderer })` now resolves eagerly** (`getActiveRenderer()`, newly public from
  both `.` and `./dev`), same timing as `headers`/`pwa`/`globalCss` — previously only set inside
  `setup()`'s own closure, unreadable until `activateApps()` actually ran. This closes a real,
  previously-unwired gap: `zanix space build` never calls `activateApps()` at all, so it had no way
  to ever learn a project declared `renderer: 'preact'`, and `zanix space dev` called
  `spacePlugin()` before activation too — both silently built/served with React's Vite plugin
  regardless of what `space.app.ts` declared. `BuildSpaceClientOptions.renderer` now defaults to
  `getActiveRenderer()` (same pattern `globalCss` below already established), so a build script that
  already imports `space.app.ts` gets the right renderer automatically.
- **`buildSpaceClient({ globalCss })` now defaults to `getGlobalCssPaths()`** instead of `[]` —
  closes the production side of the composition gap `addGlobalCssPaths` (above) opened: a build
  script that already imports the app's `space.app.ts` (so `defineSpaceApp()` runs and populates
  `getGlobalCssPaths()`) no longer has to separately re-declare `globalCss` to get it into the real
  production build — and, now that `globalCss` is host-composable, this includes BOTH a base app's
  own stylesheets and a host's own on top, automatically. `buildSpaceClient` already wired a passed
  `globalCss` array correctly into `rollupOptions.input` before this change — the gap was only in
  the default, never in the wiring itself. Passing `globalCss` explicitly still overrides the
  default, unchanged.
- **Orbit (`initOrbit`) wrongly intercepted same-document hash-only links** (`<a href="#section">`,
  or the current path plus a hash) — `shouldInterceptNavigation` had no way to distinguish that case
  from a normal internal link, so a click on it triggered a full fragment `fetch()` + `innerHTML`
  swap instead of letting the browser natively scroll to the anchor: no smooth native scroll, a
  wasted network round-trip, and the same anchor clicked twice re-fetched and re-rendered identical
  content each time. Fixed by adding `isSameDocumentHashLink` (true only when the resolved URL has a
  non-empty hash AND the same `pathname`+`search` as the current page) as a new escape hatch,
  alongside the existing modified-click/`target`/cross-origin ones.
- **`Vary: x-space-navigate` was only ever sent when a page declared `cacheControl`.** Every page's
  response body genuinely differs by that request header regardless of caching config (full document
  vs. bare Orbit outlet fragment) — a response with no `cacheControl` still silently risked a shared
  HTTP cache in front of the app serving the wrong shape to the wrong request. Fixed in both
  `SpacePageController.handleGet`'s non-`cacheControl` branch and `createNotFoundHandler` (which
  previously never set `Vary` at all), so every response now sets it unconditionally.
- **Every security header this framework manages — CSP, `frameOptions`, `referrerPolicy`, `noSniff`,
  and every other field `securityHeadersGuard()` handles — now resolves through a genuine three-tier
  precedence chain: this page's own explicit config (including `false`) > a guard registered via
  `defineMiddleware`/`@Guard` (`cspGuard()`/`securityHeadersGuard()`) > this page's own zero-config
  default.** Three distinct problems, fixed together:
  1. **Corruption**: `@zanix/server`'s response pipeline used to merge a guard's header onto the
     response via `.append()`, which — whenever the page had ALSO already set the same header
     directly inside `handleGet` — comma-joined the two values into one syntactically invalid result
     (most visibly broken for CSP, whose directives are `;`-separated, never `,`; real browsers do
     not interpret a comma-joined value as "enforce both"). Fixed at the source (`@zanix/server`'s
     `mainInterceptor`, see that package's own CHANGELOG): a guard's header now only applies when
     the handler's response doesn't already have that header.
  2. **A guard could never actually act as an app-wide default, for ANY of these headers.**
     `SpacePageController` always applies its own zero-config defaults (nonce-based CSP;
     `frameOptions: 'SAMEORIGIN'`; `referrerPolicy: 'strict-origin-when-cross-origin'`;
     `noSniff: true`) UNLESS a page explicitly disables them — so for any ordinary page that
     configures nothing at all, those defaults were ALREADY present on the response by the time
     `mainInterceptor`'s merge ran, making a registered guard lose to them every time, silently,
     even though nobody actually asked for the framework's own defaults over the app's own guard.
     Confirmed empirically with an isolated test before fixing: a page with no `headers` option,
     under a registered global `cspGuard({ 'default-src': ["'self'"] })`, still came back with the
     framework's own nonce-based CSP, not the guard's. Fixed by exposing the fully-accumulated guard
     headers to the handler itself, via `@zanix/server`'s new `GUARD_HEADERS_LOCALS_KEY`
     (`ctx.locals`, see that package's own CHANGELOG) — `handleGet` now checks, BEFORE building its
     own response, whether a guard already has an answer for each header, and steps aside (applies
     neither its own default NOR anything else, for that specific field) when one does, letting
     `mainInterceptor`'s own merge fill the gap from the guard afterward. Implemented generically,
     not per-field: `security-headers-guard.ts` now exports `SECURITY_HEADER_NAMES`, the single
     source of truth mapping each `SecurityHeadersOptions` field to its real HTTP header name (used
     internally by `securityHeadersGuard` itself too, replacing 7 hardcoded string literals), which
     `applySecurityGuards` iterates generically — no bespoke logic duplicated per field.
  3. **An explicit `false` used to be indistinguishable from "not configured" once a guard was
     involved.** `false` must win even over a registered guard, ending with that header COMPLETELY
     ABSENT — but a merely-absent header is exactly what `mainInterceptor`'s merge already reads as
     "please fill this from the guard," so silently setting nothing couldn't communicate "and don't
     fill it either." An earlier version of this fix worked around this by writing an empty policy
     value (functionally equivalent — zero directives enforce nothing — but still a byte-level
     `Content-Security-Policy:` on the wire, not a genuinely absent header). Replaced with a proper,
     generic mechanism: `@zanix/server`'s new `GUARD_BLOCKED_HEADERS_LOCALS_KEY` (`ctx.locals`, a
     plain `Set<string>` of lowercased header names — see that package's own CHANGELOG) lets a
     handler veto specific headers from the guard-merge entirely, so the final response never has
     them at all, verified directly (`response.headers.has(...)` false, not just `.get(...)` falsy).
     1 comprehensive end-to-end test in `define-middleware.test.tsx`, covering CSP AND
     `frameOptions` (representative of every other field, since the resolution is
     generic/data-driven) in one real HTTP round-trip: guard + unconfigured page → guard wins;
     guard + explicit page config → page wins (both for a global and a class-level guard); guard +
     explicit `false` → header completely absent (not an empty value); no guard + unconfigured page
     → this page's own zero-config default still applies (run before any guard is ever registered in
     the process, since registration is permanent for the rest of the suite); an unrelated field the
     guard doesn't cover still falls through to its own zero-config default even while a sibling
     field on the same guard is actively overriding it; an explicit assertion that no scenario ever
     produces a comma-joined value; and Set-Cookie from an unrelated guard still accumulates
     correctly alongside a blocked header. Plus 1 new unit test verifying `SECURITY_HEADER_NAMES`
     stays in sync with `securityHeadersGuard`'s own real output.

### Documentation

- **New `docs/theming.md`** — the full design-tokens convention: declaring tokens, the `--space-*`
  naming convention (and how to avoid colliding with a third-party tool's own prefix, e.g.
  Tailwind's `--tw-*`), the primitive-vs-semantic distinction (a component must only ever consume
  semantic tokens), how a host overrides a base app's tokens (same `globalCss` composition already
  shipped — no new mechanism), base → host precedence, a light/dark pattern (`prefers-color-scheme`
  - an optional `[data-theme]` attribute, no Zanix-specific code involved), and explicit
    what-a-component-should/shouldn't-do rules. README's own "Design tokens" section now links to it
    and shows the primitive/semantic distinction in its own example. No runtime API was added — this
    is purely a documented convention on top of already-shipped `globalCss` composition.
- **README's "Selective hydration (Comets)" section now cross-references `@zanix/app`'s own
  "Style-only overrides" pattern** — how a Comet resolves its own className/style via
  `resolveBehavior()`, keeping its own logic intact, distinct from the whole-component-swap example
  already documented. No code change in this package; the mechanism lives entirely in `@zanix/app`.
- **New `docs/seo.md`** — full reference for the SEO module (`buildCanonicalLink`,
  `buildHreflangLinks`, `buildRobotsTxt`/`registerRobots`, `buildSitemapXml`/`registerSitemap`, and
  every associated type), matching `docs/theming.md`/`docs/validation.md`'s depth. This module had
  no dedicated guide before. README's Documentation section now links to it.
- **Editorial pass across every public JSDoc comment, README.md, docs/, and CHANGELOG.md**: removed
  language that only made sense with insider context on this package's own development — comparisons
  against an unnamed internal predecessor codebase, references to a specific development pass, and
  prose narrating how a fact was verified during development. Every doc now states current behavior
  and its real technical rationale directly, in present tense; no behavioral guarantee, calibration
  value, or design constraint was dropped in the process. Also removed internal roadmap ticket codes
  (e.g. `P2-12a`) from CHANGELOG entry titles and cross-references, replacing them with plain
  descriptive text. `docs/see-more.md` (an empty placeholder) was removed, and its README link
  retargeted. No code or public API changed.
