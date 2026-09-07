import { assert, assertFalse } from '@std/assert'
import './dom-test-setup.ts'
import { isNestedComet } from 'modules/client/nested-comet-guard.ts'
import { COMET_ID_ATTR } from 'modules/comets/marker.ts'

Deno.test('isNestedComet: a top-level boundary (no Comet ancestor) is not nested', () => {
  const boundary = document.createElement('div')
  boundary.setAttribute(COMET_ID_ATTR, 'abc123')
  document.body.appendChild(boundary)

  assertFalse(isNestedComet(boundary))

  document.body.innerHTML = ''
})

Deno.test(
  'isNestedComet: a boundary whose direct parent is ANOTHER Comet boundary is nested',
  () => {
    const outer = document.createElement('div')
    outer.setAttribute(COMET_ID_ATTR, 'outer')
    const inner = document.createElement('div')
    inner.setAttribute(COMET_ID_ATTR, 'inner')
    outer.appendChild(inner)
    document.body.appendChild(outer)

    assert(isNestedComet(inner))

    document.body.innerHTML = ''
  },
)

Deno.test(
  'isNestedComet: a boundary several levels below an ANCESTOR Comet boundary is still nested',
  () => {
    const outer = document.createElement('div')
    outer.setAttribute(COMET_ID_ATTR, 'outer')
    const wrapper = document.createElement('div')
    const inner = document.createElement('span')
    inner.setAttribute(COMET_ID_ATTR, 'inner')
    wrapper.appendChild(inner)
    outer.appendChild(wrapper)
    document.body.appendChild(outer)

    assert(isNestedComet(inner))

    document.body.innerHTML = ''
  },
)

Deno.test(
  'isNestedComet: never mistakes the boundary itself for an ancestor — checks from its OWN ' +
    "parent up, never starting at the boundary's own attribute",
  () => {
    // A lone boundary with no Comet ancestor at all, wrapped in a plain, non-Comet parent — if
    // this ever regressed to check the element ITSELF first (e.g. a naive `closest()` on the
    // boundary, which always matches itself), this would incorrectly report "nested".
    const parent = document.createElement('div')
    const boundary = document.createElement('div')
    boundary.setAttribute(COMET_ID_ATTR, 'solo')
    parent.appendChild(boundary)
    document.body.appendChild(parent)

    assertFalse(isNestedComet(boundary))

    document.body.innerHTML = ''
  },
)
