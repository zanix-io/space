import type { Plugin } from 'vite'

/**
 * The exact, real module-identity fix for `zanix space dev`'s core routing bug: `@Page(...)`
 * silently registering zero real routes.
 *
 * ## The bug this closes
 *
 * `createSpaceDevEngine`'s own `ssrLoadModule` (`dev-engine.ts`) runs a route file (`page.tsx`)
 * through Vite's SSR pipeline and {@linkcode RealImportEvaluator}'s own native-`import()`-of-a-temp-
 * file mechanism (`ssr-module-evaluator.ts`). Before this fix, `page.tsx`'s own
 * `import { Page, SpacePageController } from '@zanix/space'` was resolved and TRANSFORMED by Vite
 * like any other project dependency — Vite's own SSR transform rewrote it into
 * `__vite_ssr_import__(resolvedAbsolutePath)`, and the module runner then recursively transformed
 * `@zanix/space`'s own source THROUGH THE SAME PIPELINE, materializing it as its own separate temp
 * `.ts` file and natively `import()`-ing THAT — a URL Deno's own module cache can never dedupe
 * against whatever `@zanix/space` (and transitively `@zanix/server`) the NATIVE `zanix space dev`
 * process itself already imported to run `defineSpaceApp`/`loadRoutes`/`bootstrapServers()`. The
 * result: two structurally identical but reference-DIFFERENT copies of `@zanix/space`/
 * `@zanix/server`, each with their OWN `page-decorator.ts`'s own `pendingPages` map and their OWN
 * `@zanix/server` `ProgramModule`/`RouteContainer` singleton. `@Page()`'s decorator (evaluated
 * inside the SSR-side copy) registers into the SSR-side copy's own registries — never the native
 * side's, which is the only one `Deno.serve()` actually dispatches requests through. Nothing throws;
 * both copies run their own code correctly in isolation; the registration just lands in a registry
 * that evaporates the instant `ssrLoadModule()` returns, and every real request 404s.
 *
 * ## Why neither `resolve.external` (Vite config) nor a plain `resolveId` external marker works
 *
 * Both are ruled out empirically, not by inspection alone:
 *
 * - **`environments.ssr.resolve.external: ['@zanix/space', '@zanix/server']`** (alongside this
 *   engine's existing `noExternal: true`, which a bare config `external` entry legitimately takes
 *   priority over — confirmed against `vite@8.2.2`'s own `createIsConfiguredAsExternal`, whose exact-
 *   id branch returns `true` unconditionally ahead of the `noExternal` check) DOES make Vite's own
 *   `ssrTransform` leave the bare specifier text untouched in the generated code. But the module
 *   runner's OWN default transport — `fetchModule` (`vite/dist/node/chunks/node.js`) — resolves any
 *   bare specifier reaching it (with a known importer) through a hardcoded, Node-style
 *   `tryNodeResolve` fast path that completely bypasses the plugin container (so `@deno/vite-plugin`
 *   and this package's own `canonicalBareSpecifierResolvePlugin` — see `bare-specifier-resolve.ts`'s
 *   own doc for the identical, already-documented gap — never get a chance to resolve it). A
 *   workspace-linked or JSR-only package like `@zanix/space` has no real, on-disk `node_modules`
 *   entry for that Node-style resolution to find, so this failed outright, reproducibly, with a real
 *   `Cannot find module '@zanix/space' imported from '.../page.tsx'` at request time — never a
 *   silent misidentification, a hard, immediate resolution failure.
 * - **A `resolveId` hook returning `{ id: someAbsolutePath, external: true }`** doesn't help either:
 *   `vite@8.2.2`'s own `normalizeUrl` (the transform-time code that calls `this.resolve()` and reacts
 *   to its result) only ever treats a resolution as "external" when the resolved `id` itself matches
 *   `externalRE` (`/^([a-z]+:)?\/\//`, i.e. looks like a real `scheme://` URL) — it never reads the
 *   Rollup-conventional `external` boolean at all. A plugin returning a plain absolute file path with
 *   `external: true` is treated exactly like any other resolved project file: still transformed,
 *   still inlined, still a second `@zanix/space` instance.
 *
 * ## The fix that actually works: hand the module runner a URL it already treats as truly external,
 * then hijack ONLY that one evaluator method to answer with the NATIVE copy
 *
 * {@linkcode nativeRuntimeModulesPlugin} resolves `@zanix/space`/`@zanix/server` (and any of their
 * subpaths — `pkg` or `pkg/...`) to a synthetic `znxruntime://<encoded-original-specifier>` id, which
 * DOES match `externalRE` (a real `scheme://` prefix) — so `normalizeUrl` embeds it verbatim, Vite's
 * own `fetchModule` classifies it as a genuine `type: 'network'` external without ever touching
 * `tryNodeResolve`, and the module runner calls `evaluator.runExternalModule(thisSyntheticUrl)`
 * exactly the way it already does for a real `node:async_hooks` external. {@linkcode
 * RealImportEvaluator.runExternalModule} (`ssr-module-evaluator.ts`) recognizes the
 * `znxruntime://` prefix, decodes the original bare specifier back out, and does a plain native
 * `import(originalSpecifier)` instead of `import(theSyntheticUrl)` — resolved by Deno against the
 * SAME import map the native `zanix space dev` process already loaded `@zanix/space`/
 * `@zanix/server` through (Deno resolves every bare specifier for a running process against ONE
 * config, discovered from the true entry point, regardless of which file/package issues the
 * `import()` call — this is exactly the mechanism that already makes `runExternalModule`'s existing,
 * untouched handling of `node:async_hooks` share identity with the native side). Deno's own ES module
 * cache then returns the SAME already-loaded module instance — real reference equality, not just
 * matching source — closing the identity split directly, with no config array, no Node-style
 * resolution, and no new public API surface: this whole mechanism is a dev-mode-only internal of
 * `createSpaceDevEngine`, invisible to `load-routes.ts`/`page-decorator.ts`/every other router file,
 * exactly as production (`native import()`, no Vite involved at all) already behaves.
 *
 * ## `runExternalModule` resolves against the SERVED PROJECT, never the ambient process
 *
 * A plain bare `import(specifier)` here resolves against whichever import map governs the AMBIENT
 * `zanix space dev` process — `@zanix/cli`'s own globally-installed shim, never the project
 * actually being served. A real regression for `@zanix/space` itself: the CLI shim locks its own
 * resolution on first install and never floats to a newer compatible version later, so a project
 * bumping its own `@zanix/space` pin past the shim's cached one gets a DIFFERENT module instance
 * than the one actually running `defineSpaceApp`/`loadRoutes()` — two `page-decorator.ts`
 * instances, each with its own `pendingPages` `WeakMap`. A pathless `@Page()` sets an entry on
 * one; `resolvePendingPage()` reads the other, finds nothing, and the page 404s with no thrown
 * error. An explicit `@Page(path)` is unaffected (its registration goes straight through
 * `@zanix/server`'s `ProgramModule`), which is why this is specific to the pathless form. The same
 * gap applies to every entry with no dependency declaration anywhere in this package's own
 * `deno.jsonc` — `@zanix/auth`/`@zanix/datamaster`/`@zanix/asyncmq`/`@zanix/notifications` are
 * deliberately absent from it (each scoped to `src/@tests/` only, to avoid materializing heavy
 * transitive dependencies for every consumer that never imports them).
 *
 * Fixed by resolving every `@zanix/*` specifier through `getSharedLoader(root)`/`resolveDenoAt`
 * (`deno-loader.ts`/`deno-specifier-resolver.ts`) — the SAME resolver `bare-specifier-resolve.ts`/
 * `cjs-interop.ts` already use for this project's own SSR-side resolution needs, scoped to `root`
 * (the project passed into `createSpaceDevEngine`, never this package's own directory). This
 * resolves each specifier against whatever version the SERVED PROJECT itself declares — including
 * `@zanix/space` itself, which every consumer already declares to use this package at all, so no
 * self-reference is needed — matching the instance its own `space.app.ts`/guard/interactor files
 * already import, regardless of what the ambient process happens to have cached. `react`/`preact`
 * keep the plain ambient `import(specifier)` instead: an npm package is already safe without this
 * (`nodeModulesDir: "auto"` flattens the served project's whole tree into one shared
 * `node_modules`, so a bare `import('react')` already resolves identically regardless of which
 * config asked), and routing it through this resolver anyway would return an already-expanded
 * file path that skips Deno's own built-in CJS-to-ESM interop for a bare npm specifier. See
 * `ssr-module-evaluator.test.ts`'s own `runExternalModule` test for a direct proof: a fake project
 * declaring an older `@zanix/utils` pin than this package's own resolves to THAT pin's
 * `HttpError`, not this package's.
 *
 * ## `react`/`react-dom` are on this list too, for the identical reason
 *
 * `canonicalBareSpecifierResolvePlugin` alone is not sufficient here, even though it already
 * resolves a bare `import 'react'` to the SAME physical file `react-dom/server`'s own native-side
 * copy loads from, so a hookless component renders correctly either way — confirmed empirically,
 * but only for THAT case. `canonicalBareSpecifierResolvePlugin` only ever fixes WHICH FILE a specifier resolves to;
 * it returns a plain absolute path, not a truly external `scheme://` id, so Vite still treats that
 * path as an ordinary project file — transforms it and evaluates the result as its OWN, separate
 * module instance, same physical source or not. A route/Comet file's own `import 'react'` and
 * `react-dom/server`'s native-side one therefore land on two DIFFERENT `react` module objects. That
 * is invisible for a component with no hooks (React's `createElement`/JSX path needs no shared
 * state at all) but breaks any real one: `react-dom/server`'s renderer installs the hooks
 * dispatcher on ITS OWN `react` copy, and `useState()` — read from the route/Comet's separate copy
 * — sees a `null` dispatcher and throws `Invalid hook call`, unconditionally, every time.
 *
 * Adding the two names here alone isn't enough, though — see {@linkcode nativeRuntimeModulesPlugin}'s
 * own doc for why `enforce: 'pre'` is required for `react`/`react-dom` specifically to actually take
 * effect. Routing them through this file's own mechanism instead — real native `import()`, sharing
 * the exact instance `render-to-response.tsx` already uses — is not just a fix but the more correct
 * end state: Fast Refresh's own runtime is built on exactly one canonical `react` instance existing
 * at all, the same requirement this closes.
 *
 * ## `preact` is on this list for the IDENTICAL reason, confirmed the same way
 *
 * Not a hypothetical extension of the React case above — a real, reproduced failure: a Comet
 * (`--renderer preact`) calling a hook from `preact/hooks` (`--theme astronaut`'s own comet demo,
 * `@zanix/cli`'s `getHooksEntry`) threw Preact's own `"Hook can only be invoked from render
 * methods."` during SSR, the exact Preact-flavored equivalent of React's `Invalid hook call`
 * above: `preact-render-to-string`'s own renderer (this package's Preact analog to
 * `react-dom/server`) installs its hooks dispatcher on the NATIVE side's own `preact` copy, while
 * the Comet's `useState` call — evaluated through the same identity-splitting path this whole file
 * exists to close — read from a SEPARATE, Vite-resolved copy with no dispatcher installed at all.
 * `'preact/hooks'` is listed as its own entry, not left to `'preact'`'s own subpath match alone,
 * for the same "every subpath a Comet might import directly" reasoning `react-dom` already gets —
 * though `id.startsWith('preact/')` would in fact already cover it; the explicit second entry just
 * makes that coverage obvious at a glance rather than implicit in the matching rule. Never needed a
 * `preact-render-to-string` entry here: unlike `react-dom` (imported directly by both a Comet AND
 * `@zanix/space`'s own rendering code), `preact-render-to-string` is only ever imported from
 * WITHIN `@zanix/space`'s own source — already covered transitively by `@zanix/space` itself being
 * on this list.
 *
 * ## `@zanix/auth` is on this list too — the identical identity split, one layer further from
 * rendering
 *
 * A real, reproduced failure, not a class of bug this file merely anticipates: a consuming app's
 * own `@Guard` calling `ctx.providers.get(ZanixAuthProvider).session.refreshTokens()` (a real,
 * documented pattern — resolving a `@zanix/server` core provider by CLASS REFERENCE, the same
 * shape `ctx.providers.get('auth')`'s string-keyed form resolves too) threw `[BaseInstancesContainer]:
 * Target is not a constructor` — `INVALID_INSTANCE`, `'unknown': there is no metadata information` —
 * on every request, confirmed with `deno info --json` showing `guards.ts` and the app's own
 * `space.app.ts`/`mod.ts` resolving `@zanix/auth`'s `ZanixAuthProvider` to the byte-identical
 * `https://jsr.io/...` URL (so this was never a version/link mismatch), and with the string-keyed
 * `ctx.providers.get('auth')` form resolving the SAME underlying provider with zero error. The
 * mechanism is identical to `@zanix/server` above, just one step removed from a route's own direct
 * import: `space.app.ts`'s own `import '@zanix/auth/core'` registers `ZanixAuthProvider`'s real
 * class object (and its own DI decorator metadata) into `@zanix/server`'s container through the
 * NATIVE side. Without `@zanix/auth` on this list, a `@Guard` file reached through `ssrLoadModule`
 * (never `space.app.ts` itself, always some OTHER file in a route's own module graph) that
 * bare-imports `'@zanix/auth'` gets Vite's own SSR-transformed, SEPARATELY-EVALUATED copy of that
 * same class instead, carrying none of the native side's decorator metadata. A string-keyed
 * `.get('auth')` lookup never cares which JS object reference the CALLER holds, which is exactly
 * why it keeps working regardless — the split is real but invisible to it. A `@zanix/auth/core`
 * registration side-effect import added directly inside the SAME `@Guard` file does NOT close this
 * either, confirmed empirically: the registration import and the class-reference import still
 * resolve through two DIFFERENT evaluations of `@zanix/auth`'s own source under Vite's SSR graph,
 * same failure, same missing metadata — only routing `@zanix/auth` itself through this file's own
 * native-import mechanism gives both evaluations the same underlying class object.
 *
 * ## `@zanix/datamaster`, `@zanix/asyncmq`, and `@zanix/notifications` are on this list for the
 * SAME confirmed mechanism, not a speculative extension of `@zanix/auth`'s case
 *
 * Each of these three packages ships its own `./core` side-effect module that registers a real
 * `@Provider`-decorated class into `@zanix/server`'s DI container unconditionally — the identical
 * shape `@zanix/auth/core` registers `ZanixAuthProvider` under, down to the same doc comment each
 * one carries verbatim: "applies the decorator directly to `X`... so `this.providers.get(X)` — the
 * class every consumer actually imports — resolves correctly. See `@zanix/auth`'s `providers/
 * core.ts` for the full rationale" (`datamaster/src/modules/cache/providers/core.ts` and
 * `datamaster/src/modules/dlq/core.ts`; `asyncmq`/`notifications` register their own core
 * providers the same way). `getTargetKey` (`server/src/utils/targets.ts`) is the shared mechanism
 * underneath all four packages: a `WeakMap<{name}, string>` keyed on the class OBJECT itself, so a
 * lookup issued against one module evaluation can never find a registration made under a different
 * one — a property of `@zanix/server`'s own container, not something particular to `@zanix/auth`.
 * Without this entry, a guard/interactor/RTO/page file (reached through `ssrLoadModule`) that
 * bare-imports any of these three packages directly — instead of only going through the
 * already-native `@zanix/server` — holds a class reference `ProgramModule.providers.get()` cannot
 * resolve: `[BaseInstancesContainer]: Target is not a constructor` — `INVALID_INSTANCE`,
 * `'unknown': there is no metadata information`, the exact shape `@zanix/auth`'s own production
 * incident hit. `native-runtime-modules-datamaster.test.ts` confirms both states directly, not
 * just by the shared shape alone, by calling `ProgramModule.providers.get()` against an SSR-loaded
 * `DlqProvider` class reference registered natively via `@zanix/datamaster/core` — see that test's
 * own doc for the exact failure this entry closes.
 *
 * `@zanix/utils` is on this list too — a real, reproduced `instanceof` split, not the same
 * container-lookup mechanism the four packages above share
 *
 * `@zanix/validator` (`@zanix/utils`'s own `IsString`/`BaseRTO` decorators) does NOT need this
 * entry — see the "not every package belongs here" paragraph below, and
 * `native-runtime-modules-validator.test.ts` — but `@zanix/errors` (also a `@zanix/utils` subpath,
 * aliased in every `zanix new`-scaffolded project's own `deno.jsonc` as `"@zanix/errors": "jsr:
 * @zanix/utils@^X/errors"`, exactly as this package's own top-level `imports` block aliases it
 * too) shares a DIFFERENT, real vulnerability with the four container-lookup packages above,
 * through a different mechanism: `instanceof`. A real, reproduced production incident, not a
 * hypothetical: a consuming app's own Space page's `catch (e) { if (e instanceof HttpError &&
 * e.status.code === 'FORBIDDEN') return redirectResponse(...) }` never ran for an `HttpError`
 * thrown by `@zanix/auth`'s own internals (`totp.ts`'s `authenticate` throwing `new
 * HttpError('FORBIDDEN', { code: 'INVALID_TOTP' })` for a wrong TOTP code) — the raw, unhandled
 * error reached the client instead of the page's intended redirect. Root cause: `@zanix/auth` IS
 * on this list, so its OWN internal `import { HttpError } from '@zanix/errors'` resolves through
 * the NATIVE side; the PAGE file's own, separately Vite-SSR-evaluated `import { HttpError } from
 * '@zanix/errors'` did not (`@zanix/errors` was not yet on this list), landing on a SECOND,
 * reference-different `HttpError` class. `e instanceof HttpError` is `false` across two different
 * classes even when the thrown object's serialized shape (`name`, `status`, `code`) is identical —
 * confirmed never to reproduce in production (one native evaluation of everything, no Vite, no
 * split). A sibling page whose OWN interactor throws its OWN `HttpError` directly (never crossing
 * through a natively-resolved package like `@zanix/auth`) is unaffected either way: both the throw
 * site and the catch site go through the SAME Vite-SSR evaluation together, so they already share
 * one `HttpError` class regardless of this entry — the split only bites a throw that originates
 * inside a package already on this list. `native-runtime-modules-errors.test.ts` confirms both the
 * reference-identity fix and the cross-copy `instanceof` check directly.
 *
 * `@zanix/utils` bare is ALSO added (not just `@zanix/errors`), but confirmed EMPIRICALLY (a
 * `resolveId` probe log against a real project file's own `import { HttpError } from
 * '@zanix/errors'`) to be insufficient on its own: the literal specifier text reaching this
 * plugin's `resolveId` for that import is `'@zanix/errors'` itself — the ALIAS name a project's
 * own `deno.jsonc` declares — never rewritten to `'@zanix/utils/errors'` (or a
 * `jsr:@zanix/utils@^X/errors` form `isNativeRuntimeSpecifier`'s own `JSR_OR_NPM_SPECIFIER_RE`
 * would normalize) before this plugin's `resolveId` gets a turn. That normalization only happens
 * for a THIRD-PARTY package's own nested import of a dependency it declares its own version range
 * for (see `isNativeRuntimeSpecifier`'s own doc) — a project's own top-level file's import-map
 * alias is never rewritten ahead of this plugin at all. `@zanix/utils` bare is kept anyway, for the
 * same reason `@zanix/space`/`@zanix/server`/etc. need no separate alias entries: it covers a file
 * that bare-imports `'@zanix/utils'`/`'@zanix/utils/<subpath>'` literally, and a third-party
 * package's own nested `jsr:@zanix/utils@^X/<subpath>`-shaped dependency import (the
 * `NavDrawer`/`@zanix/space/comet` shape `native-runtime-modules-relayed-specifier.test.ts` already
 * pins for `@zanix/space`) — both real, if less common, reachable paths than the aliased
 * `@zanix/errors` form the actual incident hit.
 *
 * Not every `@zanix/*` package belongs here on the strength of this pattern alone, though —
 * `@zanix/validator`'s `IsString`/`BaseRTO` decorators specifically do not share EITHER
 * vulnerability above: `classValidation`'s real validation logic is closure-captured directly
 * onto each accessor at class-definition time, never looked up through a cross-module registry
 * NOR compared via `instanceof`, so it survives the identical split unharmed (see
 * `native-runtime-modules-validator.test.ts` — the one real gap there, `classMetadata`'s static
 * field introspection, doesn't share this container-lookup mechanism at all and reaches no
 * request-handling path). This is exactly why `@zanix/utils` earns its entry through
 * `@zanix/errors`'s `instanceof` exposure specifically, not through `@zanix/validator`'s. `@zanix/
 * admin` and `@zanix/app` expose no real, non-type, non-primitive import through a
 * `ssrLoadModule`-reached file in `console` (this ecosystem's real consumer app) — nothing to
 * reproduce a failure against. A package earns an entry here only once its OWN identity-sensitive
 * mechanism and a real (or realistically reachable) import path through this engine's SSR graph
 * are both confirmed, the same bar every entry above already meets.
 *
 * Adding a package here needs no paired change anywhere else: `RealImportEvaluator
 * .runExternalModule` (`ssr-module-evaluator.ts`) resolves every entry against the SERVED
 * PROJECT's own config (see this file's own "`runExternalModule` resolves against the SERVED
 * PROJECT" section above), which already declares it — the same file that imports it is what
 * triggered this diversion in the first place. `@zanix/cli`'s own `deno.jsonc` no longer needs a
 * matching entry for this resolution to succeed.
 *
 * Exported (`./dev`, `modules/dev/mod.ts`) specifically so `cli`'s own regression guard
 * (`native-runtime-module-imports.test.ts`) can import this REAL array instead of hand-keeping its
 * own copy in sync — once `cli`'s `@zanix/space` range picks up the version that first exports
 * this, that test should switch to it (see its own module doc for the exact TODO); until then, a
 * package added here still needs its `cli`-side `deno.jsonc` entry AND that test's hardcoded copy
 * updated by hand, the same as always.
 */
