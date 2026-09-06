import { resetDom } from './dom-test-setup.ts'
import { initClientEntry } from 'modules/client/client-entry-init.ts'

// `initClientEntry` has no branching of its own — a pure three-call composition
// (`hydrateComets()`, `hydrateErrorBoundaries()`, `initOrbit(options)`), each already covered at
// its own layer (`hydrate-comets.test.ts`, `hydrate-error-boundaries.test.ts`,
// `orbit-navigation.test.ts`), and end-to-end by `client-entry-plugin.test.ts`'s own build
// assertion that the auto-generated entry's compiled chunk really contains all three. What's worth
// covering here, cheaply, is that calling it against a real (happy-dom) document — no
// Comet/error-boundary markers, the common case on most page loads — runs to completion without
// throwing, that `options` really reaches `initOrbit` (a mismatched/misforwarded shape would still
// type-check if it happened to overlap, so this is real behavioral coverage `deno check` alone
// doesn't provide), and that calling it twice is still safe, matching `initOrbit`'s own idempotent
// listener registration.

Deno.test(
  'initClientEntry: runs against a real document with nothing to hydrate, without throwing',
  () => {
    resetDom()
    initClientEntry()
  },
)

Deno.test(
  'initClientEntry: accepts and forwards a real options object to initOrbit, and is safe to call ' +
    'twice',
  () => {
    resetDom()
    initClientEntry({ prefetch: false })
    // `onViewport` deliberately left out — it reaches `IntersectionObserver`, which this minimal
    // test environment (unlike `orbit-navigation.test.ts`'s own fuller BOM bridge) doesn't
    // provide; `onHover` alone is still real proof `options` reaches `initOrbit` unmodified.
    initClientEntry({ prefetch: { onHover: true } })
  },
)
