import { assert, assertEquals, assertFalse } from '@std/assert'
import { createElement } from 'preact'
import { renderToResponse } from 'modules/render/render-to-response-preact.ts'

Deno.test('renderToResponse (preact): renders real Preact SSR output, no streaming', async () => {
  const element = createElement('h1', null, 'hello preact')
  const response = renderToResponse(element)

  assertEquals(response.status, 200)
  assertEquals(
    response.headers.get('content-type'),
    'text/html; charset=utf-8',
  )
  const html = await response.text()
  assertEquals(html, '<h1>hello preact</h1>')
})

Deno.test('renderToResponse (preact): doctype only when explicitly requested', async () => {
  const fragment = createElement('div', null, 'fragment')
  const fragmentHtml = await renderToResponse(fragment).text()
  assertFalse(fragmentHtml.startsWith('<!doctype'))

  const doc = createElement('html', null, createElement('body', null, 'doc'))
  const docHtml = await renderToResponse(doc, { doctype: true }).text()
  assert(docHtml.startsWith('<!doctype html>'))
})

Deno.test('renderToResponse (preact): initialState + bootstrapModules inject scripts', async () => {
  const doc = createElement(
    'html',
    null,
    createElement('body', null, createElement('p', null, 'x')),
  )
  const html = await renderToResponse(doc, {
    initialState: { hello: 'world' },
    bootstrapModules: ['/client/entry.js'],
    doctype: true,
  }).text()

  assert(html.includes('self.__ZANIX_SPACE_STATE__={"hello":"world"}'), html)
  assert(html.includes('<script type="module" src="/client/entry.js">'), html)
  // Both scripts land BEFORE </body>, not appended after </html> — real HTML placement.
  const bodyCloseIndex = html.indexOf('</body>')
  const scriptIndex = html.indexOf('__ZANIX_SPACE_STATE__')
  assert(
    scriptIndex < bodyCloseIndex,
    'initial-state script must be inside <body>',
  )
})

Deno.test(
  'renderToResponse (preact): devClient injects buildDevClientScript output, no separate preamble',
  async () => {
    const doc = createElement('html', null, createElement('body', null, 'x'))
    const html = await renderToResponse(doc, {
      doctype: true,
      devClient: { routeFilePath: '/routes/products/page.tsx' },
    }).text()

    // Real, unmodified `buildDevClientScript` output — same function React's own `renderToResponse`
    // reuses, confirming the transport itself is genuinely shared, not reimplemented.
    assert(html.includes('/socket/'), html)
    assert(html.includes(JSON.stringify('/routes/products/page.tsx')), html)
    // No preamble script — unlike React, Preact needs none (see `RenderToResponsePreactOptions`'s
    // own doc): confirms this stays a single injected `<script>`, not two.
    assertEquals((html.match(/<script/g) ?? []).length, 1, html)
    const bodyCloseIndex = html.indexOf('</body>')
    const scriptIndex = html.indexOf('/socket/')
    assert(
      scriptIndex < bodyCloseIndex,
      'dev client script must be inside <body>',
    )
  },
)

Deno.test('renderToResponse (preact): no devClient means no dev script at all', async () => {
  const doc = createElement('html', null, createElement('body', null, 'x'))
  const html = await renderToResponse(doc, { doctype: true }).text()

  assertFalse(html.includes('<script'), html)
})

Deno.test('renderToResponse (preact): a render error resolves 500, never throws', async () => {
  function Boom(): never {
    throw new Error('real preact render error')
  }
  let captured: unknown
  const response = renderToResponse(createElement(Boom, null), {
    onError: (error) => {
      captured = error
    },
  })
  assertEquals(response.status, 500)
  assertEquals(await response.text(), '')
  assert(captured instanceof Error)
  assertEquals((captured as Error).message, 'real preact render error')
})