export const NATIVE_RUNTIME_MODULES = [
  '@zanix/space',
  '@zanix/server',
  '@zanix/auth',
  '@zanix/datamaster',
  '@zanix/asyncmq',
  '@zanix/notifications',
  // NOT `'@zanix/utils'` bare — confirmed EMPIRICALLY (a `resolveId` probe log) that a real project
  // file's own `import { HttpError } from '@zanix/errors'` reaches this hook as the literal ALIAS
  // text `'@zanix/errors'`, never rewritten to `'@zanix/utils/errors'`/`jsr:@zanix/utils@^X/errors`
  // before this plugin's `resolveId` runs (that normalization, `JSR_OR_NPM_SPECIFIER_RE`, only
  // fires for a THIRD-PARTY package's own nested dependency-range import — see
  // `isNativeRuntimeSpecifier`'s own doc). `@zanix/errors` therefore needs its own explicit entry
  // below, not a bare `'@zanix/utils'` one — which would also be a dead entry regardless: the real
  // `@zanix/utils` package has no root (`.`) export at all (`deno info`/`import('@zanix/utils')`
  // itself fails with `Unknown export '.'`), so a bare entry could only ever match a THIRD-PARTY
  // package's own nested `@zanix/utils/<subpath>` import — a path no real code in this ecosystem
  // currently takes (confirmed: nothing outside this package's own aliased subpaths imports
  // `@zanix/utils` any other way) — see this file's header doc, "`@zanix/utils` is on this list
  // too", for the full incident this closes.
  '@zanix/errors',
  'react',
  'react-dom',
  'preact',
  'preact/hooks',
] as const

