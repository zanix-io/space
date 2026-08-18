// Installs a renderer, exactly as a real app does: `@zanix/space` itself ships none, so a
// test that renders must import the entry point it is testing against.
import '../../../../mod-react.ts'
import { assert, assertEquals } from '@std/assert'
import { activateApps, deactivateApps } from '@zanix/app/runtime'
import { bootstrapServers, webServerManager } from '@zanix/server'
import { defineSpaceApp } from 'modules/runtime/mod.ts'

Deno.test(
  "defineSpaceApp + activateApps: a page registers under this app's own Application, " +
    'reachable at the site root once bootstrapServers targets that Application by name',
  async () => {
    const app = defineSpaceApp({
      name: 'fixture-app',
      routesDir: 'src/@tests/support/fixtures/app-routes',
    })

    const activated = await activateApps([app])
    const servers = await bootstrapServers({
      ssr: { application: 'fixture-app', port: 20501 },
    })

    try {
      // If `setup(ctx)` (and therefore `loadRoutes`) had run outside this app's own
      // `ProgramModule.defineApplication` scope, the page would have registered under the
      // default Application instead, and this server (scoped to 'fixture-app') would have found
      // no routes to serve at all.
      assertEquals(servers.length, 1)

      const res = await fetch('http://localhost:20501/')
      assertEquals(res.status, 200)
      const html = await res.text()
      assert(html.includes('fixture-app home'))
    } finally {
      await webServerManager.stop(servers)
      await deactivateApps(activated)
    }
  },
)
