# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/) and this project
adheres to [Semantic Versioning](http://semver.org/spec/v2.0.0.html).

## [1.4.0] - 2026-09-04

### Added

- **`attachFormDraftPersistence`/`restoreDraftValue`/`persistDraftValue`** (`@zanix/space/comet`),
  plus ready-made `FormDraftPersistence` Comets (`@zanix/space/comet/react`,
  `@zanix/space/comet/preact`) — session/local-scoped draft persistence for a plain `<form>`,
  restoring unsaved input after an accidental refresh or a navigate-away-and-back with no
  server-side state to recover it from. Saves the whole form generically via `form.elements`
  (debounced on `input`/`change`), clears on `submit`, and always excludes `_csrf`,
  `type="password"`, and `type="file"` fields, plus any field marked `data-no-persist` — none of
  these are configurable. `restoreDraftValue`/`persistDraftValue` are the narrower, value-level
  counterpart for a React/Preact-controlled field (which the form-level primitive can never restore
  into directly): kept as two separate functions, rather than one combined primitive, because
  restoring must run exactly once while persisting must re-run on every value change — that re-run
  IS the debounce mechanism, not something a single combined primitive could do without also
  re-firing restore on every keystroke.
- **`CSRF_FORM_FIELD`** (`@zanix/space`, from `csrf-guard.ts`) — the `_csrf` form field name
  `csrfGuard` itself reads a submitted token back from, now exported so `attachFormDraftPersistence`
  (and any other consumer) can import the real constant instead of re-declaring `'_csrf'` as a bare
  string.
- **`attachFormDraftPersistence`'s restore step now dispatches a real, bubbling `input`/`change`
  event** after writing a field's `.value`/`.checked` — the raw DOM write alone is invisible to any
  React/Preact-controlled wrapper around that field (e.g. `@zanix/space-ui`'s own `Input`/`Select`/
  `RadioGroup`, which always track a `value` internally even when the page author never passes one),
  so a restored draft could get silently reverted on the field's next re-render. The dispatched
  event is what makes such a field's own `onChange`/`onInput` handler fire and sync its state to
  match, the same path a genuine keystroke/click already takes.
- **`attachSubmitGuard`/`SubmitGuard` Comets** (`@zanix/space/comet`, `@zanix/space/comet/react`,
  `@zanix/space/comet/preact`) — stops a second real `<form>` submission (an impatient double-click,
  or a slow first response) from ever reaching the server. Disables every submit-triggering control
  on the form's first real `submit` and rejects any further `submit` while still in flight outright.
  Relies on this framework's own "Real HTTP, not an RPC" contract: a submission that goes through
  always ends in a real navigation, so there is deliberately no reset/timeout path.
- **`attachScrollRestoration`/`ScrollRestoration` Comets** — session/local-scoped scroll-position
  restoration for the window or a single scrollable container, across a refresh or an Orbit
  navigation (Orbit never manages scroll position itself). `storageKey` defaults to
  `location.pathname + location.search` — unlike `FormDraftPersistence`'s own `storageKey`
  (deliberately required, never derived), a scroll position's real identity genuinely IS the page
  being viewed. Skips restoring when the current URL already carries a `#fragment` — an explicit
  anchor wins over a remembered position.
- **`attachUnsavedChangesGuard`/`UnsavedChangesGuard` Comets** — warns via the browser's own native
  "leave site?" prompt (`beforeunload`) before a real page unload discards an unsaved `<form>`.
  Composes naturally alongside `FormDraftPersistence` on the same form. Known gap: only intercepts a
  real full-page unload — Orbit's own same-origin `<a>` click interception has no exposed "confirm
  before navigating" hook yet, so an in-app link away from a dirty form still navigates unprompted.
- **`attachNetworkStatus`/`NetworkStatus` Comets** — live `navigator.onLine` plus real
  `online`/`offline` transitions, exposed as a `data-network-status="online"|"offline"` attribute (a
  Comet's own props must be plain JSON, so there's no callback to hand it) on
  `document.documentElement` by default. `attachNetworkStatus` itself is callback-based, for a
  consumer's own composite comet wanting real `useState` instead.
- **`draft-storage.ts`** (`@zanix/space`, internal) — the `sessionStorage`/`localStorage`
  read/write/namespacing plumbing `FormDraftPersistence` and `ScrollRestoration` both build on,
  extracted so the fail-soft try/catch discipline and storage-key namespace (now `zn-space:`,
  previously `zn-space-draft:` — never published, so no migration needed) can't drift out of sync
  between them.
- **`attachManagedForm`/`ManagedForm` Comets** — composes `FormDraftPersistence`/`SubmitGuard`/
  `UnsavedChangesGuard` under one `formId`, so enabling more than one doesn't mean repeating it
  across separate call sites. Does not render the `<form>` itself, same reason none of the three
  primitives it composes do: a Comet's own props must be plain JSON, so a component that also needs
  arbitrary field markup as `children` — closures, event handlers, none of it JSON-serializable —
  can't be one hydratable boundary.

### Fixed

- **`zanix space dev`'s `'server-only'` boundary enforcement no longer silently misses a violation
  reached through a module belonging to ANOTHER published JSR package** (e.g. `@zanix/space-ui`'s
  `./runtime` entrypoint composing `Image`/`ImgButton`, both of which reach
  `@zanix/space/assets-manifest`). `transformClientAsset`'s check resolves a module's real on-disk
  path via `realFilePathOf` and reads that file directly — correct for a project-relative or
  workspace-linked file, but a module resolved from a REMOTE, not-yet-locally-materialized `jsr:`
  package has no such path (`@deno/vite-plugin`'s own resolver leaves it wrapped as a `\0deno::`
  specifier whose `resolved` segment stays an un-expanded `https://` URL), so the check silently
  never ran at all. `transformClientAsset` now falls back to the module's own transform result —
  Vite's dev pipeline always embeds the untransformed original source in
  `TransformResult.map.sourcesContent`, the same signal a browser's devtools "original source" view
  relies on — whenever the disk-based path isn't available. A Comet reaching a `'server-only'`
  module this way now fails loudly with the same purpose-built violation message and import chain
  `zanix space dev` already produces for a project-relative violation, instead of hydrating in the
  browser and crashing later with an unrelated, opaque error.
- **A single test file run by explicit path (`deno test path/to/file.test.tsx`) could spuriously
  fail to resolve ordinary DOM types** (`document`, `IntersectionObserver`, `ParentNode`, ...) that
  real browser-facing source files use and that pass fine when discovered through this config's own
  `test.include` glob instead — Deno's implicit default `lib` set differs between the two invocation
  shapes. `compilerOptions` now declares `lib` explicitly (`deno.window`, `dom`, `dom.iterable`),
  removing the discrepancy for both.

## [1.3.0] - 2026-09-03

### Added

- **`NATIVE_RUNTIME_MODULES`** (`@zanix/space/dev`) — the exact list of bare specifiers
  `RealImportEvaluator.runExternalModule` resolves via a plain native `import()` against whatever
  process governs `zanix space dev` (`@zanix/cli`'s own config, never a consuming project's — see
  `native-runtime-modules.ts`'s own doc for the full module-identity mechanism). Previously internal
  only; exported so `@zanix/cli`'s own regression guard for this mechanism
  (`native-runtime-module-imports.test.ts`) can check against the REAL list instead of hand-keeping
  its own copy in sync — closing a real gap this array's own history left open
  (`@zanix/notifications`/ `@zanix/datamaster` silently missing their required `cli`-side
  `deno.jsonc` entry until a companion fix there added them).
- **`isCometPersisted(key)`** (`@zanix/space/client`, `@zanix/space/client/preact`) — a read-only,
  side-effect-free way to ask whether a `persist` key currently has a retained (detached but not yet
  reused) Comet instance. Before this, the only way to find out was navigating to a page that
  renders the key — itself a mutating operation that can touch/evict other entries in the bounded
  5-slot cache. Backed by `RetainedCometCache`'s existing `has()` (already unit-tested,
  never-consuming), just newly reachable from outside `comet-persistence.ts` — useful for debugging
  `persist` behavior or building persist-aware dev UI (e.g. a "this widget's state IS/ ISN'T
  currently preserved" badge).

### Fixed

- **A `persist`-tagged Comet no longer visibly flashes/jumps as part of Orbit's whole-page View
  Transition, even though its own DOM node and state genuinely survive the navigation.** With no
  element anywhere carrying its own `view-transition-name`, the View Transitions API captures the
  entire transitioning outlet as a single before/after image pair and crossfades one into the other
  — there was no per-element distinction to make, so a retained `persist` boundary still went
  through the same crossfade as every genuinely-replaced part of the page. `swapOutlet`
  (`modules/client/orbit.ts`) now calls the new `registerPersistTransitionNames`
  (`modules/client/comet-persist-transition.ts`) BEFORE `document.startViewTransition` runs, while
  the outgoing boundary is still attached: it gives every `persist`-tagged boundary, on either side
  of the navigation, a stable `view-transition-name` (a CSS-safe hash of the raw `persist` key,
  applied via a new `COMET_PERSIST_VT_ATTR` attribute and a CSP-nonce-respecting CSSOM rule, never
  an inline `style`) so the browser morphs the retained instance in place instead of folding it into
  the region-wide crossfade. `detachPersistedComets`/`reuseRetainedComets` themselves now run from
  inside the `swap()` callback rather than before it, so the SAME node carries that name in both the
  transition's old-state and new-state snapshots. A no-op on a browser with no View Transitions
  support at all, and for any boundary with no `persist` key.

## [1.2.0] - 2026-09-03

### Added

- **`navigate(href, options?)`** (`@zanix/space/client`, `@zanix/space/client/preact`) — the public
  programmatic counterpart to Orbit's click interception, for a navigation with no `<a>` click to
  intercept at all (e.g. a Comet's own event handler navigating once a `fetch()` it made resolves).
  Runs through the exact same fragment swap a real click uses (`modules/client/orbit.ts`): prefetch
  reuse, the CSP-signature comparison, stylesheet loading, `persist`-tagged Comet retention, and the
  same graceful degradation to a real navigation on any failure. `options.replace` selects
  `history.replaceState` over the default `history.pushState`, mirroring the same distinction
  `onClick`/`onPopState` already make for their own two triggers. A cross-origin `href` or a
  same-document hash-only link gets a real navigation instead, exactly like the equivalent `<a>`
  would.

### Fixed

- **`zanix space dev`'s dev-only asset handler no longer swallows a real page navigation to a URL it
  misclassifies as a source-file request.** `createDevAssetHandler` (`dev-asset-handler.ts`)
  recognizes an asset request by its own path's extension alone (`.ts`/`.tsx`/`.js`/`.jsx`/`.css`/
  `.mjs`/`.json`) — a real `@zanix/space` page route never carries one by convention, but nothing
  stops a person from typing/clicking their way to a URL that happens to (e.g. `/page.tsx`). Before
  this fix, that request got a bare, unstyled `404` straight from this handler, short-circuiting
  before the app's own route table — and its `not-found.tsx` — ever ran. It now falls through to the
  real route table instead, but ONLY for a genuine top-level document navigation
  (`Sec-Fetch-Dest: document`) — a page's own `<script src>`/`<link rel="stylesheet">` requesting a
  genuinely broken asset never sets that header, so it still gets the immediate, plain `404` it
  always did, never the full `not-found.tsx` document body a browser would otherwise try (and fail)
  to parse as the JS/CSS it actually asked for.

- **Orbit's client-side navigation no longer applies a fragment under the WRONG, still-active
  `Content-Security-Policy`.** A document's active CSP is fixed at the navigation that created it —
  no later `fetch()` response, regardless of its own headers, is ever consulted by the browser to
  update it. Before this fix, navigating (via an in-app link click, never a hard reload/direct URL)
  from a page to another whose own resolved CSP genuinely differed — a stricter or looser per-page
  `Page({ headers: { csp } })`, or a guard-registered `cspGuard()` varying the policy per request —
  still swapped the destination's fragment into the DOM under the ORIGIN page's policy, even though
  the fragment's own response carried the correct header for its own page. Every full-document
  render now embeds its own resolved, nonce-normalized CSP signature as a `<meta>` tag
  (`modules/router/csp-signature.ts`); Orbit compares that against each fragment response's own
  `Content-Security-Policy` header (`modules/client/orbit.ts`, `modules/client/prefetch.ts`) before
  swapping, and degrades to a real, full navigation — the one thing that can actually apply a
  different CSP correctly — exactly when the two genuinely differ. Automatic, no configuration
  needed; a page with no CSP configured, or navigating between pages sharing the same resolved
  policy (the common case — only the per-request nonce differs, which is normalized away), is
  unaffected. Identical under both renderers (`--renderer=react`/`--renderer=preact`) and in both
  `zanix space dev` and production, since CSP resolution has never depended on either.

### Changed

- **Dependency floors bumped to match already-published sibling versions** — no code behavior
  change, purely widening the version ranges this package declares (`deno.jsonc`'s `imports`/
  `scopes` maps) and the lazy-loaded specifier string that mirrors them (`log.controller.ts`'s
  `AUTH_SPECIFIER`):
  - `@zanix/app`/`@zanix/app/runtime` (test-only `scopes` entry): `^0.2.1` → `^1.0.0`
  - `@zanix/auth` (lazy specifier only, not in `deno.jsonc`'s `imports`): `^0.8.0` → `^1.0.0`

## [1.1.0] - 2026-09-01

### Added

- **`PageContext.cspNonce`** (`typings/page.ts`) — carries this request's own CSP nonce into a
  page's `loader`/`action`, when `cspGuard` generated one (the default, zero-config `Page()`
  policy); `undefined` only when CSP is explicitly disabled for the page (`csp: false`). The same
  value `style-src`/`script-src` carry in the response's own `Content-Security-Policy` header — hand
  it straight through to `@zanix/space-ui`'s `Modal`/`Drawer`/`Toast`/`Tooltip`/`Popover` as their
  own `nonce` prop, since a CSP nonce never applies to a `style="..."` attribute, only to a
  `<style>` element, which is exactly what those components render for their functional positioning.
- **`BuildSpaceClientOptions.importModule`** (`modules/bundler/build-client.ts`) — overrides how
  `discoverPages` imports each page/layout module, forwarded to it unchanged. Needed when
  `buildSpaceClient` runs from OUTSIDE the consuming project's own process — `zanix space build`
  runs it from inside `@zanix/cli`'s own process, where a project-local import-map alias (declared
  only in the project's own `deno.json(c)`) would otherwise fail to resolve against `@zanix/cli`'s
  own configuration.
- **`renderPageForTest`'s new `Interactor` generic** (`modules/testing/render-page-for-test.ts`) — a
  page declaring a real `Interactor` (e.g. `SpacePageController<Params, DlqInteractor>`) now
  type-checks against `renderPageForTest`'s `Controller` parameter without a cast. Defaults to
  `never`, matching `SpacePageController`'s own default, and is inferred from `Controller` — never
  needs naming explicitly.
- **`@zanix/auth` added to `NATIVE_RUNTIME_MODULES`** (`modules/bundler/native-runtime-modules.ts`)
  — `zanix space dev`'s `ssrLoadModule` now resolves `@zanix/auth` to the exact same, native module
  instance the running dev process already holds, the same identity guarantee this list already
  gives `@zanix/space`/`@zanix/server`/`react`/`react-dom`/`preact`.

### Fixed

- **`SpacePageController.handleGet` and the 422 re-render path (`#renderInvalidAction`, reached
  through `handlePost`) now carry this request's real CSP nonce off `pageCtx.cspNonce`, not
  `undefined`.** `toPageContext` snapshots `ctx.locals[CSP_NONCE_LOCALS_KEY]` before
  `resolvePageChrome` ever runs `cspGuard` for the request, so a naive read of `pageCtx.cspNonce`
  always returned `undefined` regardless of the real nonce the response's own CSP header carried.
  Both call sites now reassign `pageCtx.cspNonce` from the resolved `nonce` after
  `resolvePageChrome` returns.
- **A `@Guard` resolving `@zanix/auth`'s `ZanixAuthProvider` by class reference
  (`ctx.providers.get(ZanixAuthProvider)`) no longer throws
  `[BaseInstancesContainer]: Target is
  not a constructor`.** A `@Guard` file reached through
  `ssrLoadModule` (never `space.app.ts` itself) that bare-imports `'@zanix/auth'` got a separate,
  Vite-transformed evaluation of `ZanixAuthProvider`, carrying none of the DI decorator metadata the
  native side's own `import '@zanix/auth/core'` registered — while a string-keyed
  `ctx.providers.get('auth')` lookup kept resolving the same underlying provider with no error,
  since it never depended on which JS object reference the caller held. `@zanix/auth` now resolves
  through this package's own native-runtime-module mechanism instead, closing the split.
- **A Comet's real `*.module.css`/CSS import no longer crashes hydration in dev mode.**
  `buildViteHotClientScript`'s hand-written `/@vite/client` replacement never exported the
  `updateStyle`/`removeStyle` names Vite's own CSS transform unconditionally imports for every real
  CSS/CSS-Modules import a client-environment module reaches, first load included — the browser's
  native ES module loader rejected the whole generated module outright
  (`SyntaxError: ... does not
  provide an export named 'removeStyle'`). Both are now real named
  exports, applying/removing a real `<style data-vite-dev-id>` element per module id, with the
  current page's own CSP nonce read and assigned before the element is inserted into the document (a
  nonce-based CSP evaluates a `<style>` element the instant it enters the document, so assigning it
  any later is already too late).

## [1.0.0] - 2026-08-31

### Added

- **`globalErrorHandler`/`ComposableErrorHandler`** (`modules/router/global-error-handler.ts`) —
  composes multiple `server.ssr.onError` recovery handlers into one.
  `bootstrapServers`/`bootstrapRemoteApp`'s own `server.ssr.onError` accepts exactly one handler,
  but a real app routinely needs more than one concern wired there — this package's own
  `createNotFoundHandler()` alongside an app-specific one (e.g. `@zanix/auth`'s own
  `recoverRotatedSessionCookie()`). Each handler is tried in order against the same error; the first
  one that returns a real `Response` wins, and one that returns `undefined` (this package's own
  established "not handled, fall through" convention) is skipped. `ComposableErrorHandler` names the
  real, wider return shape `createNotFoundHandler()`'s own returned function already follows
  internally (cast to the narrower native `OnErrorHandler` only at its own return statement) — write
  a recovery function against this type when it's meant to be composed here.

- **`PageContext.session`** (`typings/page.ts`) — carries this request's resolved `Session`
  (`@zanix/server`) into a page's `loader`/`action` and every `layout.tsx`'s own `loader`, mirroring
  how `csrfToken`/`population` already flow through `toPageContext`. Closes a real gap: a page-level
  `@Guard` (e.g. `@zanix/auth`'s `jwtValidationGuard`) resolving a session writes it onto
  `ctx.locals.session`, which no loader could previously reach — forcing a consumer to hand-roll a
  read-only re-verification of the session cookie in every layout that needs permission-gated UI,
  since the session-refresh mechanism single-use-rotates tokens and can't safely be called a second
  time in the same request. `toPageContext` now resolves `ctx.locals.session`, falling back to
  `ctx.session` — `ctx.locals.session` wins when both are set, since it reflects a page-level
  `@Guard`'s resolution running AFTER `@zanix/server`'s own request-setup pipe already merged
  whatever session existed earlier onto `ctx.session`. A read-only snapshot, same lifetime as
  `csrfToken`/`population` — `mockPageContext`/`mockHandlerContext` (`@zanix/space/testing`) both
  support it. Fixes `zanix-io/space#7`.

### Fixed

- **`buildCjsBundle` (`modules/bundler/cjs-interop.ts`) no longer produces a syntactically invalid
  SSR bundle for a relatively-required `.json` file** (`require('../package.json')`, the real shape
  `mongoose`'s own `lib/mongoose.js` uses). The generic CJS wrapper previously spliced a `.json`
  file's raw content — a bare object literal — straight into statement position right after a
  `const require = __cjsRequire__` declaration, producing `Parse failure: Expected a semicolon...`
  and crashing `zanix space dev`/`zanix space build` for any project depending on a package that
  requires its own `package.json` this way. A required `.json` file's factory now assigns its parsed
  content as `module.exports = <content>` instead, matching Node's own `require('./x.json')`
  semantics.
- **A bare `require(...)` with a SUBPATH into another package** (`mongoose`'s own real
  `require('mongodb/lib/bulk/common')` shape, as opposed to `require('mongodb')`, that package's own
  public root) **is now inlined exactly like a relative require**, instead of always being left on
  the external `__bareRequire__`/`__vite_ssr_import__` path. That external path only resolves a bare
  specifier WITHOUT a real referrer for any `node_modules`-rooted importer (a deliberate choice
  elsewhere in `bare-specifier-resolve.ts`, for an unrelated module-identity fix) — which fails
  outright for a deeply transitive dependency no project's own top-level import map declares
  directly, silently falling through to Vite's own SSR "bare string + known importer" fast path,
  which resolves it as an EXTERNAL module and skips this package's own CJS wrapping entirely —
  confirmed as the real, root cause of a `ReferenceError: exports is not defined` crash. A subpath
  specifier is never a package's own publicly-imported entry point another part of the graph would
  ALSO reach independently, so there is no shared-instance identity to preserve by leaving it
  external — inlining it, the same as a relative require, is both safe and correct. A bare
  specifier's own public root (no subpath) is untouched, still external, still preserving the
  Vite-deduped singleton `__bareRequire__` exists for.
- **A genuinely dynamic `import(specifier)` call — one whose argument isn't a plain string literal
  Vite's own import-analysis can resolve statically (a variable, a member expression, a template
  literal with real interpolation)** — is now forced through the SAME `__vite_ssr_dynamic_import__`
  runtime helper Vite's own transform already uses for an analyzable dynamic import, via the new
  `modules/bundler/dynamic-import-interop.ts`. Left untouched, such a call — the real shape a
  lazy-optional-dependency pattern uses (a specifier string held in a variable so an optional
  dependency is never imported unless actually needed) — reaches the SSR module runner as a raw,
  unintercepted native `import()`, bypassing `noExternal`/CJS interop/every other fix in this
  bundler entirely.
- **A bare `require(...)` for a genuinely optional dependency that fails to resolve at all at
  runtime** (`mongoose`'s own real `require('kerberos')` shape, always wrapped in its own
  `try/catch`) **no longer crashes the whole bundle's top-level evaluation.** The top-level
  `__bareRequire__` fetch previously awaited every bare specifier eagerly and let a rejection
  propagate straight out of the bundle's own module-level `await`, before the CJS module's own code
  — and its own `try/catch` around the `require()` call — ever ran. A failed fetch is now deferred
  instead: it's recorded in a separate `__bareModuleErrors__` map keyed by specifier, and only
  re-thrown lazily from `__bareRequire__(spec)` at the exact call site the original `require(...)`
  text was rewritten to — inside whatever `try/catch` the source already wrapped it in.
- **The generated PWA service worker (`modules/bundler/service-worker-source.ts`) now caches a
  non-navigation asset the first time it's actually fetched, not just the CSS/`offlineFallback`
  precached at `install`.** `install` never precached the JS bundles Vite emits (`client-entry-*.js`
  and any chunk) — only CSS — and the fetch handler for everything else was pure cache-first with no
  fallback write: `caches.match(request).then((cached) => cached || fetch(request))`. Confirmed via
  a real `zanix new space` project with `pwa` configured, built, and taken offline: a forced
  `fetch(url, { cache: 'reload' })` (bypassing the browser's own disk cache, which otherwise masked
  this in normal use) on the app's own hydration bundle failed outright once offline, leaving static
  SSR HTML with zero interactivity — while a precached CSS file kept serving fine. The fetch handler
  now caches falling back to network: a cache miss still fetches from the network exactly as before,
  but a successful (`response.ok`) response is also written into the same precache before being
  returned, so the hydration bundle — and every other same-origin asset — survives a later fully
  offline visit instead of only ever living in the browser's separate, unreliable disk cache.
- **`createSpaceDevEngine(...).transformClientAsset` (`modules/bundler/dev-engine.ts`) now returns a
  clean `404` for a second, structurally different "file not found" shape**, not just the one it
  already handled. A missing `.js`/`.ts`/`.css` request previously translated to a clean `404` only
  when Vite's own transform rejected with `code: 'ERR_LOAD_URL'` — the shape a genuinely
  unresolvable specifier produces. A second shape reaches the same catch for at least some requests:
  a plain `Error` thrown by the `@deno/vite-plugin`/`@jsr/deno__loader` bridge (the WASM loader Deno
  uses to read real files off disk), with no `.code` and no `.cause` — confirmed empirically
  (`constructor.name`/`name` both `"Error"`, `Object.getOwnPropertyNames` only
  `["stack",
  "message"]`, `cause` `undefined`, not a `TypeError`), leaving the message text as the
  only available signal. Left unhandled, this escaped as an uncaught error and fell through to the
  generic `500` path with a raw error message, instead of the same clean `404` an unrecognized
  extension (like `.png`) already got. Confirmed live against both `/sw.js` (a fixed PWA route that
  is never a real source file in dev, only generated at build) and an arbitrary nonexistent file,
  ruling out anything route-specific. The catch now also matches this second shape by its message
  text (`/^Import '.+' failed, not found\.$/`) — the only signal available, since no structured
  field exists to key off instead — and translates it to the same `null`/`404` path the first shape
  already took.

## [0.3.2] - 2026-08-31

### Added

- **A deterministic byte/count baseline for the `bench:space` architecture benchmark**
  (`deno task bench:baseline`/`bench:baseline:check`). `bench:space` itself stays report-only (its
  own doc already says so, correctly — FCP/LCP/interaction timings and even the renderer ratios in
  `bench:renderer` move with whatever else a shared machine is doing, and gating on them would
  produce noise, not signal), but four of its metrics —
  `htmlTransferredBytes`/`jsTransferredBytes`/`jsRequestCount`/`hydratedBoundaryCount` — are
  genuinely deterministic: the same build serves the same bytes every time, so a real regression
  there (a dependency leaking into the wrong renderer's bundle, an extra request, a missing hydrated
  boundary) is a real signal, not noise. `bench:baseline` records these into a committed
  `baseline.json`; `bench:baseline:check` re-measures and diffs against it, failing on a byte metric
  growing past a 10% tolerance or a discrete count changing at all. Deliberately NOT
  `@zanix/server`'s own `bench:baseline` shape (a hand-curated `baseline.ts` with
  statistically-derived regression margins) — that machinery exists because `server`'s ops/sec
  numbers are genuinely noisy timings needing repeated measurement to know how much noise a gate
  must absorb; these four metrics need no such margin, since a single run already is the ground
  truth. Wired into `benchmarks.yml`'s existing manual/weekly `space` job, right after `bench:space`
  itself — not into `ci.yml`'s per-PR `deno test` step, for the same cost/flake reason that job's
  own header comment already gives for keeping `bench:space` off every PR. `variants/measure-all.ts`
  factors the actual build+render+Chromium-measure pipeline out of `run.ts` so all three scripts
  (`run.ts`/`record-baseline.ts`/`check-baseline.ts`) share one implementation instead of drifting
  copies of it.

### Fixed

- **Preact Comet HMR silently applied nothing under `zanix space dev`** — a real Comet edit
  re-imported successfully (a genuine `200 OK` for the cache-busted module URL, the dev socket's own
  `client-module-changed` → `window.__spaceApplyClientUpdate` → `import.meta.hot.accept` path all
  firing correctly) yet the DOM never updated and nothing was logged, indistinguishable from HMR not
  working at all. Root cause: the `client` Vite environment had the same `@deno/vite-plugin`
  bare-specifier resolution asymmetry `canonicalBareSpecifierResolvePlugin` already fixes for `ssr`
  (see `bare-specifier-resolve.ts`'s own doc) — it only needs an importer shaped like a real npm
  package living inside `node_modules` and importing another bare specifier, the same ingredient
  `react-dom`'s own `require('react')` supplies for the pre-existing `ssr`-side `Invalid hook call`
  bug this plugin was originally written for. `@prefresh/core`'s own `import 'preact'` is exactly
  that ingredient for Preact's dev-mode Fast Refresh — confirmed live: it resolved to a different
  module id than `preact/jsx-runtime`'s own internal import of the same physical `preact` file,
  splitting Preact's `options` singleton in two. `@prefresh/core` patches Fast Refresh's re-render
  bookkeeping (`vnodesForComponent`) onto ONE copy; every vnode a Comet actually renders is created
  through the OTHER, unpatched copy — so `replaceComponent`'s own `vnodesForComponent.get(OldType)`
  lookup always misses, and the whole update flushes as a silent no-op. React never hit this: under
  Vite 8/Rolldown, `react()`'s Fast Refresh is Rolldown's own native `oxc.jsx` transform, not a
  Babel-injected npm package — there is no `node_modules`-resident package analogous to
  `@prefresh/core` importing `react`/`react-dom` via a bare specifier for the asymmetry to ever
  trigger. Fixed by letting `canonicalBareSpecifierResolvePlugin`'s canonical resolution run for the
  `client` environment too, not just `ssr` — closing the same class of duplicate-module-instance bug
  at its one real source instead of patching around it per-package. Verified against a real,
  published-JSR consumer project: `preact` now resolves to the identical
  `/node_modules/.vite/deps/preact.js` id from both `@prefresh/core`'s and the Comet's own JSX
  runtime's imports (previously a wrapped `@deno/vite-plugin` virtual id vs. a plain `/@fs/` path),
  and editing a Comet now applies live, with no reload, confirmed in a real browser session.

- **`composeSegments`'s own "no `error.tsx` anywhere" render-phase fallback crashed for every real
  consumer of this package**, the SSR-render-time sibling of `0.3.1`'s `buildSpaceClient` fix above.
  `DEFAULT_ERROR_VIEW_REACT_URL`/`DEFAULT_ERROR_VIEW_PREACT_URL` are real, absolute URLs computed
  against `import.meta.url` — a genuine `https://jsr.io/@zanix/space/<version>/...` URL for any real
  consumer resolving this package via `jsr:@zanix/space`, never `file://`.
  `render-page-react.tsx`/`render-page-preact.ts` unconditionally ran that URL through
  `fromFileUrl()`/`Deno.realPath()`, which only accept the local `file://` case and throw outright
  on a real `https:` one, crashing every render that reaches this fallback (an app with at least one
  page whose composition chain has no `error.tsx` of its own). Fixed the same way as
  `build-client.ts`: a non-`file://` URL is passed straight through unresolved. A known remaining
  gap: `resolveCometModuleUrl` still expects a manifest keyed by a local comet's own
  `chunk.facadeModuleId`, an opaque wrapped id this remote entry never produces, so the manifest
  lookup misses and falls back to the raw URL — this only affects client-side re-hydration of the
  fallback boundary after a LATER error, never the server-rendered response itself.

## [0.3.1] - 2026-08-30

### Fixed

- **`defineSpaceApp`'s always-on `logApi` registration crashed for every real consumer of this
  package.** `LOG_CONTROLLER_SPECIFIER` (`modules/runtime/define-space-app.ts`) resolved
  `log.controller.ts` through a bare, non-relative dynamic specifier
  (`'modules/log-api/controllers/log.controller.ts'`) that only resolves correctly when the RUNNING
  process's own root import map happens to declare a matching `modules/` alias pointing at this
  package's own `src/modules/` — true only inside this package's own test suite (and, by accident,
  inside `@zanix/cli`'s own dev checkout, which declares an UNRELATED `modules/` alias for its own
  tree). For every real consumer this either failed outright
  (`not a dependency and
  not in import map`) or, worse, silently misresolved into the CONSUMER's
  own unrelated `modules/` directory when one happened to exist, surfacing as a confusing
  `Module not found` deep inside someone else's project. Since `logApi` is never opt-in, this broke
  `zanix space dev`/`zanix
  space build` for every project. Fixed by resolving the specifier via
  `import.meta.resolve('../log-api/controllers/log.controller.ts')` instead — a real, absolute URL
  computed relative to this file's own location, needing no cooperation from any consumer's import
  map, while remaining just as invisible to Vite's static client-bundle analysis (the whole reason
  this was a non-literal specifier to begin with).
- **`buildSpaceClient`'s own default error-view auto-comet crashed for every real consumer of this
  package**, for any app with at least one page whose composition chain has no `error.tsx` of its
  own — the common case, not an edge one. `DEFAULT_ERROR_VIEW_REACT_URL`/
  `DEFAULT_ERROR_VIEW_PREACT_URL` (`modules/router/default-view-specifiers.ts`) are real, absolute
  URLs computed against `import.meta.url` — a genuine `https://jsr.io/@zanix/space/<version>/...`
  URL for any real consumer resolving this package via `jsr:@zanix/space`, never `file://`.
  `build-client.ts` unconditionally ran that URL through `fromFileUrl()`/`Deno.realPath()`, which
  only accept the local `file://` case and throw outright on a real `https:` one — a crash this
  package's own test suite never caught, since its own tests exercise a local checkout. Fixed by
  passing a non-`file://` URL straight through unresolved (`toEntryName` gained a matching
  scheme-aware branch, since `relative()` also only accepts two real filesystem paths) — `deno()`/
  `prefixPlugin` already resolve any other JSR-hosted specifier the same way.

## [0.3.0] - 2026-08-30

### Added

- **`definePreHandler()`/`getUserPreHandler()`** (`modules/middleware`) — the sibling registration
  mechanism `preHandler` was missing: a consumer's own `preHandler` (e.g. `langPreHandler`),
  declared via `definePreHandler()` from anything `space.app.ts` imports, is now visible to BOTH
  `zanix space dev` and a production boot, the same dev/prod parity `defineMiddleware`'s guards
  already had. Before this, a `preHandler` passed only to `mod.ts`'s own
  `bootstrapRemoteApp({
  server: { ssr: { preHandler } } })` was invisible under `zanix space dev`
  — that command never imports `mod.ts`, only `space.app.ts` — so `GET /` (an unprefixed
  `routes/[lang]/...` URL) 404'd under `dev` instead of redirecting, while working correctly in
  production. Not a `SpaceAppConfig` field, deliberately — see `definePreHandler`'s own doc for why.
- **`CompiledMessageNode`** (`modules/i18n`) — the exported node shape `Messages` now allows
  per-key, structurally mirroring `@formatjs/icu-messageformat-parser`'s own `MessageFormatElement`
  without actually depending on it (enforced by `dependency-boundary.test.ts`).
- **`loadMessages()` now reads compiled catalogs from `{clientBuildDir}/messages/...` in
  production**, mirroring `clientBuildDir`'s own contract for the client bundle's manifests
  (comets/CSS/assets/PWA). `messagesDir` itself — the developer's own hand-authored ICU source — is
  never read from in production once a build has run; only under `zanix space dev` (which never
  compiles anything) does `loadMessages()` still read `messagesDir` live. See `@zanix/cli`'s own
  CHANGELOG for the matching `writeCompiledMessagesTree` fix this pairs with.

- **`SpaceAppConfig.clientEntry`, and a zero-config, auto-generated default client entry.** Every
  full-document response's own bootstrap script now wires `hydrateComets()`/`initOrbit()` in
  automatically, correctly `nonce`'d for a strict `script-src` CSP, with no file to write — the same
  "no manual step" reasoning `'use comet'` already gives Comet registration. `buildSpaceClient()`
  always includes this generated entry as a real `rollupOptions.input`, and `clientEntryPlugin`
  (`modules/bundler/client-entry-plugin.ts`) resolves/serves it in both `zanix space dev` and
  production. Set `clientEntry` to a real source file of your own (e.g. `'./src/main.client.ts'`)
  only when a project genuinely needs extra client-side code beyond the default pair — that file
  then REPLACES the generated entry and is fully responsible for calling
  `hydrateComets()`/`initOrbit()` itself. A production boot loads this entry's own build manifest
  via the new `loadClientEntryManifest('./.dist/client/client-entry-manifest.json')`, the same
  convention `loadCometManifest`/`loadCssManifest` already follow.

- **`SpaceAppConfig.clientBuildDir`** — set to the client build's own output directory (e.g.
  `'./.dist/client'`) and this app's `setup()` automatically loads every production manifest a real
  `zanix space build` wrote there: `loadCometManifest`, `loadClientEntryManifest`,
  `loadCssManifest`, `loadAssetsManifest`, `loadAssetsBuildOutput`, `loadPwaBuildOutput`, and
  `loadSitemapManifest` (this last one only relevant for `sitemap: 'auto'`, in that fixed order —
  PWA before sitemap, since `registerPwa` reads its own build output back immediately afterward). A
  production `main.ts` no longer has to call any of the seven manifest loaders by hand. Omitted
  entirely by default (no file read, zero cost), same convention as `assetsDir`/`pwa`/`sitemap`, and
  skipped entirely under `zanix space dev` — loading a stale manifest left over from a previous
  build into a live dev session resolves Comets to that OLD build's own hashed chunk names instead
  of the current source Vite is serving. A new warning now also fires if any of these manifests
  loaded but `assetsDir` isn't configured — that build output would otherwise have no route to serve
  it and 404 unexplained.
