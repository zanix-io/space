import { assertEquals } from '@std/assert'
import './dom-test-setup.ts'
import { getActiveCspNonce } from 'modules/client/active-nonce.ts'

// deno-lint-ignore no-explicit-any
const globals = globalThis as any

/** Stubs `document.querySelector('[nonce]')` directly rather than building a real nonced
 * element — same reasoning as `comet-persist-transition.test.ts`'s own identical stub: happy-dom's
 * `.nonce` IDL property never reflects a real attribute-set nonce regardless of how that attribute
 * was set, so this exercises this module's own contract (read `.nonce` off whatever
 * `querySelector('[nonce]')` returns) independently of that gap. */
function stubNoncedElement(nonce: string | undefined): () => void {
  const original = globals.document.querySelector.bind(globals.document)
  globals.document.querySelector = (selector: string) =>
    selector === '[nonce]' && nonce !== undefined ? { nonce } : original(selector)
  return () => {
    globals.document.querySelector = original
  }
}

Deno.test(
  'getActiveCspNonce: returns the nonce a real, parsed element carries',
  () => {
    const restore = stubNoncedElement('abc123')
    try {
      assertEquals(getActiveCspNonce(), 'abc123')
    } finally {
      restore()
    }
  },
)

Deno.test(
  'getActiveCspNonce: no nonced element anywhere (CSP fully disabled) returns undefined',
  () => {
    const restore = stubNoncedElement(undefined)
    try {
      assertEquals(getActiveCspNonce(), undefined)
    } finally {
      restore()
    }
  },
)

Deno.test(
  'getActiveCspNonce: an empty-string nonce is treated the same as none at all',
  () => {
    const restore = stubNoncedElement('')
    try {
      assertEquals(getActiveCspNonce(), undefined)
    } finally {
      restore()
    }
  },
)
