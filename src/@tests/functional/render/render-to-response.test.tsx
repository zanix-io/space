import { Suspense } from 'react'
import { preconnect, preload } from 'react-dom'
import { assert, assertEquals, assertMatch } from '@std/assert'
import { renderToResponse } from '../../../../mod-react.ts'
import { stripHydrationComments } from '../../support/strip-hydration-comments.ts'

function Greeting({ name }: { name: string }) {
  return <p>Hello, {name}</p>
}

Deno.test('renderToResponse: renders the given element to a 200 text/html Response', async () => {
  const response = await renderToResponse(<Greeting name='Ana' />)

  assertEquals(response.status, 200)
  assertEquals(
    response.headers.get('content-type'),
    'text/html; charset=utf-8',
  )
  const html = await response.text()
  assertMatch(stripHydrationComments(html), /Hello, Ana/)
})

Deno.test('renderToResponse: injects initialState as a single inline script, once', async () => {
  const response = await renderToResponse(<Greeting name='Ana' />, {
    initialState: { user: { name: 'Ana' } },
  })

  const html = await response.text()
  const matches = [...html.matchAll(/__ZANIX_SPACE_STATE__/g)]
  assertEquals(
    matches.length,
    1,
    'the state global must appear exactly once in the document',
  )
  assertMatch(html, /__ZANIX_SPACE_STATE__=\{"user":\{"name":"Ana"\}\}/)
})

Deno.test(
  'renderToResponse: omits the state script entirely when initialState is not given',
  async () => {
    const response = await renderToResponse(<Greeting name='Ana' />)

    const html = await response.text()
    assert(!html.includes('__ZANIX_SPACE_STATE__'))
  },
)

Deno.test(
  'renderToResponse: cssHrefs renders a stylesheet link for each URL, hoisted into <head>',
  async () => {
    const response = await renderToResponse(
      <html lang='en'>
        <head />
        <body>
          <Greeting name='Ana' />
        </body>
      </html>,
      { cssHrefs: ['/assets/app-abc123.css', '/assets/vendor-def456.css'] },
    )

    const html = await response.text()
    const headContent = html.slice(
      html.indexOf('<head'),
      html.indexOf('</head>'),
    )
    assert(
      headContent.includes(
        '<link rel="stylesheet" href="/assets/app-abc123.css"',
      ),
      headContent,
    )
    assert(
      headContent.includes(
        '<link rel="stylesheet" href="/assets/vendor-def456.css"',
      ),
      headContent,
    )
  },
)

Deno.test(
  'renderToResponse: a {href, media} cssHrefs entry renders its media attribute; a plain string ' +
    'entry renders none at all (P2-12a)',
  async () => {
    const response = await renderToResponse(
      <html lang='en'>
        <head />
        <body>
          <Greeting name='Ana' />
        </body>
      </html>,
      {
        cssHrefs: [
          { href: '/assets/mobile-abc123.css', media: '(max-width: 599px)' },
          '/assets/app-abc123.css',
        ],
      },
    )

    const html = await response.text()
    const headContent = html.slice(html.indexOf('<head'), html.indexOf('</head>'))
    assert(
      headContent.includes(
        '<link rel="stylesheet" href="/assets/mobile-abc123.css" media="(max-width: 599px)"',
      ),
      headContent,
    )
    const appLinkMatch = headContent.match(/<link[^>]*href="\/assets\/app-abc123\.css"[^>]*>/)
    assert(appLinkMatch, headContent)
    assert(!appLinkMatch[0].includes('media='), appLinkMatch[0])
  },
)

Deno.test(
  'renderToResponse: pwaHead renders a manifest link + theme-color meta, hoisted into <head>',
  async () => {
    const response = await renderToResponse(
      <html lang='en'>
        <head />
        <body>
          <Greeting name='Ana' />
        </body>
      </html>,
      {
        pwaHead: {
          manifestHref: '/manifest.webmanifest',
          themeColor: '#2563eb',
        },
      },
    )

    const html = await response.text()
    const headContent = html.slice(
      html.indexOf('<head'),
      html.indexOf('</head>'),
    )
    assert(
      headContent.includes('<link rel="manifest" href="/manifest.webmanifest"'),
      headContent,
    )
    assert(
      headContent.includes('<meta name="theme-color" content="#2563eb"'),
      headContent,
    )
  },
)

Deno.test('renderToResponse: pwaHead without themeColor omits the theme-color meta', async () => {
  const response = await renderToResponse(
    <html lang='en'>
      <head />
      <body>
        <Greeting name='Ana' />
      </body>
    </html>,
    { pwaHead: { manifestHref: '/manifest.webmanifest' } },
  )

  const html = await response.text()
  assert(html.includes('rel="manifest"'), html)
  assert(!html.includes('theme-color'), html)
})

