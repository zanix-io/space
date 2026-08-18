// Installs a renderer, exactly as a real app does: `@zanix/space` itself ships none, so a
// test that renders must import the entry point it is testing against.
import '../../../../mod-react.ts'
import '../../../../mod-preact.ts'
import { assertEquals, assertRejects, assertStringIncludes, assertThrows } from '@std/assert'
import { InternalError } from '@zanix/errors'
import { loadRoutes } from 'modules/router/mod.ts'
import { setActiveRenderer } from 'modules/router/active-renderer.ts'
import type { RendererKind } from 'modules/router/active-renderer.ts'
import type { CometElementFactory } from 'modules/comets/element-factory.ts'
import {
  getCometElementFactory,
  resetCometElementFactories,
  setCometElementFactory,
} from 'modules/comets/element-factory.ts'
import { clientBarrelGuardPlugin } from 'modules/bundler/client-barrel-guard.ts'

console.error = () => {}

// ================================================================================================
// THE INVARIANT: one renderer per project. React and Preact are never mixed inside one app.
//
// This is a public contract of `@zanix/space`, not an implementation detail, and it is the reason
// the previous end-to-end Preact not-found case had to be deleted rather than adapted: its fixture
// was JSX compiled against React's factory, so running it under Preact WAS a mixed-renderer app.
// Deleting an invalid test must not quietly delete the rule it happened to touch, so this file
// states the invariant once and exercises every point where the package actually enforces it.
//
// Four enforcement points exist, and they are deliberately different in kind:
//
//   1. `loadRoutes`          — rejects `loading.tsx` under Preact, at route-registration time.
//   2. `getCometElementFactory` — refuses to render a Comet on the Preact path with no Preact
//                              factory registered, instead of emitting silently empty markup.
//   3. `useRequestCache`     — rejected outright under Preact (covered in `request-cache.test.tsx`,
//                              which owns that symbol's tests; referenced here for completeness).
//   4. `clientBarrelGuard`   — a BUILD-time guard: importing the client barrel belonging to the
//                              other renderer fails the build.
//
// What this file does NOT claim: there is no single, general mechanism that detects "this module
// was authored for the other renderer". No such check exists, and none is pretended here. The
// invariant is enforced at the specific seams where a mismatch would otherwise fail silently, which
// is the honest scope of the guarantee.
// ================================================================================================

Deno.test(
  'renderer invariant [1/4]: loadRoutes rejects loading.tsx under --renderer=preact, at ' +
    'registration time — Preact core has no Suspense, so the file has no renderer to run on',
  async () => {
    setActiveRenderer('preact')
    try {
      const error = await assertRejects(
        () => loadRoutes('src/@tests/support/fixtures/loading-routes'),
        InternalError,
      )
      assertStringIncludes(error.message, 'loading.tsx is not supported under --renderer=preact')
      // Actionable, not merely loud: it names the offending file and the two real ways out.
      assertStringIncludes(error.message, '--renderer=react')
    } finally {
      setActiveRenderer('react')
    }
  },
)

// Both element factories are registered once, at `@zanix/space/react` / `@zanix/space/preact`
// module load. Resetting them is therefore NOT recoverable by re-importing those modules — the
// registration line will not run again for an already-loaded module. Any test that resets them must
// capture and restore BOTH, or every later Comet test in the same process renders with no factory.
// Found the hard way: this file's own first version left one reset and broke
// `comet-css-scope.test.tsx` several files later, in the full-suite run only.
function withFactoriesRestored(run: () => void): void {
  const captured: Partial<Record<RendererKind, CometElementFactory>> = {}
  for (const kind of ['react', 'preact'] as const) {
    setActiveRenderer(kind)
    try {
      captured[kind] = getCometElementFactory()
    } catch {
      // Not registered in this process — nothing to restore for that renderer.
    }
  }
  try {
    run()
  } finally {
    setActiveRenderer('react')
    for (const kind of ['react', 'preact'] as const) {
      const factory = captured[kind]
      if (factory) setCometElementFactory(kind, factory)
    }
  }
}