/** Scheme prefix for a native-runtime-module sentinel id — see this file's own header doc for why it
 * must look like a real `scheme://` URL (`externalRE`'s own requirement, `vite@8.2.2`'s
 * `fetchModule`), and must use ONLY lowercase letters before the `://` (no `-`/`.`/digits — the same
 * regex, `/^([a-z]+:)?\/\//`, rejects anything else as its own scheme group). */
const NATIVE_IMPORT_SCHEME = 'znxruntime://'

/** Encodes `specifier` (the ORIGINAL bare specifier text a route file wrote — `'@zanix/space'`,
 * `'@zanix/server/testing'`, ...) as a synthetic id `vite@8.2.2`'s own `fetchModule` treats as a
 * genuine external URL, never resolving it through any Node-style or Vite-plugin resolution of its
 * own. See this file's own header doc for the full mechanism. */
function toNativeRuntimeSentinel(specifier: string): string {
  return `${NATIVE_IMPORT_SCHEME}${encodeURIComponent(specifier)}`
}

/**
 * The inverse of {@linkcode toNativeRuntimeSentinel} — recovers the original bare specifier text
 * from a sentinel id, so {@linkcode RealImportEvaluator.runExternalModule} (`ssr-module-evaluator.ts`)
 * can natively `import()` THAT instead of the synthetic url itself.
 *
 * @returns `null` for any url that isn't one of this file's own sentinels — every other external
 * (`node:async_hooks`, a real `https://` module, ...) must fall through to this evaluator's own
 * plain, unmodified `import(filepath)` path, unaffected by this mechanism.
 */
