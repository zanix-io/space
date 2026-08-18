import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { buildDevClientScript, SPACE_DEV_SOCKET_ROUTE } from 'modules/dev/mod.ts'

/** A fake `WebSocket` connection, as far as the generated script needs one: records the URL it
 * was opened with, captures its `onmessage` assignment, and exposes `trigger(data)` to simulate
 * an incoming message — lets the script's real `onmessage` handler run against real (fake) input,
 * not just be inspected as a string. */
class FakeSocket {
  public url: string
  public onmessage: ((event: { data: string }) => void) | null = null
  constructor(url: string) {
    this.url = url
  }
  public trigger(data: string): void {
    this.onmessage?.({ data })
  }
}

/** A fake `<link rel="stylesheet">` element — only what `handleClientCssChanged` touches. */
class FakeLinkElement {
  #href: string
  constructor(href: string) {
    this.#href = href
  }
  public getAttribute(name: string): string | null {
    return name === 'href' ? this.#href : null
  }
  public set href(value: string) {
    this.#href = value
  }
  public get href(): string {
    return this.#href
  }
}

/** A fake `document` exposing only `querySelectorAll('link[rel="stylesheet"]')`, backed by a
 * plain array of {@linkcode FakeLinkElement} so a test can assert on each one's own `href` after
 * the script runs. */
function fakeDocument(hrefs: string[]) {
  const links = hrefs.map((href) => new FakeLinkElement(href))
  return {
    links,
    document: {
      querySelectorAll: (selector: string) => selector === 'link[rel="stylesheet"]' ? links : [],
    },
  }
}

/** Runs `buildDevClientScript`'s real output against fake `WebSocket`/`location`/`document`
 * globals — the script is a self-executing IIFE with no return value, so the only way to reach
 * the socket instance it created is to capture it as a side effect of the fake constructor itself.
 *
 * `spaceApplyClientUpdate`, when given, is passed as a real bare-identifier function parameter to
 * `new Function` — same technique as `WebSocket`/`location`/`document`, and the reason
 * `handleClientModuleChanged` itself references a bare `__spaceApplyClientUpdate`, never
 * `window.__spaceApplyClientUpdate` (see that function's own comment in `dev-client-script.ts`):
 * Deno's own global scope has no real `window` object at all (confirmed: `typeof window ===
 * 'undefined'` under `deno test`), so a `window.`-qualified reference would throw here even though
 * it works fine in a real browser. Omitted entirely (not even declared as a parameter) for a test
 * that wants to exercise the "never registered" no-op path exactly as a real React page would hit
 * it today — `typeof __spaceApplyClientUpdate` on a truly undeclared identifier still safely
 * evaluates to `'undefined'`, never throws. */
function runDevClientScript(
  options: Parameters<typeof buildDevClientScript>[0],
  location: { protocol: string; host: string },
  stylesheetHrefs: string[] = [],
  spaceApplyClientUpdate: ((url: string) => void) | undefined = undefined,
) {
  let socket: FakeSocket | undefined
  let reloaded = false
  const FakeWebSocket = function (this: FakeSocket, url: string) {
    socket = new FakeSocket(url)
    return socket
  } as unknown as typeof WebSocket

  const { document, links } = fakeDocument(stylesheetHrefs)

  const params = ['WebSocket', 'location', 'document']
  const args: unknown[] = [
    FakeWebSocket,
    { ...location, reload: () => (reloaded = true) },
    document,
  ]
  if (spaceApplyClientUpdate) {
    params.push('__spaceApplyClientUpdate')
    args.push(spaceApplyClientUpdate)
  }
  const run = new Function(...params, buildDevClientScript(options))
  run(...args)

  if (!socket) throw new Error('buildDevClientScript never opened a WebSocket')

  return {
    socket,
    links,
    get reloaded() {
      return reloaded
    },
  }
}

const httpLocation = { protocol: 'http:', host: 'localhost:3000' }

Deno.test('buildDevClientScript: produces syntactically valid JavaScript', () => {
  // `new Function` parses `source` as a function body — throws SyntaxError on malformed JS,
  // without needing a real browser to actually run it. Same technique `buildServiceWorkerSource`
  // already uses.
  new Function(buildDevClientScript())
  new Function(
    buildDevClientScript({ routeFilePath: '/routes/products/page.tsx' }),
  )
})

Deno.test('buildDevClientScript: connects to the reserved socket route, same-origin', () => {
  const { socket } = runDevClientScript({}, httpLocation)

  assertEquals(
    socket.url,
    `ws://localhost:3000/socket/${SPACE_DEV_SOCKET_ROUTE}`,
  )
})

