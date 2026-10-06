import '../../../../mod-react.ts'
import { assert, assertFalse } from '@std/assert'
import { SpacePageController } from 'modules/router/mod.ts'
import { ORBIT_FRAGMENT_HEADER } from 'modules/router/orbit-protocol.ts'
import { mockHandlerContext } from 'modules/testing/mod.ts'

/**
 * Gates the test below: it drives a real Chromium, which the CI job does not install. Run it with
 * `RUN_BROWSER_TESTS=true deno test --allow-all <this file>` before publishing a change to
 * `handleGet`, the `ETag`, Orbit or its prefetch. `SPACE_BENCH_CHROMIUM` points at a browser
 * executable (the benchmark's own variable); without it Playwright resolves its own install.
 */
const shouldRun = Deno.env.get('RUN_BROWSER_TESTS') === 'true'

// Resolved only when the test runs, so a run that skips it never loads Playwright.
const PLAYWRIGHT_SPECIFIER = 'npm:playwright-core@1.62.1'

const PORT = 20993
const ORIGIN = `http://localhost:${PORT}`

class CachedPage extends SpacePageController {
  public static override cacheControl = 'private, no-cache'
  public override component = () => <p id='marker'>hello</p>
  public override loader = () => ({ value: 1 })
}

/** The call `schedulePrefetch` and `swapOutlet` make: the browser's own HTTP cache does the rest. */
const isFragment = (text: string) =>
  text.startsWith('<div data-space-outlet') && !text.includes('<html')

/**
 * The browser keeps one stored entry per URL, so the order in which a URL is requested as a
 * document and as an Orbit fragment decides which validator the next request sends. These cases
 * pin that a validator stored for one shape never makes the server answer `304` for the other (a
 * `304` that renders the fragment as a page, or hands Orbit a whole document as a fragment), and
 * that a repeated fragment request still revalidates.
 */
Deno.test(
  'Orbit ETag variants in a real browser: a stored validator never crosses between the document and the fragment',
  { ignore: !shouldRun },
  async (t) => {
    const { chromium } = await import(PLAYWRIGHT_SPECIFIER)
    const requests: string[] = []
    const server = Deno.serve({ port: PORT, onListen() {} }, async (req) => {
      const ctx = mockHandlerContext({ req })
      const res = await new CachedPage(ctx).handleGet(ctx)
      requests.push(
        `${new URL(req.url).pathname} ${
          req.headers.has(ORBIT_FRAGMENT_HEADER) ? 'fragment' : 'document'
        } ` +
          `${req.headers.has('if-none-match') ? 'conditional' : 'unconditional'} -> ${res.status}`,
      )
      return res
    })
    const executablePath = Deno.env.get('SPACE_BENCH_CHROMIUM')
    const browser = await chromium.launch(executablePath ? { executablePath } : {})
    try {
      const page = await browser.newPage()
      const fetchFragment = (path: string): Promise<string> =>
        page.evaluate(
          ([url, header]: string[]) =>
            fetch(url, { headers: { [header]: '1' } }).then((response) => response.text()),
          [path, ORBIT_FRAGMENT_HEADER],
        )
      const documentShell = () =>
        page.evaluate(() => ({
          doctype: !!document.doctype,
          charset: document.querySelectorAll('meta[charset]').length,
        }))
      const assertFullDocument = async (message: string) => {
        const shell = await documentShell()
        assert(shell.doctype && shell.charset === 1, `${message}: ${JSON.stringify(shell)}`)
      }

      await t.step('a repeated fragment request still revalidates with a 304', async () => {
        await page.goto(`${ORIGIN}/start`)
        requests.length = 0
        assert(isFragment(await fetchFragment('/repeat')))
        assert(isFragment(await fetchFragment('/repeat')), 'the repeat must still be a fragment')
        assert(
          requests.some((r) => r === '/repeat fragment conditional -> 304'),
          `expected a conditional fragment request answered 304, saw ${requests.join(' | ')}`,
        )
      })

      await t.step('a fragment request for a stored document gets a fragment', async () => {
        await page.goto(`${ORIGIN}/document-first`)
        const body = await fetchFragment('/document-first')
        assert(isFragment(body), 'a stored document must not be handed back as the fragment')
      })

      await t.step('a full navigation after a fragment request is a full document', async () => {
        await page.goto(`${ORIGIN}/start`)
        await fetchFragment('/fragment-first')
        await page.goto(`${ORIGIN}/fragment-first`)
        await assertFullDocument('the fragment was rendered as the page')
      })

      await t.step('a reload after a fragment request is a full document', async () => {
        await page.goto(`${ORIGIN}/reload`)
        await fetchFragment('/reload')
        await page.reload()
        await assertFullDocument('the fragment was rendered after a reload')
      })

      await t.step(
        'back and forward across a fragment-fetched URL is a full document',
        async () => {
          await page.goto(`${ORIGIN}/history-a`)
          assert(isFragment(await fetchFragment('/history-b')))
          await page.goto(`${ORIGIN}/history-b`)
          await page.goBack()
          await page.goForward()
          await assertFullDocument('history navigation rendered the fragment')
        },
      )

      assertFalse(requests.length === 0, 'the server saw no requests')
    } finally {
      await browser.close()
      await server.shutdown()
    }
  },
)
