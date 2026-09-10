import { assert, assertEquals, assertFalse } from '@std/assert'
import { resetDom } from './dom-test-setup.ts'
import { reviveFragmentStyles } from 'modules/client/orbit.ts'

// The real, root-cause fix `revive-fragment-scripts.test.ts`'s own suite already covers for
// `<script>` — `reviveFragmentStyles` is that function's sibling for `<style nonce>` elements,
// confirmed live: a nonce-based `style-src` never honors a nonce set through an HTML attribute a
// browser only ever PARSED (via `template.innerHTML`), only one assigned as a real element property
// after `document.createElement` — true for `<style>` exactly as much as for `<script>`, and this
// package's own `orbit.ts` used to revive only the latter, throwing the `Applying inline style
// violates the following Content Security Policy directive` violation for real, live component
// styles (`Modal`/`Drawer`/`Popover`/`Tooltip`'s own positioning `<style nonce>`, and this package's
// own built-in comet-visibility rule) the moment they were reached through a click-driven Orbit
// navigation rather than a full page load.

Deno.test(
  'reviveFragmentStyles: a revived style actually gets the ACTIVE document nonce, not the stale ' +
    "fragment one — the same reasoning getActiveCspNonce()'s own doc establishes for a Comet " +
    'generating new content client-side',
  () => {
    resetDom()
    // Stubs `document.querySelector('[nonce]')` directly, exactly like
    // `revive-fragment-scripts.test.ts`/`orbit-navigation.test.ts` already do — happy-dom's own
    // `.nonce` IDL property never reflects a real attribute-set nonce regardless of how that
    // attribute was set, so building a genuine nonced element here wouldn't exercise
    // `getActiveCspNonce()`'s real contract at all.
    // deno-lint-ignore no-explicit-any
    const globals = globalThis as any
    const originalQuerySelector = globals.document.querySelector.bind(globals.document)
    globals.document.querySelector = (selector: string) =>
      selector === '[nonce]' ? { nonce: 'active-nonce-value' } : originalQuerySelector(selector)

    try {
      const template = document.createElement('template')
      template.innerHTML = '<style nonce="stale-fragment-nonce">body{overflow:hidden}</style>'

      reviveFragmentStyles(template.content, undefined)

      // `.nonce`, never `getAttribute('nonce')` — same reasoning
      // `revive-fragment-scripts.test.ts`'s own suite already documents: happy-dom keeps the IDL
      // property and the content attribute completely decoupled, unlike a real browser (which only
      // hides the ATTRIBUTE once inserted, while keeping the IDL property in sync); asserting
      // through the property is what actually exercises `reviveFragmentStyles`'s own
      // `style.nonce = nonce` assignment here.
      const style = template.content.querySelector('style') as HTMLStyleElement | null
      assert(style, 'expected the style to survive as a style')
      assertEquals(style.nonce, 'active-nonce-value')
    } finally {
      globals.document.querySelector = originalQuerySelector
    }
  },
)

Deno.test(
  'reviveFragmentStyles: finds and replaces a style nested at any depth, with a genuinely fresh ' +
    'element at the exact same position',
  () => {
    resetDom()
    const template = document.createElement('template')
    template.innerHTML =
      '<div id="outer"><div id="inner"><style>body{overflow:hidden}</style></div></div>'
    const original = template.content.querySelector('style')
    assert(original, 'expected a style fixture to exist before reviving')

    reviveFragmentStyles(template.content, undefined)

    const inner = template.content.querySelector('#inner')
    const revived = template.content.querySelector('style')
    assert(revived, 'expected a style to still be there after reviving')
    assert(revived !== original, 'expected a genuinely NEW element, never the parsed original')
    assertEquals(revived.parentElement, inner, 'expected it to stay at the same nested position')
  },
)

Deno.test(
  'reviveFragmentStyles: never touches non-style content — attributes, text, and structure ' +
    'survive exactly as parsed',
  () => {
    resetDom()
    const template = document.createElement('template')
    template.innerHTML =
      '<div id="a" class="keep-me">hello<style>body{overflow:hidden}</style></div>'

    reviveFragmentStyles(template.content, undefined)

    const div = template.content.querySelector('#a')
    assert(div, 'expected the div to survive')
    assertEquals(div.getAttribute('class'), 'keep-me')
    assertEquals(div.firstChild?.textContent, 'hello')
  },
)

Deno.test(
  'reviveFragmentStyles: the fresh style keeps its own text content and other real attributes',
  () => {
    resetDom()
    const template = document.createElement('template')
    template.innerHTML = '<style media="screen">body{overflow:hidden}</style>'

    reviveFragmentStyles(template.content, undefined)

    const style = template.content.querySelector('style')
    assert(style, 'expected the style to survive as a style')
    assertEquals(style.getAttribute('media'), 'screen')
    assertEquals(style.textContent, 'body{overflow:hidden}')
  },
)

// Security regression coverage: a fragment's own STYLE-LEVEL nonce (as opposed to the fragment
// response's CSP header's declared nonce, `fragmentNonce`) must actually be checked before a style
// is ever revived — the exact gap `revive-fragment-scripts.test.ts`'s own suite already covers for
// `<script>`, mirrored here so `<style>` gets the identical CSP-protection guarantee.

Deno.test(
  'reviveFragmentStyles: a style whose own nonce matches fragmentNonce IS revived',
  () => {
    resetDom()
    const template = document.createElement('template')
    template.innerHTML = '<style nonce="real-fragment-nonce">body{overflow:hidden}</style>'
    const original = template.content.querySelector('style')

    reviveFragmentStyles(template.content, 'real-fragment-nonce')

    const revived = template.content.querySelector('style')
    assert(revived, 'expected the style to still be there')
    assert(revived !== original, 'expected a genuinely NEW element')
  },
)

Deno.test(
  'reviveFragmentStyles: a style with NO nonce at all is left untouched (never revived) when ' +
    'fragmentNonce is set',
  () => {
    resetDom()
    const template = document.createElement('template')
    template.innerHTML = '<style>body{overflow:hidden}</style>'
    const original = template.content.querySelector('style')

    reviveFragmentStyles(template.content, 'real-fragment-nonce')

    assertEquals(template.content.querySelector('style'), original)
  },
)

Deno.test(
  "reviveFragmentStyles: a style whose nonce doesn't match fragmentNonce is left untouched — the " +
    'exact injected-style scenario this gate exists for',
  () => {
    resetDom()
    const template = document.createElement('template')
    template.innerHTML = '<style nonce="attacker-guessed-nonce">body{overflow:hidden}</style>'
    const original = template.content.querySelector('style')

    reviveFragmentStyles(template.content, 'real-fragment-nonce')

    assertEquals(template.content.querySelector('style'), original)
  },
)

Deno.test(
  'reviveFragmentStyles: on a page with no nonce-based CSP at all, the fresh style carries no ' +
    'nonce either',
  () => {
    resetDom()
    const template = document.createElement('template')
    template.innerHTML = '<style>body{overflow:hidden}</style>'

    reviveFragmentStyles(template.content, undefined)

    const style = template.content.querySelector('style')
    assert(style, 'expected the style to survive as a style')
    assertFalse(style.hasAttribute('nonce'))
  },
)

Deno.test(
  'reviveFragmentStyles: a fragment with no style at all is left completely untouched',
  () => {
    resetDom()
    const template = document.createElement('template')
    template.innerHTML = '<div id="a">hello</div>'

    reviveFragmentStyles(template.content, undefined)

    assertEquals(template.content.querySelector('#a')?.textContent, 'hello')
  },
)