- **`SpaceAppConfig.sitemap: 'auto'`** — derives `sitemap.xml` entries from this app's own static
  route tree instead of a hand-written source: every discovered page with no dynamic segment (except
  a `:lang` param backed by a registered `langPreHandler`, which expands into one entry per
  `availableLangs`), no unconditional `redirect`, and no `noindex` in its resolved head.
  `zanix
  space build` precomputes these (`deriveAutoSitemapEntries`,
  `modules/bundler/auto-sitemap.ts`, the same static discovery pass document validation already
  runs) and writes them to `{outDir}/sitemap-manifest.json`; production only reads that back
  automatically when `clientBuildDir` is also set (otherwise call `loadSitemapManifest` directly
  from `main.ts`). Under `zanix space dev`, entries are recomputed on every request instead, so they
  always reflect current source. New supporting exports:
  `getSitemapDeclaration`/`setSitemapDeclaration`, `SitemapDeclaration`,
  `getSitemapManifest`/`loadSitemapManifest`.
- **`getBootstrapSpaceAppConfig()`/`defineBootstrapSpaceAppConfig()`** (`modules/runtime`) — the
  bootstrap-options counterpart to `definePreHandler`, with the same dev/prod parity problem and
  fix: an app's `bootstrapRemoteApp`/`bootstrapServers` options (a custom `rest` config,
  `remoteInstances`, `uses`/`resources` bindings, a non-default `ssr`/`socket` port) declared only
  in `mod.ts`'s own call were invisible to `zanix space dev`, which never imports `mod.ts`.
  `defineBootstrapSpaceAppConfig`, called from `space.app.ts` (or anything it imports), registers
  them once for both; `getBootstrapSpaceAppConfig()` reads them back, always defaulting
  `server.ssr`/`server.rest` to `{}` when unset. Purely additive — most apps never need this.
