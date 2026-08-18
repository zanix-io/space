/**
 * A stand-in module that fails the moment it is EVALUATED — never on import resolution alone.
 *
 * Used by `renderer-isolation.test.ts`: an import map points `react`/`react-dom/server` (or
 * `preact`/`preact-render-to-string`) here, and a real SSR render then runs in a subprocess. If the
 * framework touches the renderer it is supposed to be free of, this module runs and the process
 * dies with a message naming it. Nothing else can produce that outcome, which is what makes the
 * test evidence rather than assertion.
 *
 * @module
 */
throw new Error(
  'POISONED RENDERER EVALUATED — a module that must never load in this process was evaluated.',
)
