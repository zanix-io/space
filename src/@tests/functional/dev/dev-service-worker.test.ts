import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { bootstrapServers, webServerManager } from '@zanix/server'
import { getTemporaryFolder } from '@zanix/helpers'
// Imported from the specific file, not the `modules/bundler/mod.ts` barrel: see
// `dev-asset-handler.test.ts` for the `lightningcss` pitfall the barrel carries.
import { createSpaceDevEngine } from 'modules/bundler/dev-engine.ts'
import { createDevAssetHandler } from 'modules/dev/mod.ts'
import { langPreHandler } from 'modules/middleware/lang-pre-handler.ts'
import { registerPwa } from 'modules/pwa/register-pwa.ts'
import { setPwaBuildOutput } from 'modules/pwa/pwa-registry.ts'
import { MANIFEST_ROUTE, SW_ROUTE } from 'modules/pwa/web-manifest.ts'

const PORT = 20911
const ORIGIN = `http://localhost:${PORT}`

/**
 * The composition `zanix space dev` puts in front of the route table, with the real Vite dev engine:
 * the dev asset handler first, then the app's own `preHandler` (a language redirect here, the one a
 * real app registers), then the route table. Each piece has its own tests; this one exists because
 * a piece can be right alone and wrong in front of the others. `/sw.js` ends in `.js`, so it is
 * exactly the request a `.js` heuristic in the first handler could swallow.
 */
async function withDevServer(run: () => Promise<void>): Promise<void> {
  const root = await Deno.makeTempDir({ dir: getTemporaryFolder(import.meta.url) })
  const engine = await createSpaceDevEngine({ root, isRouteEntry: (id) => id.endsWith('page.tsx') })
  const devAssetHandler = createDevAssetHandler(engine)
  const userPreHandler = langPreHandler({ availableLangs: ['es', 'en'], defaultLang: 'es' })

  setPwaBuildOutput(undefined)
  registerPwa({
    name: 'Storefront',
    icon: './icon-source.png',
    push: { fallbackTitle: 'Storefront' },
  })

  const servers = await bootstrapServers({
    ssr: {
      port: PORT,
      preHandler: async (req, info) => await devAssetHandler(req) ?? userPreHandler(req, info),
    },
  })
  try {
    await run()
  } finally {
    await webServerManager.stop(servers)
    await engine.close()
    await Deno.remove(root, { recursive: true })
  }
}

/** What a browser sends when it registers a service worker. */
const WORKER_REQUEST = { 'sec-fetch-dest': 'serviceworker' }

// One server for the whole file: each engine and server binds fixed ports, and starting a second one
// while the first is still closing races on them.
Deno.test('dev server: the service worker and the manifest survive the whole dev composition', async (t) => {
  await withDevServer(async () => {
    await t.step('the generated service worker is served', async () => {
      const res = await fetch(`${ORIGIN}${SW_ROUTE}`, {
        headers: WORKER_REQUEST,
        redirect: 'manual',
      })

      // A redirect is not an option for a worker: a browser refuses a worker script behind one.
      assertEquals(res.status, 200)
      assertEquals(res.headers.get('content-type'), 'application/javascript')
      assertEquals(res.headers.get('cache-control'), 'no-cache')
      const source = await res.text()
      assertStringIncludes(source, "self.addEventListener('push'")
      assertStringIncludes(source, "self.addEventListener('notificationclick'")
      new Function(source)
    })

    await t.step('the manifest is served through the same composition', async () => {
      const res = await fetch(`${ORIGIN}${MANIFEST_ROUTE}`, { redirect: 'manual' })
      assertEquals(res.status, 200)
      assertEquals((await res.json()).name, 'Storefront')
    })

    await t.step('any other .js path is still answered by the asset handler', async () => {
      const paths = ['/assets/missing.js', '/nested/sw.js']
      const answers = await Promise.all(paths.map(async (path) => {
        const res = await fetch(`${ORIGIN}${path}`, { headers: { 'sec-fetch-dest': 'script' } })
        return [res.status, await res.text()]
      }))
      assertEquals(answers, [[404, 'Not found'], [404, 'Not found']])
    })
  })
})

Deno.test('dev server: the route served is the one every page registers', () => {
  // `register("/sw.js")` in every full-document response and the route above are the same string.
  assert(SW_ROUTE.startsWith('/'))
  assertEquals(SW_ROUTE, '/sw.js')
})
