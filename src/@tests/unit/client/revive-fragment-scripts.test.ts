import { assert, assertEquals, assertFalse } from '@std/assert'
import { resetDom } from './dom-test-setup.ts'
import { reviveFragmentScripts } from 'modules/client/orbit.ts'

// The real, root-cause fix for the bug `orbit-fragment.test.tsx`'s own suite never caught (see
// that file's own doc): a fragment parsed via `template.innerHTML` and later moved into the live
// DOM via `outlet.replaceChildren(template.content)` never executes any `<script>` it carries —
// including React's own streaming Suspense reveal script (`$RC`) — because the HTML Living
// Standard marks a script "already started" the moment it's PARSED that way, regardless of where
// it ends up moved to afterward. `reviveFragmentScripts` (`orbit.ts`) is the workaround: replace
// every such script with a freshly-created one, in place, before the fragment is ever connected.
//
// Needs `enableJavaScriptEvaluation: true` (`dom-test-setup.ts`'s own Window construction) —
// confirmed empirically that happy-dom, with it on, implements the same "already started"
// distinction real browsers do, which is exactly what this suite exercises.

Deno.test(
  'reviveFragmentScripts: baseline — a script parsed via template.innerHTML never runs on its ' +
    'own, even once its fragment is moved into a connected document (confirms the bug this fixes ' +
    'is real, not just theorized)',
  async () => {
    resetDom()
    const template = document.createElement('template')
    template.innerHTML = '<div id="target"></div><script>' +
      'document.getElementById("target").textContent = "ran"' +
      '</script>'
    // Deliberately never revived here.
    document.body.appendChild(template.content)
    await Promise.resolve()

    assertEquals(document.getElementById('target')?.textContent, '')
  },
)

Deno.test(
  'reviveFragmentScripts: a revived script actually executes once its fragment connects',
  async () => {
    resetDom()
    const template = document.createElement('template')
    template.innerHTML = '<div id="target"></div><script>' +
      'document.getElementById("target").textContent = "ran"' +
      '</script>'

    reviveFragmentScripts(template.content)
    document.body.appendChild(template.content)
    await Promise.resolve()

    assertEquals(document.getElementById('target')?.textContent, 'ran')
  },
)

Deno.test(
  'reviveFragmentScripts: preserves document order across scripts that depend on each other — ' +
    "the exact shape React's own $RC/$RB reveal protocol needs (an earlier script defines " +
    'something a later one calls)',
  async () => {
    resetDom()
    const template = document.createElement('template')
    template.innerHTML = '<script>globalThis.__reviveTestHelper = (id) => ' +
      'document.getElementById(id).textContent = "revealed"' +
      '</script>' +
      '<div id="a"></div>' +
      '<script>globalThis.__reviveTestHelper("a")</script>'

    reviveFragmentScripts(template.content)
    try {
      document.body.appendChild(template.content)
      await Promise.resolve()

      assertEquals(document.getElementById('a')?.textContent, 'revealed')
    } finally {
      delete (globalThis as { __reviveTestHelper?: unknown }).__reviveTestHelper
    }
  },
)

Deno.test(
  'reviveFragmentScripts: finds and replaces a script nested at any depth, not just a top-level ' +
    'child, with a genuinely fresh element at the exact same position',
  () => {
    // Structural only, not execution — happy-dom's own insertion-steps implementation, confirmed
    // separately, only re-checks the DIRECTLY appended node for script execution, never a
    // descendant several levels down inside a subtree moved in one call (a real gap against the
    // DOM Standard's own "insert" algorithm, which runs insertion steps for every
    // shadow-including INCLUSIVE DESCENDANT, not just the node itself — real browsers execute a
    // nested script exactly like this). `reviveFragmentScripts` itself doesn't care about depth
    // either way: `querySelectorAll('script')` already finds every one regardless, and
    // `replaceWith` puts the fresh element back at the SAME position — this asserts exactly that
    // structural guarantee, independent of happy-dom's own execution-checking gap.
    resetDom()
    const template = document.createElement('template')
    template.innerHTML = '<div id="outer"><div id="inner"><script>1</script></div></div>'
    const original = template.content.querySelector('script')
    assert(original, 'expected a script fixture to exist before reviving')

    reviveFragmentScripts(template.content)

    const inner = template.content.querySelector('#inner')
    const revived = template.content.querySelector('script')
    assert(revived, 'expected a script to still be there after reviving')
    assert(revived !== original, 'expected a genuinely NEW element, never the parsed original')
    assertEquals(revived.parentElement, inner, 'expected it to stay at the same nested position')
  },
)

