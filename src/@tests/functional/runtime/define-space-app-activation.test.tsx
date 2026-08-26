// Installs a renderer, exactly as a real app does: `@zanix/space` itself ships none, so a
// test that renders must import the entry point it is testing against.
import '../../../../mod-react.ts'
import { assert, assertEquals } from '@std/assert'
import { join } from '@std/path'
import { getTemporaryFolder } from '@zanix/helpers'
import { activateApps, deactivateApps } from '@zanix/app/runtime'
import { bootstrapServers, ProgramModule, webServerManager } from '@zanix/server'
import { defineSpaceApp } from 'modules/runtime/mod.ts'
import { Page, SpacePageController } from 'modules/router/mod.ts'
import { MANIFEST_ROUTE, setPwaConfig } from 'modules/pwa/mod.ts'
import {
  getDevRoutesReloader,
  setDevImportModule,
  setDevRoutesReloader,
} from 'modules/dev/dev-engine-registry.ts'

const TMP_ROOT = getTemporaryFolder(import.meta.url)

const mockSetupCtx = {
  resource: () => undefined,
  config: { get: () => undefined, has: () => false },
} as never

function OverriddenView() {
  return <p>dev-import-override-ok</p>
}

function ReloadedView() {
  return <p>dev-import-reloaded-ok</p>
}

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

Deno.test(
  "defineSpaceApp: setup()'s own loadRoutes() call uses a registered dev import override",
  async () => {
    // Same shape as `load-routes.test.tsx`'s "second call deregisters" test, but exercised
    // through `defineSpaceApp`'s OWN internal `loadRoutes()` call (never called directly here) —
    // this is what proves the registry actually reaches that call, not just `loadRoutes` itself.
    // This test lives here (not in the unit suite) because it opens a real port via
    // `bootstrapServers` and issues a real `fetch` against it — the same real-server pattern as
    // this file's other test above.
    const routesDir = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      await Deno.writeTextFile(
        join(routesDir, 'page.tsx'),
        'export default null\n',
      )

      @Page()
      class OverriddenPage extends SpacePageController {
        public override component = OverriddenView
      }

      let calledWith: string | undefined
      setDevImportModule((filePath) => {
        calledWith = filePath
        return Promise.resolve({ default: OverriddenPage })
      })

      try {
        const app = defineSpaceApp({ name: 'storefront', routesDir })
        // Explicit `defineApplication(DEFAULT_APPLICATION, ...)`, not a bare, unscoped
        // `setup?.(mockSetupCtx)` call relying on `ApplicationContainer.getCurrent()`'s own
        // "falls back to `DEFAULT_APPLICATION` when no scope is active" default: that fallback
        // path is exactly the one `denoland/deno#36464` (context preserved incorrectly after an
        // exited scope — see `AsyncContext`'s own doc, `@zanix/server`) can corrupt when a
        // PRIOR, already-fully-awaited `runWith` scope from an earlier test in this same process
        // (this file's own test above, `Application 'fixture-app'`) leaks its id into later,
        // unrelated async work instead of genuinely falling through to the default. Entering a
        // real scope here, even for the default Application's own name, sidesteps the fallback
        // path entirely.
        await ProgramModule.defineApplication(
          'main',
          () => app.definition.setup?.(mockSetupCtx),
        )

        assertEquals(calledWith, join(routesDir, 'page.tsx'))

        const servers = await bootstrapServers({ ssr: { port: 20905 } })
        try {
          const res = await fetch('http://localhost:20905')
          const html = await res.text()
          assert(html.includes('dev-import-override-ok'), html)
        } finally {
          await webServerManager.stop(servers)
        }
      } finally {
        setDevImportModule(undefined)
        setDevRoutesReloader(undefined)
      }
    } finally {
      await Deno.remove(routesDir, { recursive: true })
    }
  },
)