Deno.test(
  'renderToResponse (preact): a circular initialState resolves 500 and calls onError — same ' +
    'documented serialization-failure path as React, never an uncaught throw ' +
    '(initial-state-global.ts)',
  async () => {
    // deno-lint-ignore no-explicit-any
    const circular: any = { a: 1 }
    circular.self = circular

    let reported: unknown
    const response = renderToResponse(createElement('h1', null, 'x'), {
      initialState: circular,
      onError: (error) => {
        reported = error
      },
    })

    assertEquals(response.status, 500)
    assertEquals(await response.text(), '')
    assert(reported instanceof Error, String(reported))
  },
)

Deno.test(
  'renderToResponse (preact): a BigInt anywhere inside initialState also resolves 500 — same ' +
    "handling as a circular reference, matching React's own equivalent behavior " +
    '(initial-state-global.ts)',
  () => {
    let reported: unknown
    const response = renderToResponse(createElement('h1', null, 'x'), {
      initialState: { big: 1n },
      onError: (error) => {
        reported = error
      },
    })

    assertEquals(response.status, 500)
    assert(reported instanceof Error, String(reported))
  },
)

Deno.test(
  'renderToResponse (preact): initialState degrades undefined/functions/Date/Map/Set exactly ' +
    "as documented (initial-state-global.ts) — same observable contract as React's own copy",
  async () => {
    const fixedDate = new Date('2024-01-01T00:00:00.000Z')
    const doc = createElement('html', null, createElement('body', null, 'x'))
    const html = await renderToResponse(doc, {
      doctype: true,
      initialState: {
        omittedUndefined: undefined,
        omittedFunction: () => {},
        arrayWithUndefined: [1, undefined, 3],
        arrayWithFunction: [1, () => {}, 3],
        when: fixedDate,
        aMap: new Map([['a', 1]]),
        aSet: new Set([1, 2, 3]),
      },
    }).text()

    const marker = 'self.__ZANIX_SPACE_STATE__='
    const start = html.indexOf(marker)
    assert(start !== -1, html)
    const end = html.indexOf('</script>', start)
    const serialized = html.slice(start + marker.length, end)

    assertEquals(
      serialized,
      '{"arrayWithUndefined":[1,null,3],"arrayWithFunction":[1,null,3],' +
        `"when":"${fixedDate.toISOString()}","aMap":{},"aSet":{}}`,
    )
  },
)

Deno.test(
  'renderToResponse (preact): initialState containing </script> cannot break out of its own ' +
    'script tag, Etapa 4 hardening (real gap found: React escapes this internally, this hand-built ' +
    'tag did not)',
  async () => {
    const doc = createElement('html', null, createElement('body', null, 'x'))
    const html = await renderToResponse(doc, {
      doctype: true,
      initialState: { evil: '</script><script>alert(1)</script>' },
    }).text()

    // The ONLY `</script>` in the whole document must be the initial-state script's own real
    // closing tag — a naive implementation would emit the attacker's literal `</script>` too,
    // closing the script early and leaving `<script>alert(1)</script>` as real, executable markup.
    const scriptCloseCount = (html.match(/<\/script>/g) ?? []).length
    assertEquals(scriptCloseCount, 1, html)
    assert(!html.includes('<script>alert(1)'), html)

    // The escaped payload must still be real, valid JS that decodes back to the original string at
    // runtime — `<` is standard JS string-literal syntax for `<`, so `eval`/`new Function`
    // parses it exactly like a literal `<` would, proving this is a real encoding round-trip, not
    // just "doesn't look dangerous as a string".
    const scriptBody = html.match(/<script>(self\.\w+=.*?)<\/script>/)?.[1]
    assert(scriptBody, html)
    const fakeSelf: Record<string, unknown> = {}
    new Function('self', scriptBody)(fakeSelf)
    const [globalKey] = Object.keys(fakeSelf)
    assertEquals(fakeSelf[globalKey], {
      evil: '</script><script>alert(1)</script>',
    })
  },
)