- **`GET /assets/:path*`'s hashed build-output serving now supports conditional requests**
  (`If-None-Match`) — a matching `ETag` now returns a real `304 Not Modified` with no body, checked
  before the file is even read from disk, instead of always re-sending the full asset on every
  request regardless of whether the browser's cached copy is already current.
- **`.js`/`.mjs`/`.css` added to `content-type.ts`'s content-type table** — this same `/assets/...`
  route also serves the client build's own hashed JS/CSS once `loadAssetsBuildOutput` is loaded, and
  a browser refuses to execute a `<script type="module">` served as `application/octet-stream` at
  all (a strict MIME check, not just content-sniffing). `.js`/`.mjs` resolve to the modern,
  IANA-registered `text/javascript`.
- **`langPreHandler`'s `FRAMEWORK_PREFIXES` now includes `/sitemap.xml` and `/robots.txt`** — a
  crawler-facing route needs one canonical, unprefixed URL, never a per-language redirect/duplicate.
- **`'server-only'` module violations are now caught under `zanix space dev` too, not just at build
  time.** `dev-engine.ts`'s own `transformClientAsset` runs the same check `cometPlugin` already
  enforces at `buildEnd` (sharing its violation-message formatter, `formatServerOnlyViolation`, now
  exported from `server-only-directive.ts`), reported per-request instead, since dev never runs a
  real Rollup build to walk.