Deno.test('buildDevClientScript: uses wss:// when the page itself is https:', () => {
  const { socket } = runDevClientScript({}, {
    protocol: 'https:',
    host: 'example.com',
  })

  assertEquals(
    socket.url,
    `wss://example.com/socket/${SPACE_DEV_SOCKET_ROUTE}`,
  )
})

Deno.test('buildDevClientScript: a malformed message is ignored, not thrown', () => {
  const { socket, reloaded } = runDevClientScript({}, httpLocation)

  socket.trigger('not json')
  assert(!reloaded)
})

Deno.test('buildDevClientScript: ignores a message whose kind is not ssr-module-changed', () => {
  const run = runDevClientScript({}, httpLocation)

  run.socket.trigger(JSON.stringify({ kind: 'something-else' }))
  assert(!run.reloaded)
})

Deno.test('buildDevClientScript: no routeFilePath reloads on any matching message', () => {
  const run = runDevClientScript({}, httpLocation)

  run.socket.trigger(
    JSON.stringify({
      kind: 'ssr-module-changed',
      affectedRoutes: ['/routes/unrelated/page.tsx'],
    }),
  )
  assert(run.reloaded)
})

Deno.test(
  'buildDevClientScript: with a routeFilePath, only reloads when it is in affectedRoutes',
  () => {
    const run = runDevClientScript({
      routeFilePath: '/routes/products/page.tsx',
    }, httpLocation)

    run.socket.trigger(
      JSON.stringify({
        kind: 'ssr-module-changed',
        affectedRoutes: ['/routes/unrelated/page.tsx'],
      }),
    )
    assert(!run.reloaded, 'must not reload for a change to a DIFFERENT route')

    run.socket.trigger(
      JSON.stringify({
        kind: 'ssr-module-changed',
        affectedRoutes: ['/routes/products/page.tsx'],
      }),
    )
    assert(run.reloaded, 'must reload once ITS OWN route is affected')
  },
)

Deno.test('buildDevClientScript: embeds the given routeFilePath verbatim', () => {
  const source = buildDevClientScript({
    routeFilePath: '/routes/products/page.tsx',
  })

  assertStringIncludes(source, JSON.stringify('/routes/products/page.tsx'))
})

Deno.test(
  'buildDevClientScript: client-css-changed swaps only the matching stylesheet href, no reload',
  () => {
    const run = runDevClientScript({}, httpLocation, [
      '/app.css?direct',
      '/other.css?direct',
    ])

    run.socket.trigger(
      JSON.stringify({ kind: 'client-css-changed', urls: ['/app.css?direct'] }),
    )

    assert(!run.reloaded, 'a CSS change must never trigger a full page reload')
    assert(
      /^\/app\.css\?direct&t=\d+$/.test(run.links[0].href),
      `expected a fresh cache-busted href, got '${run.links[0].href}'`,
    )
    assertEquals(
      run.links[1].href,
      '/other.css?direct',
      'an unrelated stylesheet must be untouched',
    )
  },
)

Deno.test('buildDevClientScript: client-css-changed ignores a url with no matching link', () => {
  const run = runDevClientScript({}, httpLocation, ['/app.css?direct'])

  run.socket.trigger(
    JSON.stringify({
      kind: 'client-css-changed',
      urls: ['/unrelated.css?direct'],
    }),
  )

  assertEquals(run.links[0].href, '/app.css?direct')
  assert(!run.reloaded)
})

Deno.test(
  'buildDevClientScript: client-module-changed forwards each url to __spaceApplyClientUpdate',
  () => {
    const applied: string[] = []
    const run = runDevClientScript(
      {},
      httpLocation,
      [],
      (url) => applied.push(url),
    )

    run.socket.trigger(
      JSON.stringify({
        kind: 'client-module-changed',
        urls: ['/comets/counter.tsx'],
      }),
    )

    assertEquals(applied, ['/comets/counter.tsx'])
    assert(
      !run.reloaded,
      'a client module change must never trigger a full page reload',
    )
  },
)

Deno.test(
  'buildDevClientScript: client-module-changed is a silent no-op when __spaceApplyClientUpdate ' +
    'was never declared (a page whose orchestrator has not yet served dev-vite-hot-client.ts)',
  () => {
    // No `spaceApplyClientUpdate` argument at all here — `__spaceApplyClientUpdate` stays a truly
    // undeclared identifier for the executed script, exactly like a page whose orchestrator hasn't
    // wired `createViteHotClientHandler()` yet. Must not throw.
    const run = runDevClientScript({}, httpLocation)

    run.socket.trigger(
      JSON.stringify({
        kind: 'client-module-changed',
        urls: ['/comets/counter.tsx'],
      }),
    )

    assert(!run.reloaded)
  },
)