Deno.test(
  "renderToResponse: pwaHead.serviceWorkerHref renders a nonce'd registration script",
  async () => {
    const response = await renderToResponse(
      <html lang='en'>
        <head />
        <body>
          <Greeting name='Ana' />
        </body>
      </html>,
      {
        nonce: 'test-nonce-123',
        pwaHead: {
          manifestHref: '/manifest.webmanifest',
          serviceWorkerHref: '/sw.js',
        },
      },
    )

    const html = await response.text()
    assert(html.includes('nonce="test-nonce-123"'), html)
    assert(html.includes('navigator.serviceWorker.register("/sw.js")'), html)
  },
)

Deno.test(
  'renderToResponse: pwaHead without serviceWorkerHref omits the registration script entirely',
  async () => {
    const response = await renderToResponse(<Greeting name='Ana' />, {
      pwaHead: { manifestHref: '/manifest.webmanifest' },
    })

    const html = await response.text()
    assert(!html.includes('serviceWorker'), html)
  },
)

Deno.test('renderToResponse: omits every stylesheet link when cssHrefs is not given', async () => {
  const response = await renderToResponse(<Greeting name='Ana' />)

  const html = await response.text()
  assert(!html.includes('rel="stylesheet"'), html)
})

Deno.test(
  "renderToResponse: react-dom's own preload()/preconnect() resource hints survive this " +
    'wrapper and get flushed into <head> — the recommended way to preload a critical font ' +
    '(no framework-specific API needed for this)',
  async () => {
    function FontPreloadPage() {
      preload('/fonts/inter-var.woff2', {
        as: 'font',
        type: 'font/woff2',
        crossOrigin: 'anonymous',
      })
      preconnect('https://fonts.example.com')
      return (
        <html lang='en'>
          <head />
          <body>
            <Greeting name='Ana' />
          </body>
        </html>
      )
    }

    const response = await renderToResponse(<FontPreloadPage />)
    const html = await response.text()
    const headContent = html.slice(
      html.indexOf('<head'),
      html.indexOf('</head>'),
    )

    assert(
      headContent.includes(
        '<link rel="preload" href="/fonts/inter-var.woff2" as="font" crossorigin="" type="font/woff2"',
      ),
      headContent,
    )
    assert(
      headContent.includes(
        '<link rel="preconnect" href="https://fonts.example.com"',
      ),
    )
  },
)

Deno.test(
  'renderToResponse: a shell render error yields status 500 and calls onError',
  async () => {
    function Broken(): never {
      throw new Error('boom')
    }

    let reported: unknown
    const response = await renderToResponse(<Broken />, {
      onError: (error) => {
        reported = error
      },
    })

    assertEquals(response.status, 500)
    assert(reported instanceof Error && reported.message === 'boom')
  },
)

Deno.test(
  'renderToResponse: a circular initialState resolves 500 and calls onError — the documented ' +
    'serialization-failure path (initial-state-global.ts), never an uncaught throw',
  async () => {
    // deno-lint-ignore no-explicit-any
    const circular: any = { a: 1 }
    circular.self = circular

    let reported: unknown
    const response = await renderToResponse(<Greeting name='Ana' />, {
      initialState: circular,
      onError: (error) => {
        reported = error
      },
    })

    assertEquals(response.status, 500)
    assertEquals(await response.text(), '')
    assert(reported instanceof Error, String(reported))
    assertMatch((reported as Error).message, /circular/i)
  },
)

Deno.test(
  'renderToResponse: a BigInt anywhere inside initialState also resolves 500 — handled ' +
    'identically to a circular reference, neither is special-cased (initial-state-global.ts)',
  async () => {
    let reported: unknown
    const response = await renderToResponse(<Greeting name='Ana' />, {
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
  'renderToResponse: initialState degrades undefined/functions/Date/Map/Set exactly as ' +
    'documented (initial-state-global.ts), never throws',
  async () => {
    const fixedDate = new Date('2024-01-01T00:00:00.000Z')
    const response = await renderToResponse(<Greeting name='Ana' />, {
      initialState: {
        omittedUndefined: undefined,
        omittedFunction: () => {},
        arrayWithUndefined: [1, undefined, 3],
        arrayWithFunction: [1, () => {}, 3],
        when: fixedDate,
        aMap: new Map([['a', 1]]),
        aSet: new Set([1, 2, 3]),
      },
    })

    const html = await response.text()
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
  'renderToResponse: an error thrown inside a Suspense boundary still yields status 200',
  async () => {
    function Broken(): never {
      throw new Error('boom')
    }

    let reported: unknown
    const response = await renderToResponse(
      <Suspense fallback={<p>loading</p>}>
        <Broken />
      </Suspense>,
      { onError: (error) => (reported = error) },
    )

    // `onError` still fires here (React reports every error, recoverable or not) — what must NOT
    // happen is the response being demoted to 500 just because it fired. A synchronous throw
    // *outside* any Suspense boundary (the previous test, above) is the one case that's genuinely
    // fatal — see this function's own doc for why the boundary is what makes the difference, not
    // the presence of an error boundary by itself (React never even reaches one for a shell error).
    assertEquals(response.status, 200)
    assert(reported instanceof Error && reported.message === 'boom')
  },
)