Deno.test(
  'defineSpaceApp: in dev mode, the registered reloader re-runs loadRoutes with a fresh import',
  async () => {
    // Simulates `zanix space dev`'s own file-change flow: it never calls `loadRoutes` itself —
    // only `getDevRoutesReloader()?.()`, generically, with no knowledge of this app's own name or
    // `routesDir`. Both must already be captured correctly inside `defineSpaceApp`'s own closure.
    // This test lives here (not in the unit suite) because it opens a real port via
    // `bootstrapServers` and issues a real `fetch` against it — the same real-server pattern as
    // this file's other test above.
    const routesDir = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      await Deno.writeTextFile(
        join(routesDir, 'page.tsx'),
        'export default null\n',
      )

      @Page()
      class GenOnePage extends SpacePageController {
        public override component = OverriddenView
      }
      @Page()
      class GenTwoPage extends SpacePageController {
        public override component = ReloadedView
      }

      let generation = 0
      setDevImportModule(() => {
        generation++
        return Promise.resolve({
          default: generation === 1 ? GenOnePage : GenTwoPage,
        })
      })

      try {
        const app = defineSpaceApp({ name: 'storefront', routesDir })
        // Matches `@zanix/app`'s own `registerApp`: the real `activateApps()` path always runs
        // `setup()` inside this exact `defineApplication` scope, which is what the reloader below
        // also re-enters — calling `setup()` unscoped here (as this file's other tests safely do)
        // would register the first generation under the DEFAULT Application instead, mismatching
        // the reload's own `application: 'storefront'` scope for no reason but this test's shortcut.
        await ProgramModule.defineApplication(
          'storefront',
          () => app.definition.setup?.(mockSetupCtx),
        )

        const reload = getDevRoutesReloader()
        assert(
          reload,
          'a reloader must be registered once a dev import override is set',
        )
        await reload()

        const servers = await bootstrapServers({
          ssr: { port: 20906, application: 'storefront' },
        })
        try {
          const res = await fetch('http://localhost:20906')
          const html = await res.text()
          // Only the reloaded (second) generation is served — the first generation's route was
          // deregistered, not left dangling alongside the new one (same guarantee `loadRoutes`'s
          // own "second call deregisters" test already covers directly).
          assert(html.includes('dev-import-reloaded-ok'), html)
          assert(!html.includes('dev-import-override-ok'), html)
        } finally {
          await webServerManager.stop(servers)
        }
      } finally {
        setDevImportModule(undefined)
        setDevRoutesReloader(undefined)
      }
    } finally {
      await Deno.remove(routesDir, { recursive: true })
    }
  },
)

Deno.test(
  "defineSpaceApp: registers this app's PWA routes as part of setup(), same timing as loadRoutes()",
  async () => {
    // This test lives here (not in the unit suite) because it opens a real port via
    // `bootstrapServers` and issues a real `fetch` against it — the same real-server pattern as
    // this file's other test above.
    const app = defineSpaceApp({
      name: 'storefront',
      pwa: { name: 'Storefront', icon: '/tmp/icon.png', iconSizes: [] },
    })
    try {
      // Explicit scope, not a bare `setup?.(mockSetupCtx)` call — see the sibling test above
      // ("setup()'s own loadRoutes() call uses a registered dev import override") for why relying
      // on `ApplicationContainer.getCurrent()`'s own `DEFAULT_APPLICATION` fallback is unsafe here
      // (`denoland/deno#36464`).
      await ProgramModule.defineApplication(
        'main',
        () => app.definition.setup?.(mockSetupCtx),
      )

      const servers = await bootstrapServers({ ssr: { port: 20904 } })
      try {
        const res = await fetch(`http://localhost:20904${MANIFEST_ROUTE}`)
        assertEquals(res.status, 200)
        const manifest = await res.json()
        assertEquals(manifest.name, 'Storefront')
      } finally {
        await webServerManager.stop(servers)
      }
    } finally {
      setPwaConfig(undefined)
    }
  },
)