export function fromNativeRuntimeSentinel(url: string): string | null {
  if (!url.startsWith(NATIVE_IMPORT_SCHEME)) return null
  return decodeURIComponent(url.slice(NATIVE_IMPORT_SCHEME.length))
}

/**
 * Matches a `jsr:`/`npm:`-prefixed specifier — `jsr:@scope/name@range` or
 * `jsr:@scope/name@range/subpath` (`npm:name@range[/subpath]` the same shape, unscoped) — and
 * reconstructs the bare `name`/`name/subpath` form {@linkcode isNativeRuntimeSpecifier}'s own
 * check already expects. `[^/]*` for the range deliberately accepts ANY non-slash text (`^1.0.0`,
 * `~1.2.3`, a bare `1.0.0`, `*`, ...) — this never needs to parse semver, only to skip past it.
 *
 * This is the real, confirmed shape a specifier arrives in at THIS plugin's own `resolveId` hook
 * when the import comes from WITHIN a third-party package's own source (that package's OWN
 * declared dependency range for `@zanix/space`/`react`/..., not the literal bare text its file
 * wrote) — see {@linkcode isNativeRuntimeSpecifier}'s own doc for the full "why" and the real bug
 * this closes.
 */
const JSR_OR_NPM_SPECIFIER_RE = /^(?:jsr|npm):(@[^/@]+\/[^/@]+|[^/@]+)@[^/]*(\/.*)?$/

