import { resetDom } from './dom-test-setup.ts'
import { initClientEntry } from 'modules/client/client-entry-init-preact.ts'

// Preact-core counterpart to `client-entry-init.test.ts` — same coverage, same rationale, against
// the Preact barrel's own `initClientEntry` (`hydrate-comets-preact.ts`/
// `hydrate-error-boundaries-preact.ts`, sharing the same renderer-agnostic `orbit.ts`/`prefetch.ts`
// the React variant uses). See that file's own doc for the full reasoning.

Deno.test(
  'initClientEntry (preact): runs against a real document with nothing to hydrate, without throwing',
  () => {
    resetDom()
    initClientEntry()
  },
)

Deno.test(
  'initClientEntry (preact): accepts and forwards a real options object to initOrbit, and is safe ' +
    'to call twice',
  () => {
    resetDom()
    initClientEntry({ prefetch: false })
    initClientEntry({ prefetch: { onHover: true } })
  },
)
