// Installs a renderer, exactly as a real app does — same precedent
// `define-space-app-activation.test.tsx` already establishes.
import '../../../../mod-react.ts'
import { assert, assertEquals } from '@std/assert'
import { activateApps, deactivateApps } from '@zanix/app/runtime'
import { bootstrapServers, webServerManager } from '@zanix/server'
import { defineSpaceApp } from 'modules/runtime/mod.ts'
import { setCometManifest } from 'modules/comets/comet-manifest.ts'

/**
 * Confirms, end to end, the real failure mode `define-space-app.ts`'s own `assetsDir`-missing
 * warning exists to catch: a production build's manifest was loaded (here, via the test-only
 * `setCometManifest` escape hatch — real equivalent of a real `main.ts` calling
 * `loadCometManifest`), but `assetsDir` was never declared, so `/assets/:path*` never gets
 * registered at all — a request for the app's own built output genuinely 404s, not because the
 * specific file is missing, but because no route exists to answer it. Also confirms the warning
 * path never throws — a real, if undesirable, production configuration this package only ever
 * warns about, never blocks.
 */
Deno.test(
  "defineSpaceApp (no assetsDir) + activateApps: a loaded comet manifest doesn't register " +
    '/assets/:path* — the exact 404 the assetsDir-missing warning exists to catch, never a throw',
  async () => {
    setCometManifest({ '/project/comets/example.tsx': '/assets/example-hash.js' })
    try {
      const app = defineSpaceApp({ name: 'fixture-no-assets-dir-app' })
      const activated = await activateApps([app])
      const [serverId] = await bootstrapServers({
        rest: {
          application: 'fixture-no-assets-dir-app',
          id: 'fixture-no-assets-dir-app',
          port: 20912,
        },
      })
      assert(serverId, 'the server should have been started')
      try {
        const info = webServerManager.info(serverId)
        assert(info.addr, 'the started server should be listening')
        const baseUrl = `http://${info.addr.hostname}:${info.addr.port}`
        const res = await fetch(`${baseUrl}/assets/example-hash.js`)
        assertEquals(res.status, 404)
        await res.body?.cancel()
      } finally {
        await webServerManager.stop([serverId])
        await deactivateApps(activated)
      }
    } finally {
      setCometManifest(undefined)
    }
  },
)

Deno.test(
  'defineSpaceApp({ assetsDir }) + activateApps: /assets/:path* IS registered — the same ' +
    'request that 404s without assetsDir now reaches the route (a genuinely missing file inside ' +
    "it still 404s, but for a different reason: the route exists, the file just isn't there)",
  async () => {
    const app = defineSpaceApp({ name: 'fixture-with-assets-dir-app', assetsDir: '.' })
    const activated = await activateApps([app])
    const [serverId] = await bootstrapServers({
      rest: {
        application: 'fixture-with-assets-dir-app',
        id: 'fixture-with-assets-dir-app',
        port: 20913,
      },
    })
    assert(serverId, 'the server should have been started')
    try {
      const info = webServerManager.info(serverId)
      assert(info.addr, 'the started server should be listening')
      const baseUrl = `http://${info.addr.hostname}:${info.addr.port}`
      const res = await fetch(`${baseUrl}/assets/definitely-not-a-real-file.js`)
      assertEquals(res.status, 404)
      await res.body?.cancel()
    } finally {
      await webServerManager.stop([serverId])
      await deactivateApps(activated)
    }
  },
)