/** `true` for `@zanix/space`/`@zanix/server` themselves, or any of their subpaths (`pkg/...`) —
 * never for an unrelated specifier that merely starts with the same text (`@zanix/space-ui` must
 * NOT match `@zanix/space`, hence the explicit `/` boundary check rather than a bare `startsWith`).
 *
 * Also matches the identical package reached via a `jsr:`/`npm:`-prefixed form (see
 * {@linkcode JSR_OR_NPM_SPECIFIER_RE}'s own doc) — a REAL, reproduced gap, not a hypothetical
 * extension: a route/layout file's own bare `import { NavDrawer } from '@zanix/space-ui/...'`
 * reaches THIS plugin correctly (`@zanix/space-ui` is rightly not on the list), but `NavDrawer`'s
 * OWN internal `import { defineComet } from '@zanix/space/comet'` — a THIRD-PARTY package's own
 * source, resolved through ITS OWN declared dependency range — arrives here as
 * `jsr:@zanix/space@^1.0.0/comet`, never the bare text `@zanix/space/comet` that
 * `@zanix/space-ui`'s file actually wrote (confirmed directly: a real `ssrLoadModule` probe
 * importing a real `NavDrawer` logs exactly that string reaching this hook). The bare-text-only
 * check above silently let this specifier fall through as an ordinary, Vite-transformable
 * dependency — materializing a SECOND, separately-evaluated copy of `@zanix/space`'s own
 * `element-factory.ts` (and everything else `@zanix/space` exports), with none of the native
 * side's own `setCometElementFactory()` registration on it: `getCometElementFactory()` throws
 * "no react element factory is registered" for THIS copy specifically, even though the native
 * side's own copy has one — every Comet an app imports directly still worked, since only ONE
 * exercised this exact third-party-package-reached path. `react`/`react-dom`/`preact` share the
 * identical exposure for a THIRD-PARTY component using hooks, reached the same indirect way (a
 * real, confirmed `npm:react@^19.2.0` specifier from this same `NavDrawer` probe, never exercised
 * before now because nothing on this list previously composed another package with its own hooks).
 */
