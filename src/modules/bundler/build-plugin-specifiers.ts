/**
 * The ONE place `build-client.ts` writes down the relative specifiers for `assetsPlugin`/
 * `mediaPlugin` — resolved lazily, gated behind `assetsDir` actually being configured, never
 * eagerly. Both real files reach `@zanix/utils`'s own `WorkerManager` (via `@zanix/logger`), whose
 * real `new Worker(new URL(...))` pattern (`workers/processor.ts`) Vite's own
 * `worker-import-meta-url` plugin statically detects and tries to bundle as a nested sub-build the
 * moment either file is merely reachable — a real, confirmed source of build failures for a plain
 * app with no `assetsDir` configured.
 *
 * The `const specifier = SOME_SPECIFIER` two-step at the call site (never `import(SOME_SPECIFIER)`
 * inlined as a literal) is deliberate, not incidental — same reasoning `router/
 * default-view-specifiers.ts` already documents: Deno's own module graph builder (and,
 * transitively, Vite/Rolldown's own static scan during a real build) only follows a dynamic
 * `import()` whose argument it can resolve as a literal at parse time — routing it through a
 * variable keeps an app that never configures `assetsDir` out of that graph entirely.
 *
 * Declared here, in `bundler/`, rather than the package-wide `modules/lazy/specifiers.ts` — these
 * are RELATIVE specifiers, resolved against the calling module's own location (`build-client.ts`,
 * a sibling of both files below), unlike `lazy/specifiers.ts`'s own `npm:`/`jsr:` specifiers, which
 * carry no such directory coupling.
 */

export const ASSETS_PLUGIN_SPECIFIER = './assets-plugin.ts'
export const MEDIA_PLUGIN_SPECIFIER = './media-plugin.ts'
