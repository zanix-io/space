import { assert, assertEquals, assertFalse, assertNotEquals } from '@std/assert'
import { resetDom } from './dom-test-setup.ts'
import { COMET_PERSIST_ATTR, COMET_PERSIST_VT_ATTR } from 'modules/comets/marker.ts'
import { hashSourceKey } from 'modules/comets/comet-manifest.ts'
import {
  persistTransitionName,
  registerPersistTransitionNames,
} from 'modules/client/comet-persist-transition.ts'

// `dom-test-setup.ts`'s own `happy-dom` document is enough here — this module only ever touches
// `document.createElement`/`document.head`/`document.querySelector`/plain `Element` methods, none
// of the extra BOM surface (`location`/`history`/global events) `orbit-navigation.test.ts` bridges
// for its own, much wider harness.

// deno-lint-ignore no-explicit-any
const globals = globalThis as any

/** A real `HTMLStyleElement.sheet`'s own `cssRules`, flattened to plain `cssText` strings — the
 * only thing any test here needs to assert against; never the live `CSSStyleSheet` object itself. */
function ruleTexts(): string[] {
  const style = globals.document.head.querySelector('style')
  if (!style?.sheet) return []
  return [...style.sheet.cssRules].map((rule: CSSRule) => rule.cssText)
}

function boundary(key: string | null): Element {
  const el = globals.document.createElement('div')
  if (key !== null) el.setAttribute(COMET_PERSIST_ATTR, key)
  return el
}

/** Wraps `children` in a fresh, detached `<div>` — `registerPersistTransitionNames` (like the real
 * `outlet`/`template.content` roots `swapOutlet` passes it) only ever matches DESCENDANTS of a
 * root via `querySelectorAll`, never the root element itself, so every scenario below that means
 * "a boundary living inside a page" needs one of these, not a bare boundary element passed
 * directly as its own root. */
function container(...children: Element[]): Element {
  const el = globals.document.createElement('div')
  for (const child of children) el.appendChild(child)
  return el
}

function setUp(): void {
  resetDom()
  delete globals.document.startViewTransition
}

Deno.test(
  'persistTransitionName: the SAME raw key always produces the SAME name — required for a THIRD, ' +
    'FOURTH, ... navigation back to the same persist key to keep morphing smoothly, not just the ' +
    'first reuse',
  () => {
    assertEquals(persistTransitionName('sidebar'), persistTransitionName('sidebar'))
  },
)

Deno.test(
  'persistTransitionName: two different keys produce two different names',
  () => {
    assertNotEquals(persistTransitionName('sidebar'), persistTransitionName('cart'))
  },
)

Deno.test(
  'persistTransitionName: built from hashSourceKey directly, with a fixed CSS-custom-ident-safe ' +
    'prefix — never the raw key text itself, which is neither guaranteed unique nor a valid ' +
    'view-transition-name on its own',
  () => {
    assertEquals(persistTransitionName('sidebar'), `znx-persist-${hashSourceKey('sidebar')}`)
  },
)

Deno.test(
  'registerPersistTransitionNames: a no-op when the browser has no View Transitions support at ' +
    'all — no attribute is set, no <style> element is created',
  () => {
    setUp()
    const el = boundary('sidebar')
    globals.document.body.appendChild(el)

    registerPersistTransitionNames(globals.document.body)

    assertFalse(el.hasAttribute(COMET_PERSIST_VT_ATTR))
    assertEquals(globals.document.head.querySelector('style'), null)
  },
)

Deno.test(
  'registerPersistTransitionNames: with View Transitions supported, a persist-tagged element gets ' +
    'its own view-transition-name attribute, backed by a real CSSOM rule for that exact selector',
  () => {
    setUp()
    globals.document.startViewTransition = () => {}
    const el = boundary('sidebar')
    globals.document.body.appendChild(el)

    registerPersistTransitionNames(globals.document.body)

    const name = el.getAttribute(COMET_PERSIST_VT_ATTR)
    assertEquals(name, persistTransitionName('sidebar'))
    const rules = ruleTexts()
    assertEquals(rules.length, 1)
    assert(
      rules[0].includes(`[${COMET_PERSIST_VT_ATTR}="${name}"]`) &&
        rules[0].includes(`view-transition-name: ${name}`),
      `expected a rule targeting [${COMET_PERSIST_VT_ATTR}="${name}"], got: ${rules[0]}`,
    )
  },
)

