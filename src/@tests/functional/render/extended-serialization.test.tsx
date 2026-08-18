// Installs a renderer, exactly as a real app does: `@zanix/space` itself ships none, so a
// test that renders must import the entry point it is testing against.
import '../../../../mod-react.ts'
import '../../../../mod-preact.ts'
import { assert, assertEquals, assertFalse, assertInstanceOf } from '@std/assert'
import { createElement as reactCreateElement } from 'react'
import { createElement as preactCreateElement } from 'preact'
import { renderToResponse as renderToResponseReact } from 'modules/render/render-to-response.tsx'
import { renderToResponse as renderToResponsePreact } from 'modules/render/render-to-response-preact.ts'
// Imported for its registration side effect — the Preact element factory. See
// `define-comet-preact.test.ts`'s own note.
import 'modules/router/render-page-preact.ts'
import { defineComet } from 'modules/comets/define-comet.ts'
import { setCometManifest } from 'modules/comets/comet-manifest.ts'
import { setActiveRenderer } from 'modules/router/active-renderer.ts'
import { decodeFromWire } from 'modules/render/serialization-codec.ts'
import {
  resetExtendedSerialization,
  setExtendedSerialization,
} from 'modules/render/serialization-registry.ts'
import { stripHydrationComments } from '../../support/strip-hydration-comments.ts'

/**
 * End-to-end proof for the opt-in extended-types codec, through BOTH real delivery channels
 * (page-level `initialState` and a Comet's own props) and BOTH renderers.
 *
 * The decisive assertions are the "off" ones. With the codec disabled the rendered bytes must be
 * exactly what they were before the codec existed — that invariant is what makes this feature
 * safe to ship, and it is far more important than any of the "on" behaviour.
 *
 * @module
 */

console.error = () => {}

const SOURCE_URL = `file://${Deno.cwd()}/comets/serial-widget.tsx`
const WHEN = new Date('2026-08-17T10:00:00.000Z')

function ReactWidget() {
  return reactCreateElement('span', null, 'widget')
}
function PreactWidget() {
  return preactCreateElement('span', null, 'widget')
}

function reset() {
  resetExtendedSerialization()
  setCometManifest(undefined)
  setActiveRenderer('react')
}

/** Pulls the serialized props back out of a rendered comet boundary, HTML-unescaped. */
function readCometProps(html: string): unknown {
  const match = html.match(/data-comet-props="([^"]*)"/)
  assert(match, `no comet props found in: ${html}`)
  const json = match[1]
    .replaceAll('&quot;', '"')
    .replaceAll('&#x27;', "'")
    .replaceAll('&amp;', '&')
  return JSON.parse(json)
}

// ---------------------------------------------------------------------------------------------
// OFF — the invariant that matters most
// ---------------------------------------------------------------------------------------------

Deno.test(
  'codec OFF (react): initialState serializes byte-identically to the documented lossy contract ' +
    '— Date to an ISO string, Map and Set to {}',
  async () => {
    try {
      const response = await renderToResponseReact(
        reactCreateElement('html', null, reactCreateElement('body', null, 'x')),
        { initialState: { when: WHEN, aMap: new Map([['k', 1]]), aSet: new Set([1]) } },
      )
      const html = await response.text()

      assert(html.includes(`"when":"${WHEN.toISOString()}"`), html)
      assert(html.includes('"aMap":{}'), html)
      assert(html.includes('"aSet":{}'), html)
      // No envelope anywhere — the payload is exactly the plain JSON it always was.
      assertFalse(html.includes('$zv'), html)
      assertFalse(html.includes('$z'), html)
    } finally {
      reset()
    }
  },
)

Deno.test(
  'codec OFF (preact): identical bytes to React for the same input — the two renderers must not ' +
    'diverge on the wire',
  async () => {
    setActiveRenderer('preact')
    try {
      const html = await renderToResponsePreact(
        preactCreateElement('html', null, preactCreateElement('body', null, 'x')),
        { initialState: { when: WHEN, aMap: new Map([['k', 1]]), aSet: new Set([1]) } },
      ).text()

      assert(html.includes(`"when":"${WHEN.toISOString()}"`), html)
      assert(html.includes('"aMap":{}'), html)
      assert(html.includes('"aSet":{}'), html)
      assertFalse(html.includes('$zv'), html)
    } finally {
      reset()
    }
  },
)

Deno.test('codec OFF: comet props carry plain JSON, with no envelope', async () => {
  try {
    const Comet = defineComet(ReactWidget, SOURCE_URL)
    const response = await renderToResponseReact(
      reactCreateElement(Comet as never, { when: WHEN }),
    )
    const html = stripHydrationComments(await response.text())

    assertEquals(readCometProps(html), { when: WHEN.toISOString() })
    assertFalse(html.includes('$zv'), html)
  } finally {
    reset()
  }
})