Deno.test(
  'renderer invariant [2/4]: a Comet cannot render on the Preact path without the Preact element ' +
    'factory — this used to produce silently empty markup, which is exactly how the original ' +
    'defect survived a full suite and an architecture audit',
  () => {
    withFactoriesRestored(() => {
      setActiveRenderer('preact')
      resetCometElementFactories()
      const error = assertThrows(() => getCometElementFactory(), InternalError)
      assertStringIncludes(error.message, "The active renderer is 'preact'")
      // Actionable: it names the entry point to import, which is the only fix.
      assertStringIncludes(error.message, '@zanix/space/preact')
    })
  },
)

Deno.test(
  'renderer invariant [2/4b]: the same call returns the REACT factory once that entry point is ' +
    "imported — the guard is symmetric now, since neither renderer is this package's default",
  () => {
    // Deliberately does NOT reset anything: the assertion is about the react path returning its
    // own factory, and clearing shared state it does not need would leak into every later Comet
    // test in the process.
    setActiveRenderer('react')
    const factory = getCometElementFactory()
    if (typeof factory !== 'function') {
      throw new Error('expected a real element factory for the react renderer')
    }
  },
)

// The two client hydrate modules, by the resolved-module suffix the guard actually matches on. It
// keys off the module that reached the client graph, not the import string in source — which is
// what makes it catch a mismatch arriving through a re-export or an alias too.
const REACT_HYDRATE = '/client/hydrate-comets.ts'
const PREACT_HYDRATE = '/client/hydrate-comets-preact.ts'

/** Calls the guard plugin's own `transform` hook the way Vite would. */
function runGuard(renderer: 'react' | 'preact', moduleId: string): void {
  const plugin = clientBarrelGuardPlugin(renderer)
  const transform = plugin.transform as unknown as (
    code: string,
    id: string,
  ) => unknown
  transform('export {}', moduleId)
}

Deno.test(
  "renderer invariant [4/4]: the OTHER renderer's client barrel fails the build — a React app " +
    'whose client entry pulls in the Preact hydrate module, and vice versa',
  () => {
    for (
      const [renderer, wrongModule] of [
        ['react', PREACT_HYDRATE],
        ['preact', REACT_HYDRATE],
      ] as const
    ) {
      const error = assertThrows(
        () => runGuard(renderer, `/project/node_modules/@zanix/space/src/modules${wrongModule}`),
        Error,
        undefined,
        `expected renderer '${renderer}' to reject ${wrongModule}`,
      )
      assertStringIncludes(error.message, `renderer: '${renderer}'`)
      // The message has to be actionable: it names the barrel to import instead, and says outright
      // that the mismatch is otherwise SILENT — the page renders, nothing throws, and no Comet is
      // ever interactive.
      assertStringIncludes(error.message, 'Import `@zanix/space/client')
      assertStringIncludes(error.message, 'does not fail at runtime')
    }
  },
)

Deno.test(
  "renderer invariant [4/4b]: the renderer's OWN hydrate module passes the same guard untouched",
  () => {
    for (
      const [renderer, rightModule] of [
        ['react', REACT_HYDRATE],
        ['preact', PREACT_HYDRATE],
      ] as const
    ) {
      // Must not throw.
      runGuard(renderer, `/project/node_modules/@zanix/space/src/modules${rightModule}`)
    }
  },
)

Deno.test(
  'renderer invariant [4/4c]: the guard is scoped to the client environment — an SSR build that ' +
    'happens to touch either module is not an app shipping the wrong one',
  () => {
    const plugin = clientBarrelGuardPlugin('react')
    const applyToEnvironment = plugin.applyToEnvironment as unknown as (
      environment: { name: string },
    ) => boolean
    assertEquals(applyToEnvironment({ name: 'client' }), true)
    assertEquals(applyToEnvironment({ name: 'ssr' }), false)
  },
)
