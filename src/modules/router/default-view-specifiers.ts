/**
 * The ONE place `not-found-handler.ts`/`loader-error-handler.ts` write down the relative specifiers
 * for the built-in default not-found/error views — resolved lazily, via `getActiveRenderer()`, at
 * `renderNotFoundResponse`/`renderLoaderErrorPage`'s own first real invocation, never eagerly.
 *
 * The `const specifier = SOME_SPECIFIER` two-step at each call site (never `import(SOME_SPECIFIER)`
 * inlined as a literal) is deliberate, not incidental — same reasoning `lazy/specifiers.ts` already
 * documents for `SVGO_SPECIFIER`: Deno's own module graph builder only follows a dynamic `import()`
 * whose argument it can resolve as a literal at parse time, so routing it through a variable keeps
 * an app that only ever activates ONE renderer out of the other renderer's own reachable graph
 * entirely — `.` never really resolves `react`/`preact` merely by exporting `SpacePageController`/
 * `createNotFoundHandler`, only whichever renderer's `import '@zanix/space/react'` or
 * `import '@zanix/space/preact'` the app itself installs.
 *
 * Declared here, in `router/`, rather than the package-wide `lazy/specifiers.ts` — these are
 * RELATIVE specifiers, resolved against the calling module's own location (`not-found-handler.ts`/
 * `loader-error-handler.ts`, both siblings of the four view files below), unlike
 * `lazy/specifiers.ts`'s own `npm:` specifiers, which carry no such directory coupling.
 */

export const DEFAULT_NOT_FOUND_VIEW_REACT_SPECIFIER = './default-not-found-view.tsx'
export const DEFAULT_NOT_FOUND_VIEW_PREACT_SPECIFIER = './default-not-found-view-preact.ts'
export const DEFAULT_ERROR_VIEW_REACT_SPECIFIER = './default-error-view.tsx'
export const DEFAULT_ERROR_VIEW_PREACT_SPECIFIER = './default-error-view-preact.ts'

/**
 * The two error-view specifiers above, already resolved to a real, absolute `file://` URL —
 * computed HERE (against THIS module's own `import.meta.url`), not wherever a caller happens to
 * need one: a relative specifier resolves against the CALLING module's own location, so
 * `render-page-react.tsx`/`render-page-preact.ts` (siblings of the view files, same directory)
 * could resolve it inline correctly on their own, but `build-client.ts` (`modules/bundler/`, a
 * different directory) could not — `'./default-error-view.tsx'` resolved from there would look
 * for a file that doesn't exist. One resolution, from the one place it's guaranteed correct, used
 * by every caller — `composeSegments` (both renderers, for the render-phase "no error.tsx
 * anywhere" fallback) and `buildSpaceClient` (to bundle the active one as an auto-comet, same
 * reasoning `error-boundary-marker.ts`'s own module doc gives for an author's own `error.tsx`).
 *
 * `new URL(specifier, import.meta.url)`, deliberately NOT `import.meta.resolve(specifier)` — a
 * real, confirmed regression: `zanix space dev`'s own Vite-based SSR module runner intercepts
 * EVERY loaded module's `import.meta.resolve` (routing it through Vite's own resolution, encoded
 * as a synthetic `vite-module-runner:...` specifier for Node's loader hook API) but leaves the
 * plain `import.meta.url` PROPERTY untouched — calling the (intercepted) function threw
 * `TypeError [ERR_UNSUPPORTED_ESM_URL_SCHEME]` the moment this module was loaded through THAT
 * runner (which `render-page-react.tsx`, one of this exact file's own callers, always is, in dev),
 * breaking every single page render in dev, not just the rare "no error.tsx anywhere" case. Pure
 * client-side URL algebra on the string `import.meta.url` already is, this never touches Vite's
 * patched function at all — the same value `import.meta.resolve` would have produced for this
 * exact same-directory relative specifier in a real, un-intercepted Deno process (production SSR,
 * or `build-client.ts`'s own plain-`deno run` build script).
 */
export const DEFAULT_ERROR_VIEW_REACT_URL = new URL(
  DEFAULT_ERROR_VIEW_REACT_SPECIFIER,
  import.meta.url,
).href
export const DEFAULT_ERROR_VIEW_PREACT_URL = new URL(
  DEFAULT_ERROR_VIEW_PREACT_SPECIFIER,
  import.meta.url,
).href