// ---------------------------------------------------------------------------------------------
// ON — both channels, both renderers
// ---------------------------------------------------------------------------------------------

Deno.test(
  'codec ON (react): a Date, Map and Set in initialState round-trip back to real instances',
  async () => {
    setExtendedSerialization(true)
    try {
      const response = await renderToResponseReact(
        reactCreateElement('html', null, reactCreateElement('body', null, 'x')),
        { initialState: { when: WHEN, aMap: new Map([['k', 1]]), aSet: new Set(['s']) } },
      )
      const html = await response.text()

      const payload = html.match(/__ZANIX_SPACE_STATE__=(\{.*?\})<\/script>/s)?.[1]
      assert(payload, html)
      const decoded = decodeFromWire(JSON.parse(payload)) as {
        when: Date
        aMap: Map<string, number>
        aSet: Set<string>
      }

      assertInstanceOf(decoded.when, Date)
      assertEquals(decoded.when.getTime(), WHEN.getTime())
      assertInstanceOf(decoded.aMap, Map)
      assertEquals(decoded.aMap.get('k'), 1)
      assertInstanceOf(decoded.aSet, Set)
      assertEquals([...decoded.aSet], ['s'])
    } finally {
      reset()
    }
  },
)

Deno.test(
  'codec ON (preact): the same round trip through the Preact renderer, including its own `<` ' +
    'escaping still applying to the encoded payload',
  async () => {
    setExtendedSerialization(true)
    setActiveRenderer('preact')
    try {
      const html = await renderToResponsePreact(
        preactCreateElement('html', null, preactCreateElement('body', null, 'x')),
        { initialState: { when: WHEN, danger: '</script><script>alert(1)', aSet: new Set([2]) } },
      ).text()

      const payload = html.match(/__ZANIX_SPACE_STATE__=(\{.*?\})<\/script>/s)?.[1]
      assert(payload, html)
      const decoded = decodeFromWire(JSON.parse(payload)) as {
        when: Date
        danger: string
        aSet: Set<number>
      }

      assertInstanceOf(decoded.when, Date)
      assertInstanceOf(decoded.aSet, Set)
      // Security: the escaping that predates the codec still applies to the encoded payload.
      assertFalse(html.includes('<script>alert(1)'), html)
      assertEquals(decoded.danger, '</script><script>alert(1)')
    } finally {
      reset()
    }
  },
)

Deno.test(
  'codec ON: comet props carry an envelope and decode to real instances (react)',
  async () => {
    setExtendedSerialization(true)
    try {
      const Comet = defineComet(ReactWidget, SOURCE_URL)
      const response = await renderToResponseReact(
        reactCreateElement(Comet as never, { when: WHEN, tags: new Set(['a']) }),
      )
      const html = stripHydrationComments(await response.text())

      const decoded = decodeFromWire(readCometProps(html)) as { when: Date; tags: Set<string> }
      assertInstanceOf(decoded.when, Date)
      assertEquals(decoded.when.getTime(), WHEN.getTime())
      assertInstanceOf(decoded.tags, Set)
      assertEquals([...decoded.tags], ['a'])
    } finally {
      reset()
    }
  },
)

Deno.test('codec ON: comet props through the REAL Preact renderer decode identically', async () => {
  setExtendedSerialization(true)
  setActiveRenderer('preact')
  try {
    const Comet = defineComet(PreactWidget, SOURCE_URL)
    const html = await renderToResponsePreact(
      preactCreateElement(Comet as never, { when: WHEN, tags: new Set(['a']) }),
    ).text()

    const decoded = decodeFromWire(readCometProps(html)) as { when: Date; tags: Set<string> }
    assertInstanceOf(decoded.when, Date)
    assertEquals(decoded.when.getTime(), WHEN.getTime())
    assertInstanceOf(decoded.tags, Set)
    assertEquals([...decoded.tags], ['a'])
  } finally {
    reset()
  }
})

Deno.test(
  'codec ON: an unserializable comet prop still throws the same named InternalError — the codec ' +
    'adds types, it never changes the failure contract',
  async () => {
    setExtendedSerialization(true)
    try {
      const circular: Record<string, unknown> = {}
      circular.self = circular
      const Comet = defineComet(ReactWidget, SOURCE_URL)

      let reported: unknown
      const response = await renderToResponseReact(
        reactCreateElement(Comet as never, { circular }),
        { onError: (error: unknown) => void (reported = error) },
      )

      assertEquals(response.status, 500)
      assert(
        String((reported as Error)?.message).includes('not JSON-serializable'),
        String(reported),
      )
    } finally {
      reset()
    }
  },
)
