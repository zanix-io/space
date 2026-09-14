/**
 * Which renderer this app was configured for — `defineSpaceApp({ renderer })`'s own value.
 * Deliberately its own tiny, zero-dependency module, not part of `page-renderer-registry.ts`
 * (which holds the actual `PageRenderer` function and, for that reason, imports
 * `render-page-react.ts` transitively): `request-cache.tsx` needs to read this value, and
 * `render-page-react.ts` imports `render-to-response.tsx`, which imports `request-cache.tsx` —
 * folding this into the same module as `page-renderer-registry.ts` would make that a real import
 * cycle (`request-cache.tsx` → registry → `render-page-react.ts` → `render-to-response.tsx` →
 * `request-cache.tsx`). Keeping the flag here, with zero imports of its own, avoids it entirely.
 *
 * @module
 */

/** Which renderer implementation an app installed — `'react'` or `'preact'`, matching
 * `defineSpaceApp({ renderer })`'s own accepted values. */
export type RendererKind = 'react' | 'preact'

// Stored on `globalThis`, not a plain module-scoped `let`: a module-scoped binding is only a real
// singleton if every reader and writer resolves through the SAME module instance. A dev-server
// bundler serving a large Comet chunk under load can land that chunk's own import of this module on
// a separate instance from the one `setActiveRenderer()` was called on — confirmed live, via a real
// crash (`getCometElementFactory`'s own `InternalError`) that correlated with page complexity
// (concurrently-hydrating Comets), not with any code change. `globalThis` is the one object every
// module instance a bundler might produce shares within the same realm, so keeping the flag there
// closes the gap regardless of which instance last imported this file.
const ACTIVE_RENDERER_KEY = '__znx_active_renderer__'

/** Set once by `defineSpaceApp({ renderer })`'s own `setup(ctx)`, before `loadRoutes()` runs (so
 * its own `loading.tsx` guard sees the right value) — never by a page author. */
export function setActiveRenderer(renderer: RendererKind): void {
  ;(globalThis as Record<string, unknown>)[ACTIVE_RENDERER_KEY] = renderer
}

/** Read by `load-routes.ts`'s `loading.tsx` guard and `request-cache.tsx`'s `useRequestCache`
 * guard — the only two places this package's own contract says must reject something outright
 * under Preact. Every other shared module stays fully unaware this even exists. */
export function getActiveRenderer(): RendererKind {
  return ((globalThis as Record<string, unknown>)[ACTIVE_RENDERER_KEY] as
    | RendererKind
    | undefined) ??
    'react'
}