Deno.test(
  'registerPersistTransitionNames: an element with no persist key at all (attribute absent) is ' +
    'left untouched',
  () => {
    setUp()
    globals.document.startViewTransition = () => {}
    const plain = globals.document.createElement('div')
    globals.document.body.appendChild(plain)

    registerPersistTransitionNames(globals.document.body)

    assertFalse(plain.hasAttribute(COMET_PERSIST_VT_ATTR))
    assertEquals(ruleTexts().length, 0)
  },
)

Deno.test(
  'registerPersistTransitionNames: scans EVERY root it is given, not just the first — the real ' +
    'shape swapOutlet needs, since a persist key can appear on EITHER side of a navigation ' +
    'without being reused on both',
  () => {
    setUp()
    globals.document.startViewTransition = () => {}
    const outgoing = boundary('sidebar')
    const incoming = boundary('cart')

    registerPersistTransitionNames(container(outgoing), container(incoming))

    assertEquals(outgoing.getAttribute(COMET_PERSIST_VT_ATTR), persistTransitionName('sidebar'))
    assertEquals(incoming.getAttribute(COMET_PERSIST_VT_ATTR), persistTransitionName('cart'))
    assertEquals(ruleTexts().length, 2)
  },
)

Deno.test(
  'registerPersistTransitionNames: the SAME persist key seen again across a LATER call reuses the ' +
    'already-inserted rule instead of inserting a duplicate',
  () => {
    setUp()
    globals.document.startViewTransition = () => {}
    const first = boundary('sidebar')
    registerPersistTransitionNames(container(first))
    assertEquals(ruleTexts().length, 1)

    // A fresh element (a freshly-parsed destination placeholder, exactly as swapOutlet produces
    // from a new fragment) carrying the SAME persist key.
    const second = boundary('sidebar')
    registerPersistTransitionNames(container(second))

    assertEquals(ruleTexts().length, 1, 'no duplicate rule for the same view-transition-name')
    assertEquals(
      second.getAttribute(COMET_PERSIST_VT_ATTR),
      first.getAttribute(COMET_PERSIST_VT_ATTR),
    )
  },
)

Deno.test(
  'registerPersistTransitionNames: a DIFFERENT key inserts its own additional rule, never replacing ' +
    'the first',
  () => {
    setUp()
    globals.document.startViewTransition = () => {}
    registerPersistTransitionNames(container(boundary('sidebar')))
    registerPersistTransitionNames(container(boundary('cart')))

    assertEquals(ruleTexts().length, 2)
  },
)

Deno.test(
  "registerPersistTransitionNames: the shared <style> element's nonce is copied from whatever " +
    "document.querySelector('[nonce]') returns — the one channel a strict CSP nonce policy " +
    'leaves open for trusted same-origin script to read an already-parsed nonce back. Stubs ' +
    "querySelector directly rather than building a real nonced element: happy-dom's own `.nonce` " +
    'IDL property never reflects a real attribute-set nonce regardless of how that attribute was ' +
    'set (`setAttribute`, the `.nonce` property, or real HTML parsing all leave it `undefined`), ' +
    "so this exercises this module's own contract — read `.nonce` off whatever `querySelector` " +
    'returns — independently of that gap; the real attribute/IDL wiring itself is confirmed ' +
    'against actual Chromium/Firefox semantics elsewhere in this codebase (`dev-vite-hot-client.ts`)',
  () => {
    setUp()
    globals.document.startViewTransition = () => {}
    const originalQuerySelector = globals.document.querySelector.bind(globals.document)
    globals.document.querySelector = (selector: string) =>
      selector === '[nonce]' ? { nonce: 'abc123' } : originalQuerySelector(selector)

    try {
      registerPersistTransitionNames(container(boundary('sidebar')))

      const style = globals.document.head.querySelector('style')
      assertEquals(style.nonce, 'abc123')
    } finally {
      globals.document.querySelector = originalQuerySelector
    }
  },
)

Deno.test(
  'registerPersistTransitionNames: no nonced element anywhere in the document (a page with CSP ' +
    'fully disabled) — the <style> element is still created, just with no nonce attribute, never ' +
    'an error',
  () => {
    setUp()
    globals.document.startViewTransition = () => {}

    registerPersistTransitionNames(container(boundary('sidebar')))

    const style = globals.document.head.querySelector('style')
    assert(style, 'the style element must still be created')
    assertFalse(style.hasAttribute('nonce'))
  },
)
