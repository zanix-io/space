import { assert, assertEquals } from '@std/assert'
import { bootstrapServers, webServerManager } from '@zanix/server'
import { loadRoutes } from 'modules/router/mod.ts'
import StreamingTtfbFixturePage, {
  releaseStreamingGate,
} from '../../support/fixtures/streaming-ttfb-routes/page.tsx'

// Static import above resolves to the exact same module instance `loadRoutes()` itself imports
// (same pattern already established in `page-composition.test.tsx`) — so `releaseStreamingGate`
// controls the very promise the route's own component suspends on.
void StreamingTtfbFixturePage

/** Bounds a single body `read()` — a bare `reader.read()` blocks forever when no chunk arrives, so
 * a loop's own deadline check between reads never gets a chance to run. */
const readWithTimeout = async (
  reader: ReadableStreamDefaultReader<Uint8Array>,
  ms: number,
  what: string,
) => {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`timed out after ${ms}ms waiting for ${what}`)),
          ms,
        )
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Real time-to-first-byte verification for Space's own SSR pipeline (not `@zanix/server`'s
 * lower-level gzip-streaming test, which proves the same property one layer down with a raw,
 * hand-written `ReadableStream` — see `gzip-ssr-streaming.test.ts` there). This exercises the
 * actual `SpacePageController` → `composeSegments` → React `renderToReadableStream` path with a
 * real `Suspense`/`loading.tsx` boundary, over a real socket via `bootstrapServers` + `fetch`.
 *
 * `page-composition.test.tsx`'s existing loading.tsx test already proves `handleGet()` itself
 * resolves fast — but that only proves a `Response` wrapping a pending stream comes back quickly,
 * not that bytes actually cross the wire before the render finishes. This test proves the stronger,
 * literal claim `§7` of the roadmap asks for: a real body-reader `read()` returns bytes — the
 * fallback shell — before the suspended promise ever settles, which would be impossible if
 * anything in Space's own response pipeline (headers, security guards, ETag, gzip) buffered the
 * whole render first.
 */
Deno.test(
  'streaming TTFB: a real fetch() over the wire receives the loading.tsx fallback shell before the suspended component resolves, and the final body still has the correct resolved content',
  async () => {
    await loadRoutes('src/@tests/support/fixtures/streaming-ttfb-routes')

    const servers = await bootstrapServers({ ssr: { port: 20810 } })
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined

    try {
      const fetchPromise = fetch(
        'http://localhost:20810/streaming-ttfb-fixture',
      )

      // Same race technique as `@zanix/server`'s own gzip-streaming test: if anything buffered the
      // whole render first, `fetch()` itself would never resolve while the gate is held, since
      // `Deno.serve` can't send a response until the handler chain returns one.
      const outcome = await Promise.race([
        fetchPromise.then(() => 'resolved' as const),
        new Promise<'timed-out'>((resolve) => setTimeout(() => resolve('timed-out'), 10_000)),
      ])
      assertEquals(
        outcome,
        'resolved',
        'fetch() should resolve (response headers received) before the suspended component ' +
          'settles — a timeout here means Space is buffering the whole render before responding',
      )

      const res = await fetchPromise
      assertEquals(res.headers.get('content-length'), null) // streamed — no known length upfront
      assert(res.body, 'the response should carry a real streamed body')

      reader = res.body.getReader()
      const decoder = new TextDecoder()
      let received = ''
      // Pull chunks until the fallback shell shows up, or give up — proves actual bytes (not just
      // headers) reach the client before the gate is released below.
      const deadline = performance.now() + 10_000
      while (!received.includes('fixture-loading') && performance.now() < deadline) {
        // deno-lint-ignore no-await-in-loop -- this loop IS the read, each call depends on the last
        const { value, done } = await readWithTimeout(
          reader,
          10_000,
          'the loading.tsx fallback chunk',
        )
        if (done) break
        received += decoder.decode(value, { stream: true })
      }
      assert(
        received.includes('fixture-loading'),
        `expected the loading.tsx fallback to have streamed in before the gate was released, got: ${received}`,
      )
      assert(
        !received.includes('fixture-resolved'),
        `the resolved content should not have streamed in yet — the gate is still held: ${received}`,
      )

      // Only now let the suspended component settle, and verify the eventual full body is still
      // correct — streaming must not come at the cost of correctness.
      releaseStreamingGate()
      while (true) {
        // deno-lint-ignore no-await-in-loop -- same reason as above
        const { value, done } = await readWithTimeout(reader, 5000, 'the resolved body')
        if (done) break
        received += decoder.decode(value, { stream: true })
      }
      assert(received.includes('data-testid="fixture-resolved"'), received)
      assert(received.includes('resolved-content'), received)
    } finally {
      // On any failure above the gate is still held and the response body still open — and a
      // graceful `stop()` waits on in-flight requests forever, which would hide the real failure
      // behind a hung test. Settle the suspended render and drop the body first.
      releaseStreamingGate()
      await reader?.cancel().catch(() => {})
      await webServerManager.stop(servers)
    }
  },
)
