// Installs a renderer, exactly as a real app does: `@zanix/space` itself ships none, so a
// test that renders must import the entry point it is testing against.
import '../../../../mod-react.ts'
import { assert, assertEquals } from '@std/assert'
import { join } from '@std/path'
import { bootstrapServers, webServerManager } from '@zanix/server'
import { getTemporaryFolder } from '@zanix/helpers'
import { loadRoutes, Page, SpacePageController } from 'modules/router/mod.ts'

Deno.test(
  "loadRoutes: a pathless @Page() infers its route from the file's own folder location",
  async () => {
    await loadRoutes('src/@tests/support/fixtures/inferred-routes')

    const servers = await bootstrapServers({ ssr: { port: 20601 } })
    try {
      const res = await fetch('http://localhost:20601/inferred')
      assertEquals(res.status, 200)
      const html = await res.text()
      assert(html.includes('inferred-ok'))
    } finally {
      await webServerManager.stop(servers)
    }
  },
)

Deno.test(
  'loadRoutes: a second call for the same file deregisters the previous page class first',
  async () => {
    const routesDir = await Deno.makeTempDir({ dir: getTemporaryFolder(import.meta.url) })
    try {
      // Content is irrelevant — `scanPageFiles` only needs the file to exist to discover it;
      // `importModule` below is what actually decides what "imports" as this page.
      await Deno.writeTextFile(
        join(routesDir, 'page.tsx'),
        'export default null\n',
      )

      let generation = 0
      const importModule = () => {
        generation++
        const marker = `reload-gen-${generation}`
        function View() {
          return <p>{marker}</p>
        }
        @Page()
        class ReloadablePage extends SpacePageController {
          public override component = View
        }
        return Promise.resolve({ default: ReloadablePage })
      }

      await loadRoutes(routesDir, { importModule })
      // The real bug this covers: without deregistering the first call's class first, this
      // second call's fresh `@Page()` registration collides ("Route path ... is already
      // defined") — simulating a dev-server reimporting a page after a file change.
      await loadRoutes(routesDir, { importModule })

      const servers = await bootstrapServers({ ssr: { port: 20602 } })
      try {
        const res = await fetch('http://localhost:20602')
        assertEquals(res.status, 200)
        const html = await res.text()
        // Only the SECOND generation's class is actually registered/served — the first one's
        // route entry was removed, not left dangling alongside the new one.
        assert(html.includes('reload-gen-2'))
        assert(!html.includes('reload-gen-1'))
      } finally {
        await webServerManager.stop(servers)
      }
    } finally {
      await Deno.remove(routesDir, { recursive: true })
    }
  },
)

Deno.test(
  'loadRoutes: a redundant call for an UNCHANGED native-imported file stays a safe no-op',
  async () => {
    // Real regression coverage, not a hypothetical: an earlier version of this deregistration
    // logic unconditionally deregistered the previous class's routes before every reimport,
    // which broke `not-found-integration.test.tsx` (a real, pre-existing, legitimate pattern —
    // calling `loadRoutes()` again for the SAME unchanged fixture across several `Deno.test`
    // blocks in one file, relying on it being a no-op). `importModule` here hits Deno's own ES
    // module cache and returns the identical class both times — the fix only deregisters when
    // the reimport produces a genuinely DIFFERENT class (see `loadRoutes`'s own doc).
    //
    // Uses its own dedicated fixture (`redundant-reload-routes`), never touched by any other
    // test — the `inferred-routes` fixture this file's first test already consumes gets its
    // routes wiped by that test's own (default `finalize: true`) `bootstrapServers()` call,
    // which would make this test's failure mode indistinguishable from a real bug.
    await loadRoutes('src/@tests/support/fixtures/redundant-reload-routes')
    await loadRoutes('src/@tests/support/fixtures/redundant-reload-routes')

    const servers = await bootstrapServers({ ssr: { port: 20603 } })
    try {
      const res = await fetch('http://localhost:20603')
      assertEquals(res.status, 200)
      const html = await res.text()
      assert(html.includes('redundant-reload-ok'))
    } finally {
      await webServerManager.stop(servers)
    }
  },
)