- **`SsrModuleChangedEvent.isComet` and `SpaceDevEngineOptions.onFullReloadNeeded`/
  `broadcastFullReloadNeeded`** (`modules/dev/space-dev-socket.ts`) — `isComet` lets a caller tell
  "only a Comet changed" (already handled via its own `client-module-changed` update) apart from "a
  route's own file or a server-only dependency changed" (needs a real reload), without discarding
  client-only state on the Comet-only path. `onFullReloadNeeded`/`broadcastFullReloadNeeded` bridge
  Vite's own internal `full-reload` signal (fired when its dependency optimizer re-runs mid-session
  and discovers a new dependency) to connected browsers — this engine never bound that channel to
  anything real before, so the signal previously went nowhere; confirmed as a real incident for
  `@prefresh/core`, where a stale version-hash reference silently loaded a second, duplicate module
  instance and broke Preact Fast-Refresh with no error.

- **`hydrateErrorBoundaries()`** (`@zanix/space/client`, `@zanix/space/client/preact`;
  `modules/client/hydrate-error-boundaries.ts`/`-preact.ts`, `modules/client/reconstruct-error.ts`,
  `modules/router/error-boundary-marker.ts`) — the client-side half of `error.tsx` recovery, wired
  into every auto-generated client entry (`client-entry-plugin.ts`) right alongside
  `hydrateComets()`/`initOrbit()`. On React, mounts the real `error.tsx` Fallback fresh once it
  finds React's own postponed streaming-SSR recovery marker (`<!--$!-->` + `<template>`) — the
  client-side counterpart `error-boundary.tsx`'s own doc previously described as "not implemented
  yet." On Preact, attaches real interactivity (a working `reset` button) to a Fallback whose SSR
  pass already rendered correctly, since Preact core's own renderer never gives up on a boundary the
  way React's does. Re-invoked after every Orbit outlet swap (`hydrator-registry.ts`'s new
  `getErrorBoundaryHydrator`/`setErrorBoundaryHydrator`) so a retried, still-failing segment
  recovers again — not just once, at initial page load.
