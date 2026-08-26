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