/** Undoes a `jsr:`/`npm:`-qualified specifier back to its bare `name`/`name/subpath` form (see
 * {@linkcode JSR_OR_NPM_SPECIFIER_RE}'s own doc) — the same normalization
 * {@linkcode isNativeRuntimeSpecifier} relies on, exported so `RealImportEvaluator
 * .runExternalModule` (`ssr-module-evaluator.ts`) can classify a recovered specifier the identical
 * way, regardless of which form it arrives in. A no-op for a specifier that was never qualified to
 * begin with. */
export function normalizeNativeRuntimeSpecifier(id: string): string {
  const jsrOrNpmMatch = JSR_OR_NPM_SPECIFIER_RE.exec(id)
  return jsrOrNpmMatch ? `${jsrOrNpmMatch[1]}${jsrOrNpmMatch[2] ?? ''}` : id
}

function isNativeRuntimeSpecifier(id: string): boolean {
  const normalized = normalizeNativeRuntimeSpecifier(id)
  return NATIVE_RUNTIME_MODULES.some((pkg) =>
    normalized === pkg || normalized.startsWith(`${pkg}/`)
  )
}

/**
 * Registered FIRST in {@linkcode createSpaceDevEngine}'s own `plugins` array (`dev-engine.ts`) —
 * ahead of `canonicalBareSpecifierResolvePlugin()`/`deno()` — so this always wins the `resolveId`
 * chain for `@zanix/space`/`@zanix/server` before either gets a chance to resolve them into a real,
 * Vite-transformable file path. See this file's own header doc for the full identity fix this
 * implements and why the two simpler alternatives (a plain `resolve.external` config entry, or a
 * `resolveId` hook returning `{ id: absolutePath, external: true }`) don't work.
 *
 * `enforce: 'pre'` is required for `react`/`react-dom` specifically, not optional polish: array
 * position alone decides call order only AMONG plugins of the same `enforce` tier — Rollup/Vite
 * always runs every `enforce: 'pre'` plugin's own `resolveId` (as a group, in their own relative
 * array order) before any un-enforced ("normal") plugin gets a turn, regardless of where either
 * sits in the overall array. `@vitejs/plugin-react` (reached via `dev-engine.ts`'s own
 * `...options.plugins`, positionally AFTER this plugin) registers its own `resolveId` hooks with
 * `enforce: 'pre'` too — without matching that tier here, this plugin (at "normal" tier) would
 * never get a turn for a bare `import 'react'` at all, no matter how early in the array it's
 * registered: confirmed by inspecting a real generated SSR module, which still resolves `react` to
 * a plain `node_modules` path even without `enforce: 'pre'` here, despite `NATIVE_RUNTIME_MODULES`
 * listing it.
 * `@zanix/space`/`@zanix/server` never needed this — nothing else in the pipeline resolves those
 * two at `enforce: 'pre'`, so "normal" tier already won for them; `react`/`react-dom` need the same
 * tier as their own competing resolver to reliably win the array-order tiebreak within it.
 *
 * Only ever active for the `ssr` environment — the `client` environment (a real browser's own
 * bundle) has no native Deno process to share identity with in the first place, and must keep
 * resolving/bundling these normally like any other dependency.
 */
export function nativeRuntimeModulesPlugin(): Plugin {
  return {
    name: 'zanix-space-dev-native-runtime-modules',
    enforce: 'pre',
    resolveId(id) {
      if (this.environment?.name !== 'ssr') return null
      if (!isNativeRuntimeSpecifier(id)) return null
      return { id: toNativeRuntimeSentinel(id), external: true }
    },
  }
}