Deno.test(
  'reviveFragmentScripts: never touches non-script content — attributes, text, and structure ' +
    'survive exactly as parsed',
  () => {
    resetDom()
    const template = document.createElement('template')
    template.innerHTML = '<div id="a" class="keep-me">hello<script>1</script></div>'

    reviveFragmentScripts(template.content)

    const div = template.content.querySelector('#a')
    assert(div, 'expected the div to survive')
    assertEquals(div.getAttribute('class'), 'keep-me')
    assertEquals(div.firstChild?.textContent, 'hello')
  },
)

Deno.test(
  'reviveFragmentScripts: an external script keeps its src (and other real attributes) on the ' +
    'fresh element',
  () => {
    resetDom()
    const template = document.createElement('template')
    template.innerHTML = '<script src="/vendor.js" async></script>'

    reviveFragmentScripts(template.content)

    const script = template.content.querySelector('script')
    assert(script, 'expected the script to survive as a script')
    assertEquals(script.getAttribute('src'), '/vendor.js')
    assert(script.hasAttribute('async'))
  },
)

Deno.test(
  "reviveFragmentScripts: never copies the original's own nonce — every fresh script gets the " +
    "ACTIVE document's current nonce instead, the same reasoning getActiveCspNonce()'s own doc " +
    'already establishes for a Comet generating new content',
  () => {
    resetDom()
    // Stubs `document.querySelector('[nonce]')` directly, exactly like
    // `orbit-navigation.test.ts`/`active-nonce.test.ts` already do — happy-dom's own `.nonce` IDL
    // property never reflects a real attribute-set nonce regardless of how that attribute was
    // set, so building a genuine nonced element here wouldn't exercise
    // `getActiveCspNonce()`'s real contract at all. The stubbed value is deliberately DIFFERENT
    // from the fragment's own stale one below — the exact real-world mismatch: two different
    // requests, two different per-request nonces.
    // deno-lint-ignore no-explicit-any
    const globals = globalThis as any
    const originalQuerySelector = globals.document.querySelector.bind(globals.document)
    globals.document.querySelector = (selector: string) =>
      selector === '[nonce]' ? { nonce: 'active-nonce-value' } : originalQuerySelector(selector)

    try {
      const template = document.createElement('template')
      template.innerHTML = '<script nonce="stale-fragment-nonce">1</script>'

      reviveFragmentScripts(template.content)

      // `.nonce`, never `getAttribute('nonce')` — same reasoning `active-nonce.test.ts`'s own
      // suite already documents: happy-dom keeps the IDL property and the content attribute
      // completely decoupled in both directions, unlike a real browser (which only hides the
      // ATTRIBUTE once inserted, while keeping the IDL property in sync); asserting through the
      // property is what actually exercises `reviveFragmentScripts`'s own `script.nonce = nonce`
      // assignment here.
      const script = template.content.querySelector('script') as HTMLScriptElement | null
      assert(script, 'expected the script to survive as a script')
      assertEquals(script.nonce, 'active-nonce-value')
    } finally {
      globals.document.querySelector = originalQuerySelector
    }
  },
)

Deno.test(
  'reviveFragmentScripts: on a page with no nonce-based CSP at all, the fresh script carries no ' +
    'nonce either',
  () => {
    resetDom()
    const template = document.createElement('template')
    template.innerHTML = '<script>1</script>'

    reviveFragmentScripts(template.content)

    const script = template.content.querySelector('script')
    assert(script, 'expected the script to survive as a script')
    assertFalse(script.hasAttribute('nonce'))
  },
)

Deno.test(
  'reviveFragmentScripts: a fragment with no script at all is left completely untouched',
  () => {
    resetDom()
    const template = document.createElement('template')
    template.innerHTML = '<div id="a">hello</div>'

    reviveFragmentScripts(template.content)

    assertEquals(template.content.querySelector('#a')?.textContent, 'hello')
  },
)