- **`ErrorBoundaryProps.params`/`.messages`/`.formattedError`, and `reset` is now a real retry** —
  an `error.tsx` now receives this segment's own resolved route params, its resolved i18n message
  catalog (`messages`, `undefined` when the app has no `messagesDir`; falls back to the new
  `DEFAULT_IMPLICIT_LANG` catalog folder for a segment with no real `lang` param), and
  `formattedError` (`serializeError(error)` from `@zanix/errors`, the same redacted shape
  `logger.error`/`@zanix/server`'s own HTTP error responses already use), alongside the raw `error`.
  Once client-hydrated, `reset` is `retryOutlet` (`modules/client/orbit.ts`) — a real Orbit
  re-fetch/swap of the current page, not a local in-place re-render: a freshly mounted Fallback has
  no live reference to whatever originally threw, so only a real round-trip to the server can
  actually recover.
- **`NotFoundProps` (new type)** — `not-found.tsx` can now declare `{ lang, messages }` in its own
  default export's props, resolved via the new `resolveRequestLang()`
  (`modules/middleware/lang-pre-handler.ts`, cookie → `Accept-Language` → `defaultLang`, the same
  priority `langPreHandler` itself already applies) for a 404, which has no matched route to draw a
  `:lang` param from. Optional — an existing `not-found.tsx` declaring neither keeps working
  unchanged.
- **A page with NO `error.tsx` anywhere in its own composition chain no longer crashes with a raw,
  empty `500` on a render-phase failure.** `composeSegments` (`render-page-react.tsx`/
  `render-page-preact.ts`) now wraps the whole page in a fallback `SpaceErrorBoundary` using this
  package's own `DefaultErrorView`, exactly as `loader-error-handler.ts` already did on the
  data-phase (`loader`) side — auto-bundled as a real client entry (`build-client.ts`, gated on at
  least one page actually needing it) the same way an author's own `error.tsx` already is.
  `cometPlugin`'s own `CometPluginOptions.knownEntryPaths` now also seeds `comets-manifest.json`
  entries directly (not just skips duplicate-chunk forcing), which is what makes an auto-discovered
  `error.tsx`/`DefaultErrorView` — never author-marked `'use comet'` — resolvable client-side at
  all.
- **`SpaceAppConfig.errorResponse: 'view' | 'json'`**
  (`modules/router/error-response-format-registry.ts`) — for an app built on `@zanix/space` purely
  for its routing, with no document shell of its own: when a route declares no
  `error.tsx`/`not-found.tsx`, the built-in fallback can now return a plain JSON body
  (`httpErrorResponse(error)`/`httpErrorResponse(new HttpError('NOT_FOUND'))`, `@zanix/server`)
  instead of a rendered HTML document. Checked only in `loader-error-handler.ts`/
  `not-found-handler.ts` — never overrides an app's own `error.tsx`/`not-found.tsx`, and never
  applies to the render-phase "no error.tsx anywhere" fallback above, which by the time it's reached
  has typically already started streaming `text/html`, with no way to retroactively become JSON.
- **`createReloader()`/`ReloadDescriptor`** (`@zanix/space/comet`, `modules/comets/reloader.ts`) —
  replays a `RestClient`/`GraphQLClient` call a Comet received a `reload: true` descriptor for, as a
  plain prop, the same way it already receives its initial data. Renderer-neutral, always rejects on
  failure rather than swallowing it — no `onError` option of its own. New `docs/data-fetching.md`
  documents the full round trip, including `@zanix/server`'s own `reloadDescriptor`/
  `reloadableHeaders`/`schemaApplication` contract on the other side of the wire (that half ships
  from `@zanix/server`'s own release, not this package's).

### Changed

- **`defineComet`, `loadCometManifest`, and `resolveCometModuleUrl` moved from `@zanix/space` (`.`)
  to `@zanix/space/comet`.** Breaking for any Comet still importing `defineComet` from
  `'@zanix/space'` directly — update it to `'@zanix/space/comet'`. This closes a real, confirmed
  browser-build failure: `.` also carries genuinely server/dev-only code in the same barrel
  (`defineSpaceApp`, and `SpaceDevSocket`, a real TC39-decorated class a normal browser-side
  transform can't even parse) — a plain ES module barrel resolves every one of its own export
  statements' source files the moment anything is imported from it, so a Comet's own
  `import { defineComet } from '@zanix/space'` forced that entire server-side graph into the client
  bundle too. Type-only exports (`CometComponent`, `CometBoundaryComponent`, ...) are unaffected —
  erased at build time, still available from `.`.

### Fixed

- **`Messages` (`loadMessages()`'s own return type) no longer lies once `zanix space build` has
  compiled `messagesDir`.** It was `Record<string, string>`, but the build compiles every catalog
  value to ICU AST in place — so in production a value is actually a `CompiledMessageNode[]`, not a
  `string`, with no type error at any call site that interpolated `messages[key]` directly as a JSX
  child. That pattern rendered fine under `zanix space dev` (which never compiles) and crashed in
  production ("Objects are not valid as a React child"). `Messages` is now
  `Record<string, string |
  CompiledMessageNode[]>`, and this package's own
  README/`docs/i18n.md`/JSDoc examples now show the safe pattern (`@zanix/space-ui`'s
  `IntlProvider`/`useIntl().formatMessage()`, which already accepted either shape) as the primary
  usage, not direct interpolation.

- **`zanix space dev` silently registered zero real routes for every `@Page(...)`-decorated page —
  every request 404s, with no error anywhere.** `createSpaceDevEngine`'s own `ssrLoadModule`
  resolved a route file's `import { Page, SpacePageController } from '@zanix/space'` (and,
  transitively, `@zanix/server`) like any other project dependency, transforming and evaluating
  `@zanix/space`/`@zanix/server`'s own source as a SECOND, Vite-transformed copy — structurally
  identical to, but reference-DIFFERENT from, the copy the native `zanix space dev` process itself
  already used to run `defineSpaceApp`/`loadRoutes`/`bootstrapServers()`. `@Page()`'s decorator ran
  correctly, but registered into that second copy's own registries (`page-decorator.ts`'s
  `pendingPages`, `@zanix/server`'s `ProgramModule`) — never the native side's, the only one
  `Deno.serve()` actually dispatches requests through. Fixed by resolving `@zanix/space`,
  `@zanix/server`, `react`, and `react-dom` to a synthetic externalized id
  (`nativeRuntimeModulesPlugin`, `modules/bundler/native-runtime-modules.ts`) that the SSR module
  runner's evaluator (`ssr-module-evaluator.ts`) decodes back to a plain native `import()` of the
  ORIGINAL specifier — resolved by Deno against the exact same import map the native process already
  used, returning the identical, already-loaded module instance instead of a duplicate. `react`/
  `react-dom` needed the identical fix for the same reason: a hookless component rendered fine
  either way, but any component actually calling `useState()` (or any other hook) threw
  `Invalid
  hook call`, unconditionally, because `react-dom/server`'s renderer installs its hooks
  dispatcher on a DIFFERENT `react` module instance than the one the duplicated component's own
  `useState` read from.

- **A Comet or Orbit outlet boundary silently lost its own `display: contents` rule under this
  framework's own default, strict CSP (`style-src 'self' 'nonce-...'`, no `'unsafe-inline'`) —
  reverting to a real, unstyled `<div>` that could break a parent `display: grid`/`flex` layout.** A
  `nonce` never covers an inline `style` ATTRIBUTE (only a `<style>` element or
  `<link
  rel="stylesheet">`), so a real browser silently dropped the previous
  `style={{ display: 'contents'
  }}` prop under that policy. Fixed by emitting the rule once,
  unconditionally, as a real nonce'd `<style>` tag in every full-document response
  (`builtin-css.ts`) instead of an inline attribute on each boundary/outlet element.

- **The root entry point (`.`) also materialized `@vitejs/plugin-react`, `@preact/preset-vite`, and
  `@rolldown/plugin-babel` — build-tooling for BOTH renderers, regardless of which one an app
  installs — merely by re-exporting `SpaceDevSocket`.** `modules/dev/mod.ts` (the `./dev` subpath's
  own entry) is a single barrel co-locating `SpaceDevSocket`/`broadcastSsrModuleChanged` (what `.`
  actually re-exports) with `createSpaceDevEngine`/`spacePlugin` (`../bundler/dev-engine.ts`/
  `../bundler/space-plugin.ts`, never re-exported from `.` itself) — a plain ES module barrel
  resolves every export statement's source file the moment anything is imported from it, so `.`
  reaching for `SpaceDevSocket` alone forced `spacePlugin`'s own unconditional
  `@vitejs/plugin-react`/ `@preact/preset-vite` import along with it. Fixed by extracting the narrow
  slice `.` actually needs into the new `modules/dev/socket-exports.ts` —
  `SpaceDevSocket`/`broadcastSsrModuleChanged`/
  `SPACE_DEV_SOCKET_ROUTE`/`ZanixWebSocket`/`SocketPrototype`/`SsrModuleChangedEvent`, nothing from
  `../bundler/` — and repointing `.`'s own re-exports at it instead of the full barrel. `./dev`
  (`modules/dev/mod.ts` itself) is unchanged, still exporting everything `zanix space dev` needs.
  `vite`/`@deno/vite-plugin` remain reachable from `.` regardless — `SsrModuleChangedEvent` is
  `broadcastSsrModuleChanged`'s own parameter type, defined in `dev-engine.ts`, whose real value
  imports resolve the moment its type is referenced, the same `import type` reachability rule as
  everywhere else in this package. Confirmed via `deno info --json --min-dep-age=0`: `.` drops from
  7 `npm:` specifiers to 4 (`vite`, `@deno/vite-plugin`, and their own `/resolver`/`/module-runner`
  subpaths); `./dev` stays at 7, unchanged.

- **`zanix space dev` crashed with `ENOENT: no such file or directory, open 'https://jsr.io/...'`
  whenever a Comet imported a JSR-hosted package directly (including `@zanix/space` itself).**
  `denoOptimizeDepsAliasPlugin` (`modules/bundler/deno-optimize-deps-alias.ts`) walks every Comet's
  own import graph and adds each bare specifier it finds to `optimizeDeps.include` plus a
  `resolve.alias` entry pointing at whatever `resolveDeno` resolves it to. For a package genuinely
  served from JSR — never vendored into a local `node_modules`-style store — that resolution is the
  package's own canonical `https://jsr.io/...` specifier, not a local file path; feeding that
  straight into Vite's `optimizeDeps` back-compat resolver as an alias replacement handed its own
  dependency scanner (`extractExportsData`) a URL string to `fs.readFileSync`, which always fails.
  Fixed by skipping any specifier whose resolution starts with `http://`/`https://` — both for the
  alias and for `optimizeDeps.include` membership, since a real ESM module served remotely already
  works through `@deno/vite-plugin`'s own transform path and never needed the CJS-interop this
  plugin exists for in the first place. Covered by a new regression test asserting a Comet-imported
  JSR package (`@std/uuid`) transforms correctly with no alias/include entry ever created for it.

- **`zanix space dev` threw `Route path "..." is already defined` on every reload of a page using an
  EXPLICIT `@Page(path)`, permanently stuck re-serving stale content.** Root cause: a pathless
  `@Page()` defers registration until after import, letting `loadRoutes()` compare identities and
  deregister a stale class first — but an explicit `@Page(path)` registers synchronously, DURING
  import itself, before `loadRoutes()` ever gets a chance to do that comparison, so a genuine file
  change re-registers at the same path while the previous, now-stale registration is still live.
  Because the collision throws mid class-definition, the fresh class binding is never even created —
  there is nothing left to retry with once that happens. Fixed by evicting the stale registration
  BEFORE the collision can occur instead: `loadRoutes()` now wraps each page's own `importModule()`
  call in an `AsyncLocalStorage`-scoped context (`withPendingReplacement`, `page-decorator.ts`)
  carrying that file's previous target class; `registerPage` reads it back and deregisters that
  exact class first if it's still live, never anyone else's — a genuine collision between two
  unrelated pages that happen to declare the same path still throws exactly as before. Covered by
  two new tests: one confirming the recovery serves the fresh content with the stale registration
  gone, one confirming a genuine cross-page collision still throws.
- **`zanix space dev` could corrupt its own route registration under rapid, repeated saves of the
  same page file** (several `Ctrl+S` in quick succession) — two overlapping `loadRoutes()` calls for
  the same page each independently reimported it and raced to register the same route path;
  whichever finished first won, the second collided and threw, but the LOSING call had already
  overwritten the page's own bookkeeping entry with a class that was never actually registered —
  every later reload (for any file, since a call always reprocesses every page) then hit the same
  collision forever, until the process restarted. `loadRoutes()` now serializes calls onto a shared
  queue (a call arriving while a previous one is still running waits for it to finish first), making
  that corrupted state structurally impossible — a call always starts from whatever consistent state
  the previous one left behind. Adds no latency to the common single-call case.
- **A renamed or deleted page file kept serving its previous route forever under
  `zanix space
  dev`**, since `loadRoutes()`'s own bookkeeping only ever grew and nothing revisited
  a file that had disappeared. Fixed by deregistering any previously-registered page whose file no
  longer exists under `routesDir` on every reload.
- **`zanix space dev` crashed with an opaque `TypeError: Invalid value used as weak map key` for a
  `page.tsx` still being scaffolded** (folder and empty file created, component and `@Page()` not
  written yet) — `loadRoutes()` now recognizes a page with no valid default export, logs an
  actionable warning instead, and skips registering it, without failing every other page's own
  reload in the same batch.
- **A page's routes were not restored after `@zanix/app`'s `uninstallApp`/`installApp` hot-reinstall
  when the page's file hadn't changed on disk.** A plain `import()` (no dev engine) hits Deno's own
  module cache and returns the identical, already-evaluated class, so `@Page()`'s decorator never
  reruns and never re-registers it. `resolvePendingPage` now checks whether the class's routes are
  actually still live (`ProgramModule.routes.hasRoutesForTarget`) rather than only trusting "already
  resolved once, so it must still be fine," and re-registers using the same options the class was
  originally decorated with (now kept for the class's lifetime instead of discarded after first
  use).
- **`zanix space dev` never auto-reloaded a connected browser tab on a plain SSR change** (an edited
  `layout.tsx`/`loader`/the route file itself) — `devClient.routeFilePath`, sent on every
  full-document response, was left relative to `routesDir` while the dev socket's own
  `handleSsrModuleChanged` compares it against `SsrModuleChangedEvent.affectedRoutes` (always an
  absolute path, from Vite's own module graph); the comparison silently never matched, in every
  project regardless of renderer. Fixed by resolving `routeFilePath` to an absolute path before it's
  sent.
- **The dev client could get permanently stuck silently applying nothing on a real edit**, needing a
  manual full refresh to recover, in two related races: (1) this dev socket's own WebSocket
  connection could finish — and start relaying an edit — before a Comet's own concurrently-requested
  dynamic `import()` of `/@vite/client` had resolved, leaving `__spaceApplyClientUpdate` undefined
  when the message arrived; (2) a Comet whose own first load failed on a static import (e.g. a
  `'server-only'` violation) never reached its own `import.meta.hot.accept(...)` call, permanently
  leaving no callback registered for that url — so even a later, genuinely fixed edit kept doing
  nothing. Both cases now fall back to a real `location.reload()` instead of a silent no-op,
  matching this client's existing "never silently stuck on stale code" handling of its other two
  failure modes.
- **`assets-manifest.ts` failed a Comet's build with an opaque, unhelpful bundler resolution error**
  instead of `cometPlugin`'s own clear, named violation message, whenever a `'use comet'` file
  transitively imported `resolveAssetHref` (e.g. through a wrapper component) — this module holds
  genuinely server-only state (`Deno.readTextFile`, a module-scoped manifest) but was missing the
  `'server-only'` directive that makes that failure mode actionable rather than a bare "module not
  found." Now marked `'server-only'`, consistent with every other server-only module in this
  package.

- **A route with no dynamic segments at all (e.g. the plain `population` template's root `/`, no
  `[lang]`) could crash `resolvePageChrome`/`renderLoaderErrorPage`/an app's own `error.tsx`/
  `not-found.tsx` on an unguarded `params.lang` read.** `ctx.payload.params` is `undefined`, never
  `{}`, for that case — `toPageContext` (`space-page-controller.ts`) now defaults it once, at the
  source, instead of three independent call sites each guarding (or forgetting to guard) against it
  themselves.
- **`zanix space dev` 404'd on this package's own built-in `default-error-view.tsx`/`-preact.ts`,
  and on any file a Deno workspace member resolves OUTSIDE the dev server's own project root** (a
  sibling `@zanix/space`/`@zanix/space-ui` checkout linked via `deno.json`'s `workspace`, for
  instance) — `resolveCometModuleUrl` (`comet-manifest.ts`) now emits Vite's own
  `/@fs/<absolute-path>` convention for exactly that case instead of an un-prefixed absolute path no
  dev route ever answers, and `createSpaceDevEngine` now sets `server.fs.strict: false` — Vite's
  default `fs.allow` walk stops at the first `.git`/lockfile boundary it finds, which a Deno
  workspace member's own `.git` (every project `zanix new` scaffolds has one) never lets it cross to
  reach the shared workspace root.
- **Resolving `DEFAULT_ERROR_VIEW_REACT_URL`/`DEFAULT_ERROR_VIEW_PREACT_URL`
  (`default-view-specifiers.ts`) via `import.meta.resolve` broke every page render under
  `zanix space dev`** — its own Vite-based SSR module runner intercepts `import.meta.resolve` but
  leaves the plain `import.meta.url` property untouched, so calling it threw
  `TypeError
  [ERR_UNSUPPORTED_ESM_URL_SCHEME]` the moment
  `render-page-react.tsx`/`render-page-preact.ts` loaded through that runner (which they always do,
  in dev). Fixed by resolving via plain `new URL(specifier, import.meta.url)` algebra instead — pure
  string computation, never touches Vite's patched function.

## [0.2.0] - 2026-08-26

### Added

- **`@zanix/space/vite/assets` and `@zanix/space/vite/media`** — narrower siblings of `./vite`'s own
  barrel (`bundler/mod.ts`), for a consumer that only ever needs ONE of `assetsPlugin`/
  `mediaPlugin`. `./vite` itself re-exports both from the same file, and a plain ES module barrel
  resolves every one of its own export statements' source files the moment anything is imported from
  it — so importing only `mediaPlugin` from `./vite` still resolved `assets-plugin.ts`, and
  transitively `sharp`/`svgo`, purely as a side effect of the barrel shape. `./vite/media` points
  directly at `media-plugin.ts` and resolves neither (confirmed via `deno info --json`: zero `npm:`
  specifiers beyond `vite` itself, down from `sharp`+`vite`); `./vite/assets` points at
  `assets-plugin.ts` and never resolves anything `mediaPlugin` alone would pull in. `./vite` is
  unchanged — same symbols, same cost, for every existing consumer already importing both from
  there.

### Fixed

- **`mediaPlugin` (`@zanix/space/vite`) materialized `sharp` even though its own video/audio
  transcoding is entirely FFMPEG-backed and npm-free** — traced to
  `modules/asset-transform/
  asset-transformer.ts`'s single-file `createAssetTransformer`, which
  unconditionally, statically imported `optimizeImageAsset` (`modules/assets/image-optimize.ts`,
  `sharp`-backed) as its default `transformImage` implementation, even for a caller (`mediaPlugin`)
  that never calls `transformImage` at all. Merely loading that one shared file — needed for its
  `transformVideo`/ `transformThumbnail`/`transformAudio` — forced `sharp`'s own resolution
  regardless. Split into `image-transformer.ts` (`createImageTransformer`, sharp-backed,
  `transformImage` only) and `media-transformer.ts` (`createMediaTransformer`, entirely
  FFMPEG-backed, `transformVideo`/ `transformThumbnail`/`transformAudio` only) — `assetsPlugin` and
  `mediaPlugin` each construct their own narrow transformer directly instead of the combined one.
  `createAssetTransformer` itself stays public, unchanged in shape
  (`AssetTransformer`/`AssetTransformerOptions`), now a thin compositor of both for a caller that
  genuinely needs all four kinds together in one instance (`assets-api`'s `AssetService`, and this
  suite's own tests) — sharing exactly one resolved cache store across every kind, matching the
  pre-split single-instance contract those callers already expect. Confirmed via `deno info --json`:
  `media-plugin.ts` alone dropped from `sharp`+`vite` to `vite` only; `assets-plugin.ts` alone is
  unaffected (`sharp`+`vite`, unchanged).
- **`assetsPlugin({ optimize: { images: true } })` (raster-only, `optimize.svg` never configured)
  still materialized `svgo`** — `modules/assets/optimize-runner.ts`'s `createOptimizeRunner`
  unconditionally, statically imports `optimizeSvgAsset` (`svg-optimize.ts`) alongside
  `optimizeImageAsset`, regardless of which one a given build actually calls, and
  `svg-optimize.ts`'s own `getSvgo()` resolved `svgo` via a LITERAL `await
  import('npm:svgo@^3')`
  — a literal dynamic-import specifier is followed by Deno's static dependency-graph analysis (and,
  transitively, a real `zanix space build`'s own Rolldown scan) regardless of whether the call is
  ever reached at runtime. The real gate (`optimize?.svg` truthy, checked before
  `runner.optimizeSvg` is ever called) was already correct — only the IMPORT itself was
  unconditionally reachable. Fixed by centralizing the specifier as `SVGO_SPECIFIER` in the new
  `src/modules/lazy/specifiers.ts` (matching the same convention
  `@zanix/admin`/`@zanix/core`/`@zanix/cli` already use) and routing `getSvgo()`'s `import()`
  through that non-literal constant instead. Confirmed via `deno info --json`: `svg-optimize.ts`,
  `optimize-runner.ts`, and `assets-plugin.ts`, checked individually, all dropped `svgo` entirely
  (from 16 to 15 total `npm:` specifiers on the full `./vite` barrel); `sharp` is unaffected on all
  three — it is a genuine, always-needed cost of `assetsPlugin`'s own raster-image feature, not
  further separable the way `svgo` (a distinct, independently-configurable `optimize.svg` feature)
  was.
- `log.controller.ts`'s default `rateLimitGuard` statically, unconditionally imported `@zanix/auth`
  at module top level — and `@zanix/auth` itself has a real dependency on `@zanix/datamaster` (for
  this guard's own Redis-backed counter storage), which pulls
  `mongoose`/`mongodb`/`bson`/`redis`/`@redis/*`. Because `log.controller.ts` is registered as part
  of every `defineSpaceApp()`'s own `setup()` (core, non-opt-in plumbing, per this file's own doc),
  this dragged that whole dependency tree into EVERY `@zanix/space` app's build, whether or not it
  ever used the Log API's rate limiting — confirmed as the one remaining real source after fixing
  the identical root cause in `zanix-io/app`'s own `activateApps`/`registerApp` (see that package's
  own `[Unreleased]` entry): a real `zanix space build` against a project linked to the fixed `app`
  checkout still materialized `mongoose`/`redis` into `node_modules/.deno`, traced via
  `deno info --json`'s own dependency graph to this file.
  - The real `rateLimitGuard` is now constructed lazily, on this guard's first genuine invocation (a
    real `POST /api/log` request), through a deliberately non-literal, fully-qualified `jsr:`
    `import()` specifier — never a bare alias, never at `createLogApiController`-call time.
    Promise-memoized per `createLogApiController()` call (never module-level), so two concurrent
    first requests never construct/import twice, and two controller instances with different
    `rateLimit` overrides never share a memoized guard built from the wrong options.
    `createLogApiController` itself stays fully synchronous — no public API change.
  - `@zanix/auth`, `@zanix/datamaster/storage`, and `@zanix/datamaster/core` are now absent from
    `deno.jsonc`'s own top-level `imports` entirely (moved to a `scopes` entry for `./src/@tests/`
    only) — confirmed, via the identical experiment already run against `zanix-io/app`, that a bare
    alias declared there is, on its own, enough to trigger Deno's `nodeModulesDir: "auto"`-style
    npm-install materialization regardless of whether any reachable code imports it.
    `@zanix/app/runtime` (declared but, it turns out, never actually used outside this package's own
    test suite) moved to the same `scopes` entry for the same reason — `@zanix/app` (bare) stays,
    since `define-space-app.ts`'s own real use resolves through `@zanix/app`'s genuinely
    dependency-free pure-manifest entry point.
  - Real behavior confirmed unchanged: the existing fail-open-when-no-cache-provider test, and the
    rate-limit-enforcement/override/extra-guards tests, all still pass unmodified.
  - **Related, real, and NOT fixed here**: `zanix-io/space`'s own separate GitHub issue
    (`zanix-io/space#2`) tracked this exact finding before this fix landed — closing that issue is
    this same change.
- **The root entry point (`.`) materialized `sharp` even though its own top-level doc already
  claimed "importing it never evaluates `react`, `react-dom/server` or `preact`" and, implicitly,
  never touches sharp either** — traced to a single misplaced type, `AssetKind`
  (`modules/asset-transform/asset-transformer.ts`), whose own file also unconditionally
  value-imports `sharp`-backed `image-optimize.ts`. Every public option type that referenced
  `AssetKind` transitively — `AssetService`/`CreateAssetCommand`/`AssetsControllerOptions`/
  `AssetsOptimizeOptions`/`MediaOptimizeOptions`, each declared inline in its own real,
  value-importing implementation file (`asset-service.ts`, `assets.controller.ts`,
  `assets-plugin.ts`, `media-plugin.ts`) — carried the same cost merely by being `import type`-ed
  from `.`, `typings/manifest.ts`, and `modules/assets/asset-registry.ts`: Deno/TypeScript must
  still fully resolve a referenced file's own imports to extract its type shape, regardless of the
  importing statement's own `import type` keyword. Fixed by extracting every one of these interfaces
  into a narrow, sibling `-types.ts` file with zero heavy imports of its own
  (`asset-transform/types.ts`, `assets/image-optimize-types.ts`,
  `assets-api/asset-service-types.ts`, `assets-api/controllers/assets-controller-types.ts`,
  `bundler/assets-plugin-types.ts`, `bundler/media-plugin-types.ts`) and repointing every
  `import type` site — including `.`, `typings/manifest.ts`, and `asset-registry.ts` — at these new
  files instead. Each original implementation file re-exports its own type unchanged from the new
  sibling, so no existing consumer's import path changes. Confirmed via
  `deno info --json --min-dep-age=0 mod.ts`: `sharp` no longer appears among `.`'s reachable `npm:`
  specifiers.
- **The root entry point (`.`) also materialized `react` and `preact` themselves — the exact
  package's own claim the previous entry only partly closed** — two separate, unrelated causes:
  - `modules/router/space-page-controller.tsx` and `modules/router/not-found-handler.tsx` — both
    exported (directly or via `typings/manifest.ts`'s `PageHeaderOptions`) from `.` — contained no
    JSX syntax at all, yet, as `.tsx` files under this project's global `jsxImportSource: "react"`
    compiler option, each still carried an implicitly injected `react/jsx-runtime` dependency, as
    both a code AND a type edge — confirmed empirically with an isolated `.tsx`/`.ts` pair of
    otherwise-identical files: only the `.tsx` one resolves `react/jsx-runtime`, regardless of
    whether it contains a single JSX element. Fixed by renaming both to `.ts` — Deno's `.tsx`
    handling injects this pragma import purely from the file extension, never from actually
    detecting JSX usage first, so a `.tsx` file with zero JSX content pays the cost for nothing.
  - `not-found-handler.ts`'s `renderNotFoundResponse` and `loader-error-handler.ts`'s
    `renderLoaderErrorPage` each select their own built-in fallback view (`DefaultNotFoundView`/
    `DefaultErrorView`) per `getActiveRenderer()`, via `await import('./default-*-view.tsx')` for
    React or `await import('./default-*-view-preact.ts')` for Preact — but both branches used a
    LITERAL specifier, so Deno's static dependency-graph analysis resolved both, unconditionally,
    regardless of which renderer a given app actually activates — the identical root cause already
    fixed for `svgo` above. Fixed by centralizing all four specifiers in the new
    `modules/router/default-view-specifiers.ts` (a router-scoped sibling of `lazy/specifiers.ts`,
    since these are RELATIVE specifiers resolved against the calling module's own location, not
    `npm:` ones) and routing every `import()` call through its own non-literal constant instead.
  - Confirmed via `deno info --json --min-dep-age=0 mod.ts`: `react` and `preact` are both fully
    absent from `.`'s reachable `npm:` specifiers — the doc's own "importing it never evaluates
    `react`, `react-dom/server` or `preact`" claim is now checked, not just asserted.
- **Partial fix for `zanix space build` failing on a plain, default `zanix new space` React scaffold
  with `[UNLOADABLE_DEPENDENCY]`/`[PARSE_ERROR]`/`[UNRESOLVED_ENTRY]` errors inside a nested Vite
  worker sub-build (`zanix-io/space#4`).** Root cause: `@zanix/utils`'s own `WorkerManager`
  (`workers/processor.ts`) does a real `new Worker(new URL(...))` — a pattern Vite's own
  `worker-import-meta-url` plugin statically detects and tries to bundle as a nested sub-build the
  moment the file is merely REACHABLE, regardless of whether the app ever configures anything that
  needs it; that nested build then fails for reasons still outside this package's own control (see
  below). Two real, `@zanix/space`-controlled reachability paths into it, both fixed:
  - `build-client.ts` (`zanix space build`'s own Vite orchestration) statically imported
    `assetsPlugin`/`mediaPlugin` at its own top level, even though the SAME file already gates
    actually calling either behind `assetsDir` being configured — the classic "gated the call, not
    the import" gap this package has already fixed elsewhere (see `svgo`/renderer-view-specifier
    entries above). Both real value imports reach `@zanix/utils`'s `WorkerManager` (via
    `@zanix/logger`), so a plain app with no `assetsDir` configured — the exact repro — still paid
    for it. Fixed the same way: lazy, non-literal specifiers (new
    `bundler/build-plugin-specifiers.ts`), resolved only when `assetsDir` is actually set; typed via
    the existing `assets-plugin-types.ts`/`media-plugin-types.ts` siblings instead.
  - `typings/manifest.ts`'s `SpaceAppConfig.logApi` field `import type`-ed `LogApiControllerOptions`
    from the real `log.controller.ts` — which value-imports `@zanix/logger` directly — and
    `modules/runtime/define-space-app.ts` additionally, unconditionally, statically imported and
    called `createLogApiController` as part of every app's own `setup()`. Since `SpaceAppConfig` is
    reachable from the root `.` entry point (the SAME barrel every Comet imports, for
    `defineComet`), this meant `log.controller.ts` — and `@zanix/logger` — were reachable from every
    `@zanix/space` app's CLIENT bundle, not just its server side. Fixed by extracting
    `LogApiControllerOptions`/`LogApiRateLimitOptions` into the new
    `log-api/controllers/log-controller-types.ts` (for the type reference) and resolving
    `createLogApiController` itself via a lazy, non-literal specifier at its own call site (already
    inside an `async` scope) — `defineSpaceApp` stays fully synchronous for every existing caller.
  - **Not yet fully closed**: even with both fixes above, `@zanix/server`'s own `ProgramModule` —
    unconditionally needed by `defineSpaceApp` itself, and by every `SpacePageController`/`Page` a
    Comet's own sibling routes use — has its own internal path into `@zanix/utils`'s
    `helpers/mod.ts` → `utils/cron.ts` → `@zanix/logger` → the same `WorkerManager` pattern. This is
    outside this package's own control: `@zanix/logger`'s root `mod.ts` unconditionally imports a
    `WorkerManager`-backed default log-storage implementation (`defaults/storage/default.ts`),
    regardless of whether `useWorker` is ever actually set at runtime — the identical "gated the
    call, not the import" gap, one level up, in `@zanix/utils` itself. A real fix needs that import
    made lazy there; `zanix-io/space#4` stays open pending it.

## [0.1.0] - 2026-08-24

### Added

- **Client-bundled code never imports the server `@zanix/logger` — `hydrate-comets.ts`/
  `hydrate-comets-preact.ts`/`comet-persistence.ts` log through one shared browser-safe instance
  instead** (`modules/client/client-logger.ts`, built via `@zanix/utils@3.1.0`'s new
  `createClientLogger`). Importing `@zanix/logger` directly in these files would pull
  `WorkerManager`/`Deno.readTextFile` into the client bundle — invisible at runtime (no thrown
  error, no console warning), but real dead weight in every app's shipped JS. This client logger
  POSTs each already-formatted log entry to a new backend relay, **`POST /api/log`**
  (`modules/log-api/`, `createLogApiController`), always registered as part of `defineSpaceApp`'s
  own `setup()` — core observability plumbing, not an opt-in `SpaceAppConfig` field, unlike
  `assetsApi`. The handler validates only `level` (`LoggerMethods`) and relays the rest of the body
  into the server's own `@zanix/logger` default instance via `Logger#ingest`, per `@zanix/utils`'s
  own documented relay contract — so a browser-originated log persists through whatever backend
  (file, Elasticsearch, a custom sink) the server's own logger is already configured with, with no
  separate wiring needed. No full auth on this route — the same genuinely-public posture
  `sitemap.xml`/`robots.txt` already establish, since the whole point is accepting a POST from any
  anonymous browser tab that ever loaded this app's client bundle — but it's not unguarded: see the
  new default `rateLimitGuard` entry below.
- **`POST /api/log` now forwards `data.origin` into `Logger#ingest`'s new `origin` parameter**
  (`ingest(type, origin = 'client', ...data)`, per `@zanix/utils`'s own updated contract) instead of
  relying on `Logger#ingest`'s previous, origin-less signature. `client-logger.ts`'s own `postLog`
  deliberately does NOT tag `origin` itself — this route's only real caller is always a browser
  client, so `Logger#ingest`'s own `'client'` default already covers it; the handler just passes
  `data.origin` through as `undefined` when absent, never resolving that default a second time
  itself. A caller relaying from somewhere else (not this package's own client) can still send an
  explicit `origin` to override it.
- **`POST /api/log` ships with a mandatory default `rateLimitGuard`** (new `@zanix/auth` dependency,
  `createLogApiController`) — leaving rate limiting to the app's own reverse proxy/CDN would have
  zero precedent anywhere else in the ecosystem, so it's fixed at the source instead. Default:
  `anonymousLimit: 30` requests per `windowSeconds: 60`, `trustProxyHeader: true` (per-caller
  IP+User-Agent buckets, not one shared bucket) — a deliberately low, human-tab-sized budget, sized
  well above real page-load/error telemetry but well short of meaningful storage write amplification
  from a runaway/abusive caller. Two new, DIFFERENT `SpaceAppConfig.logApi` knobs over this same
  default: `guards` lets an integrator append EXTRA guards after it — unlike `assetsApi.guards`
  (which replaces its `[denyAllGuard]` placeholder once configured), this default is the decided
  policy and is never replaceable via `guards`, only extended; `rateLimit`
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
- **BREAKING (pre-release, no known consumers): three framework-owned request headers renamed to the
  ecosystem-wide `X-Znx-` namespace** — `x-csrf-token` → `X-Znx-Csrf-Token` (`csrfGuard`'s default
  `headerName`, still customizable), `x-asset-filename` → `X-Znx-Asset-Filename`
  (`readUploadedAssetFromRequest`), `x-space-navigate` → `X-Znx-Space-Navigate`
  (`ORBIT_FRAGMENT_HEADER`, also the `Vary` value every Orbit-negotiated response sets). These were
  the only custom headers in the whole ecosystem outside that namespace, confirmed via a full
  12-repo audit — a client/proxy sending or matching the old literal names needs updating.
- **The published package carries no `/// <reference lib="dom" />` triple-slash directives** — JSR's
  own publish-time linter bans them, since they leak into a consuming project's own type
  environment. The nine `src/modules/client/*.ts` files get their DOM types from a scoped
  `compilerOptions.lib` override on a new `src/modules/client/deno.jsonc` instead — the same types
  resolve for a consumer either way. Kept out of the repo root config deliberately: applying it
  there would also hand every server-side file `document`/`window` as if they existed, masking a
  real bug (a server file referencing a browser-only global that should never type-check as if it
  could).
- **`LogIngestRTO`'s `data` field validates correctly.** `@zanix/validator`'s own `@Expose()` "must
  be defined" check is keyed off the raw request body's OWN `data` property, which never exists as a
  literal top-level key on the wire — `data` is `LogIngestRTO`'s own constructor-computed
  rest-spread of "everything except `level`", not a field with a matching payload key, so a naive
  `@Expose()` would reject EVERY well-formed `POST /api/log` request with `400 BAD_REQUEST`
  (`"The 'data'
  property must be defined."`). Caught by a functional/integration test that
  exercises this route over real HTTP (direct RTO construction alone bypasses the validation
  decorators entirely, so it wouldn't have surfaced this) before any real request could ever hit it.
  `@Expose({ optional:
  true })` is the fix.
- **`langGuard`/`langPreHandler`/`populationGuard`'s cookies include `Secure`** (built from
  `@zanix/utils`'s new `PUBLIC_COOKIE_ATTRIBUTES`, the client-readable counterpart to
  `SESSION_COOKIE_ATTRIBUTES`), so a browser never attaches them over a plain-HTTP connection —
  confirmed via the same 12-repo audit above as the only cookies in the ecosystem that would
  otherwise have missed it.
- **`csrfGuard`/`langGuard`/`langPreHandler`/`populationGuard` throw at construction
  (`@zanix/utils`'s new `assertZnxCookieName`) if a custom `cookieName` doesn't start with
  `X-Znx-`** — a hard requirement, enforced at the exact point a mistake could be made: an
  unprefixed `cookieName` would otherwise be silently invisible to `@zanix/server`'s `cookiesGuard`
  (or, for `langPreHandler`, just inconsistent with the ecosystem-wide naming convention), rather
  than failing loudly. `csrfGuard` additionally requires the name contain `Csrf`, so a customized
  name stays recognized by `@zanix/utils`'s sensitive-key redaction pattern.
- `deno lint`'s own `@zanix/utils` plugin (`deno-zanix-plugin`) is version-pinned (`^2.6.1`),
  matching every other `@zanix/utils` import in `deno.jsonc` — pinning it keeps a lint run from
  silently picking up a newer, unreviewed plugin version.
- **`createLocalFilesystemAssetStorage` confines every `key` to `rootDir` before touching disk**
  (routed through the shared `@zanix/helpers`'s `confinePath`), the same containment guarantee
  `@zanix/datamaster`'s `createLocalFilesystemObjectStorage` establishes — `bytesPath`/`metaPath`
  never join `key` straight onto `rootDir` without it, closing off a path-traversal-shaped key
  before it can reach disk.
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
- **`AssetService.createAsset()` enforces a real, configurable per-kind upload size cap**
  (`AssetServiceOptions.limits`, default 25MB image / 50MB audio / 200MB video). Two layers: a fast
  reject against `UploadedAsset.size` (`Content-Length`) when the client sent one, followed by the
  real enforcement — `readBoundedBytes()` aborting the drain (`reader.cancel()`) the instant the cap
  is exceeded while buffering, which is what actually matters since `Content-Length` is optional
  (absent with chunked transfer-encoding) and client-controlled, so the upload stream is never
  buffered whole into memory with no cap regardless of what `Content-Length` claims.
- **`runImageTransformation` verifies the uploaded bytes actually match their declared
  `Content-Type`'s real file signature** (jpeg/png/webp magic bytes, `magic-bytes.ts`), not just the
  client-supplied header. Runs after the size cap above, on already-bounded bytes, before the bytes
  ever reach `sharp`/`transformImage` — so a mislabeled `Content-Type` can never smuggle bytes past
  the jpeg/png/webp allowlist on the header's claim alone.
- **README's "CLI scaffolding" section documents `zanix new space`/`zanix new spacecraft`
  (`@zanix/cli`) as the real, tested commands they are** — file-based routing, a Comet example,
  `--renderer`, and an opt-in `--icons` catalog.
- **The CSS/theming section documents runtime, per-request token personalization
  (`defineSpaceApp({ theme: { resolve } })`) consistently**, with no contradictory claim elsewhere
  in the section that it's deferred pending an i18n/population subsystem — sanitization, CSP, and
  ETag folding are covered there and in `docs/theming.md`.
- **README's PWA `space.app.ts` example matches the real `PwaConfig` shape and type-checks as
  written**: `defineSpaceApp({ pwa: { icon } })` plus the separate `main.ts`-side
  `loadPwaBuildOutput` call `registerPwa` actually reads, matching the `loadCssManifest`/
  `loadCometManifest` convention the CSS/Comets sections already document correctly.
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
- **`setAssetsManifestState`'s own doc comment accurately says it's reachable from a public entry
  point.** `deno.jsonc`'s `./assets-manifest` subpath maps `assets-manifest.ts` directly, so this
  test-only escape hatch — unlike every sibling `set*`/`reset*` test hatch, each of which sits
  behind a curated barrel that omits it — really is reachable as `@zanix/space/assets-manifest`. No
  export or routing changed; the comment says so and notes it's still not meant for production use.
- **New `docs/assets-api.md`** — the full reference for `@zanix/space/assets-api` (the Asset HTTP
  upload/transform/download API added earlier in this same `[0.1.0]` release: `createAssetService`/
  `createAssetsController` composition, the deny-by-default `denyAllGuard`, the upload contract
  (`readUploadedAssetFromRequest`'s streaming/no-multipart shape), the `AssetLimits` size caps and
  magic-byte content verification described above, the `AssetStatus` lifecycle, and the storage/
  repository adapters — including the structural-typing story for `@zanix/datamaster`'s
  `S3ObjectStorage`/`MongoFileRepository`, which this package never imports directly. This subpath
  otherwise has JSDoc only, with no coverage in `docs/` or the README; README's "Assets" section now
  links to it, disambiguated explicitly from the unrelated build-time pipeline `docs/assets.md`
  already documents.
- **`@zanix/space` ships no renderer of its own — `@zanix/space/react` and `@zanix/space/preact` are
  separate entry points that supply the React/Preact implementation.** Importing the framework never
  evaluates `react`, `react-dom/server`, or `preact` — verified on the real import graph (0 value
  AND 0 type edges from `.`, `./vite`, `./dev`, `./testing`) and by a real Preact SSR render in a
  subprocess where React is poisoned to throw on evaluation
  (`@tests/functional/render/renderer-isolation.test.ts`).

  The three things that would otherwise couple the framework to React eagerly — the page-renderer
  registry, the not-found-renderer registry, and the Comet element factory — are each installed by
  whichever renderer entry point an app imports, symmetrically, through one seam
  (`router/renderer-runtime.ts`).

  **Wiring** — an app declares its renderer with one import in its own main module, matching what
  `defineSpaceApp({ renderer })` declares:

  ```diff
  + import '@zanix/space/react'   // or '@zanix/space/preact'
    import { defineSpaceApp } from '@zanix/space'

    export default defineSpaceApp({ name: 'storefront' })
  ```

  `defineSpaceApp({ renderer })` is the single source of truth for which renderer a project uses;
  the entry point supplies the implementation, and the two are checked against each other at
  startup, so a mismatch (or a missing import) fails immediately with a message naming both. No
  renderer detection, no second configuration key.

  **Renderer-specific exports live at their own entry point, never at `.`**: `@zanix/space/react`
  carries `renderToResponse`, `RenderToResponseOptions`, `RequestCacheProvider`, `useRequestCache`,
  `RequestCache` — re-exporting them from `.` would recreate the very coupling this design avoids.
  The Preact serializer is public too, as `@zanix/space/preact`'s own `renderToResponse`.

  Everything else — `defineSpaceApp`, `SpacePageController`, `Page`, `loadRoutes`, `defineComet`,
  `createNotFoundHandler`, and the whole document/SEO/PWA/i18n/middleware/validation surface — is
  renderer-agnostic and lives at `.`.

  Calling `getPageRenderer()`/`getNotFoundRenderer()` with no entry point imported throws an
  explicit `InternalError` naming the import to add, rather than silently rendering with React.
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
  - **Real end-to-end validation against the actual published packages, outside the monorepo — this
    roadmap item's last open piece (P3-4), corrected below, NOT actually closed by this entry as
    originally written**: `@zanix/cli`'s own permanent functional suite
    (`src/@tests/functional/space-build-react-compiler-live.test.ts`) scaffolds a real
    `zanix new
    space` project in a fresh temp directory outside this monorepo, resolving
    `"@zanix/space":
    "jsr:@zanix/space@^0.1.0"` from the real JSR registry (no local link/path
    override anywhere — verified), then runs the real `zanix space build` subprocess against it and
    confirms the built comet chunk carries React Compiler's own `useMemoCache` runtime helper and a
    real per-component memo-cache-array pattern — the same evidence this package's own
    `react-compiler.test.ts` (above) uses. The TEST ITSELF was real and correctly written from the
    moment `@zanix/space`/`@zanix/space-ui` first published at `0.1.0` — what this entry got wrong
    was declaring the roadmap item closed on that basis alone, without actually running it in
    isolation first. Doing that surfaced two real, unrelated bugs that made a genuine
    `zanix space
    build` resolve a dependency tree dozens of times larger than necessary
    (`mongoose`/`mongodb`/ `bson`/`redis`/`@redis/*`/`amqplib`/`@aws-sdk/client-s3`, downloaded and
    materialized into `node_modules/.deno` for a project that used none of them), which is almost
    certainly why real runs of this exact test/of `zanix space build` in general have taken 60–85+
    minutes instead of seconds:
    1. `zanix-io/app`'s own `activateApps`/`registerApp` statically, unconditionally imported
       `@zanix/asyncmq`/`@zanix/datamaster`/`@zanix/auth` regardless of whether a manifest declared
       `jobs`/`resources`/`operations` — fixed (`zanix-io/app`'s own `[Unreleased]` CHANGELOG
       entry), unreleased as of this writing.
    2. This package's own `log.controller.ts` had the identical pattern for `@zanix/auth`
       (`rateLimitGuard`, unconditionally registered by every `defineSpaceApp()`) — fixed in this
       same `[Unreleased]` entry (above), unreleased as of this writing. Both fixes are real,
       tested, and confirmed at the code/module-graph level (`deno info`, a full test-suite pass,
       and — for `zanix-io/app` specifically — a real end-to-end `zanix space build` run via a local
       link that stopped materializing the packages above). **What genuinely remains open, and is
       the real reason P3-4 is not being marked closed here**: neither fix has been published yet,
       and this live test resolves `@zanix/app`/`@zanix/space` from the real JSR registry by design
       (no local override) — so re-running it as written, against what's CURRENTLY published, would
       still reproduce the same slow/download-heavy behavior. P3-4 closes for real once `@zanix/app`
       publishes (a MINOR bump — a public function's signature changed from sync to async — see that
       package's own entry) and this package publishes with the `log.controller.ts` fix, and this
       test is then re-run in isolation and confirmed both fast and passing.
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
  EXACT order `globalCss` declared it — a real bug found and fixed while building this: writing the
  manifest by walking whatever order `Object.values(bundle)` yielded (alphabetical by hashed output
  filename) would have silently contradicted `globalCss`'s own documented "declaration order
  matters, later entries can override earlier ones" contract.
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
- **Comet-scoped CSS (the first slice of the CSS delivery architecture)** — a real bug found and
  fixed while building this: a naive implementation would have shipped a Comet's own CSS Module
  (`import styles from './widget.module.css'` inside a `'use comet'` file) on **every**
  full-document response, whether or not that page actually rendered the Comet — caught with a real
  `buildSpaceClient()` build plus a real SSR render of a page that never used the Comet, not just
  inferred from reading `cssPlugin`'s own code. The shipped design scopes a Comet's CSS to follow
  the Comet itself: unused on a page → never linked; used → linked exactly where that Comet renders.
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
    would otherwise populate `global` unconditionally. A Comet entry with no CSS of its own
    contributes nothing; an app with zero Comets writes no `comets` field at all — fully backward
    compatible.
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
    aliasing for `import`-based assets. Hashing/manifest for production caching is included — see
    `assetsPlugin` further below.
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
  instead of replacing it, and is what `defineSpaceApp({ globalCss })` itself calls internally. Lets
  a HOST compose a base app's own `globalCss` automatically: if the base app's own
  `defineSpaceApp()` call executes first, its stylesheets already occupy the front of the list by
  the time a host's own customization app's `defineSpaceApp
  ({ globalCss: [...] })` call appends
  its own — `['./base.css']` then `['./custom.css']` composes to `['./base.css', './custom.css']`,
  with neither app referencing the other's file paths. Order is simply WHEN each `defineSpaceApp()`
  call executes, same "declaration order wins" principle `activateApps()`'s own `onStart` sequencing
  already follows. `setGlobalCssPaths` itself is unchanged — still an exact hard replace/reset, for
  tests or an advanced caller that genuinely wants to discard whatever was accumulated.
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
  - **A real bug caught and fixed while building this, not just new surface**: `messagesDir`'s path
    is resolved at the same eager point `assetsDir`'s own path already uses — unlike `assetsDir`'s
    own PATH (`setAssetsDirConfig`, already eager for exactly this reason), storing it only inside
    `defineSpaceApp()`'s own `setup()` (the same composition scope `assetsDir`'s directory SCAN runs
    in, but without a split-out eager path) would have left `getMessagesDir()` returning `undefined`
    for any orchestrator that imports the manifest without calling `activateApps()` — invisible to
    `zanix space build` specifically, the one thing that needed it. `loadMessages()`'s own
    resolution timing is completely unaffected — still per-`(lang, population)` key, on first
    access, never eager.
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
  against another); `link` by `rel`+`href` (see the entry below for why `hreflang` also matters
  here).
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
    real gap found and closed while building this: without that prop, a custom root layout would
    never receive `cssHrefs`/`pwaHead` at all under Preact, silently dropped rather than merely
    unused.
- **`buildHreflangLinks`**/**`buildCanonicalLink`** (`.`) — SEO helpers built on Head management
  above. `buildHreflangLinks` produces one `alternate` link per `availableLangs` (always including a
  self-reference for the current language) plus an `x-default` pointing at the default language's
  own version of the current page. `buildCanonicalLink` strips the query string by default
  (`keepParams` opts specific params back in) and always uses `url.origin`. Neither is a port of the
  legacy components they replace — real fixes/gaps documented in the entries below and each
  function's own doc.
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
  real usage has never needed more than flat, JSON-safe data. The formalization also surfaced two
  real bugs, fixed here: a circular reference or `BigInt` anywhere inside `initialState` would have
  made `renderToResponse` (React) throw a raw `JSON.stringify` `TypeError` instead of resolving,
  breaking its own "always resolves, never throws" design contract (Preact's own `JSON.stringify`
  call was already fully unguarded — same gap). Both resolve gracefully instead — `onError` (if
  given) receives the real error, the function returns a `500` — matching how a real render error
  already behaves in both. A Comet's own props hitting the same case throw a clear, Space-authored
  `InternalError` naming the offending Comet, instead of a raw `TypeError` — deliberately a throw,
  not a graceful failure, since a Comet's props are evaluated mid-render, where an uncaught throw is
  already the correct, pre-existing propagation path. 7 new tests across
  `render-to-response.test.tsx`, `render-to-response-preact.test.ts`, and `define-comet.test.tsx`
  (circular value and `BigInt` for both renderers, the full undefined/function/`Date`/`Map`/`Set`
  degradation asserted on the literal serialized output, and the `defineComet` error case) —
  byte-for-byte behavior for every already-supported JSON-safe value is unchanged (confirmed via the
  full existing suite, unmodified).
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
- **`defineSpaceApp({ renderer })` resolves eagerly** (`getActiveRenderer()`, newly public from both
  `.` and `./dev`), same timing as `headers`/`pwa`/`globalCss` — set outside `setup()`'s own
  closure, so it's readable without ever calling `activateApps()`. This matters because
  `zanix space build` never calls `activateApps()` at all: without eager resolution it would have
  had no way to learn a project declared `renderer: 'preact'`, and `zanix space dev` calling
  `spacePlugin()` before activation would have hit the same gap — both would silently build/serve
  with React's Vite plugin regardless of what `space.app.ts` declared.
  `BuildSpaceClientOptions.renderer` defaults to `getActiveRenderer()` (same pattern `globalCss`
  below already establishes), so a build script that already imports `space.app.ts` gets the right
  renderer automatically.
- **`buildSpaceClient({ globalCss })` defaults to `getGlobalCssPaths()`** instead of `[]` — the
  production-side half of the composition story `addGlobalCssPaths` (above) establishes: a build
  script that already imports the app's `space.app.ts` (so `defineSpaceApp()` runs and populates
  `getGlobalCssPaths()`) never has to separately re-declare `globalCss` to get it into the real
  production build — and, since `globalCss` is host-composable, this includes BOTH a base app's own
  stylesheets and a host's own on top, automatically. `buildSpaceClient` already wires a passed
  `globalCss` array correctly into `rollupOptions.input`; only the default needed this. Passing
  `globalCss` explicitly still overrides the default, unchanged.
- **Orbit (`initOrbit`) never intercepts same-document hash-only links** (`<a href="#section">`, or
  the current path plus a hash). `shouldInterceptNavigation` distinguishes that case from a normal
  internal link via the new `isSameDocumentHashLink` check (true only when the resolved URL has a
  non-empty hash AND the same `pathname`+`search` as the current page), alongside the existing
  modified-click/`target`/cross-origin escape hatches — without it, a click on such a link would
  trigger a full fragment `fetch()` + `innerHTML` swap instead of letting the browser natively
  scroll to the anchor: no smooth native scroll, a wasted network round-trip, and the same anchor
  clicked twice re-fetching and re-rendering identical content each time.
- **`Vary: x-space-navigate` is sent unconditionally, not only when a page declares
  `cacheControl`.** Every page's response body genuinely differs by that request header regardless
  of caching config (full document vs. bare Orbit outlet fragment), so a response with no
  `cacheControl` would still silently risk a shared HTTP cache in front of the app serving the wrong
  shape to the wrong request. Set in both `SpacePageController.handleGet`'s non-`cacheControl`
  branch and `createNotFoundHandler`.
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
  2. **A guard genuinely can act as an app-wide default, for ANY of these headers.**
     `SpacePageController` always applies its own zero-config defaults (nonce-based CSP;
     `frameOptions: 'SAMEORIGIN'`; `referrerPolicy: 'strict-origin-when-cross-origin'`;
     `noSniff: true`) UNLESS a page explicitly disables them — so for any ordinary page that
     configures nothing at all, those defaults would already be present on the response by the time
     `mainInterceptor`'s merge ran, letting them silently win over a registered guard every time,
     regardless of intent. Confirmed empirically with an isolated test before fixing: a page with no
     `headers` option, under a registered global `cspGuard({ 'default-src': ["'self'"] })`, would
     otherwise come back with the framework's own nonce-based CSP, not the guard's. Fixed by
     exposing the fully-accumulated guard headers to the handler itself, via `@zanix/server`'s new
     `GUARD_HEADERS_LOCALS_KEY` (`ctx.locals`, see that package's own CHANGELOG) — `handleGet`
     checks, BEFORE building its own response, whether a guard already has an answer for each
     header, and steps aside (applies neither its own default NOR anything else, for that specific
     field) when one does, letting `mainInterceptor`'s own merge fill the gap from the guard
     afterward. Implemented generically, not per-field: `security-headers-guard.ts` exports
     `SECURITY_HEADER_NAMES`, the single source of truth mapping each `SecurityHeadersOptions` field
     to its real HTTP header name (used internally by `securityHeadersGuard` itself too, replacing 7
     hardcoded string literals), which `applySecurityGuards` iterates generically — no bespoke logic
     duplicated per field.
  3. **An explicit `false` stays distinguishable from "not configured" even once a guard is
     involved.** `false` must win even over a registered guard, ending with that header COMPLETELY
     ABSENT — but a merely-absent header is exactly what `mainInterceptor`'s merge already reads as
     "please fill this from the guard," so setting nothing can't by itself communicate "and don't
     fill it either." An earlier iteration of this fix worked around this by writing an empty policy
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

### Fixed

- **A page's own `loader`, or a nested layout segment's own `loader` (`resolveSegmentData`), that
  throws is no longer left uncaught** — the throw used to propagate straight out of
  `SpacePageController.handleGet`, past every render-phase-only recovery mechanism this package
  already had (`error.tsx`/`SpaceErrorBoundary` only ever wrapped the RENDER phase, which starts
  AFTER data has already resolved), and land in `@zanix/server`'s own generic `routerInterceptor`,
  which turned it into a raw JSON error response even though the route is a real HTML page — a real,
  reachable case any time a `loader` calls a remote dependency through `@zanix/server`'s own
  `RestClient` and that call fails (a `RestClientError`), or throws for any other reason, domain or
  bug alike. `handleGet` now catches any such throw and recovers it into a real, rendered response:
  an `HttpError` whose `status.code` is `'NOT_FOUND'` renders this app's own `not-found.tsx`,
  reusing `createNotFoundHandler`'s exact lookup/render path (now factored out as
  `renderNotFoundResponse`, `not-found-handler.tsx`) so there is only one implementation of "find
  and render this app's `not-found.tsx`"; any other error renders this route's own nearest
  `error.tsx`, via a new `findNearestErrorBoundary` (`page-tree-registry.ts`) that reuses the exact
  same leaf-to-root resolution order `composeSegments` already established for a render-phase throw,
  wrapped directly in the app's root layout (a new `LoaderErrorRenderer`/`renderLoaderErrorResponse`
  pair,
  `loader-error-renderer-registry.ts`/`render-loader-error-react.tsx`/`render-loader-error-preact.ts`,
  installed by both `@zanix/space/react` and `@zanix/space/preact` alongside the existing page/
  not-found renderers). The real HTTP status always survives unchanged — `error.status.value` for an
  `HttpError` (e.g. `502` for a failed `RestClient` call), `500` for anything else — only the
  response BODY changes, from raw JSON to a rendered document. The real error is always logged
  first, so the browser gets a friendly page while the server's own logs/observability still get the
  full error. Purely additive: a route with no `error.tsx` anywhere in its own composition chain
  still gets a real, rendered document — this package's own new built-in `DefaultErrorView` fallback
  (see the next entry) — never a raw, uncaught throw leaking to `@zanix/server`'s own generic JSON
  error response. No REST/GraphQL/socket handler is affected (`@zanix/server`'s own
  `routerInterceptor` is untouched).
- **The same uncaught-`loader` gap also existed on the `POST` path**: `SpacePageController`'s
  private `#renderInvalidAction` (the `422` re-render `handlePost` triggers when a page's own
  `@Page({ action: { Body } })` validation fails) re-runs the page's own `loader` a second time, and
  that call had no protection either — a `loader` throwing while re-rendering the form with field
  errors still leaked straight to `@zanix/server`'s own raw JSON error response.
  `#renderInvalidAction` now wraps its own `loader` call and render in the SAME `try`/`catch` shape
  as `handleGet`, calling the exact same `renderLoaderErrorPage` (`loader-error-handler.ts`) — no
  second implementation, no behavior drift between the two call sites.
- **`renderLoaderErrorPage` used to `throw error` raw when a route declares no `error.tsx` anywhere
  in its own composition chain** — a real, confirmed gap in the fix above (not a deliberate design),
  letting a `loader` throw from exactly that one case leak past this package's own contract of never
  handing an SSR page's client raw JSON on a failure (the same compromise `page-decorator.ts`
  already documents for a failed `422` re-render). Fixed with a new built-in `DefaultErrorView`
  (`default-error-view.tsx`/`default-error-view-preact.ts`, one per renderer, selected the same way
  `DefaultNotFoundView` already is) — the exact mirror of the not-found path's own built-in
  fallback, applied to the other document `loader-error-handler.ts` renders on its own. Deliberately
  renders nothing about the underlying error itself (the real error is already logged); an app that
  wants to surface real detail still writes its own `error.tsx`.
- **`DefaultNotFoundView` and the new `DefaultErrorView` now carry a stable
  `data-space="not-found"`/ `data-space="error"` hook** on their root element — an `@zanix/space`
  attribute (never `data-space-ui`; that one belongs to `@zanix/space-ui`, a different package and a
  different audience) an optional stylesheet can target, the same selector-hook convention
  `@zanix/space-ui`'s own components already establish for themselves.
  `zanix new space --template
  themed` (`@zanix/cli`) is the first real consumer, via its own
  `assets/theme/space-defaults.css`.
