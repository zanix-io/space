import { assert, assertEquals, assertThrows } from '@std/assert'
import { join } from '@std/path'
import { isZanixAppDefinition } from '@zanix/app'
import { bootstrapServers, ProgramModule, webServerManager } from '@zanix/server'
import { defineSpaceApp } from 'modules/runtime/mod.ts'
import { Page, SpacePageController } from 'modules/router/mod.ts'
import {
  getDefaultPageHeaders,
  resetDefaultPageHeaders,
} from 'modules/router/default-page-headers.ts'
import { getPwaConfig, MANIFEST_ROUTE, setPwaConfig } from 'modules/pwa/mod.ts'
import { getGlobalCssPaths, setGlobalCssPaths } from 'modules/render/css-manifest.ts'
import {
  getDevRoutesReloader,
  setDevImportModule,
  setDevRoutesReloader,
} from 'modules/dev/dev-engine-registry.ts'

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

Deno.test('defineSpaceApp: minimal config (only `name`) is valid', () => {
  const app = defineSpaceApp({ name: 'storefront' })

  assert(isZanixAppDefinition(app), 'must be a real ZanixAppDefinition, not a plain object')
  assertEquals(app.definition.name, 'storefront')
  assertEquals(
    app.definition.routesPrefix,
    '',
    'a page must resolve at the real site path, never namespaced under the app name',
  )
  assertEquals(app.definition.dependencies, {})
  assert(
    typeof app.definition.setup === 'function',
    'setup always wraps loadRoutes(), even with no user-provided setup',
  )
})

Deno.test('defineSpaceApp: forwards version/dependencies/setup as given', async () => {
  let setupRan = false
  const app = defineSpaceApp({
    name: 'storefront',
    version: '1.0.0',
    dependencies: { cache: { type: 'local' } },
    setup: () => {
      setupRan = true
    },
  })

  assertEquals(app.definition.version, '1.0.0')
  assertEquals(app.definition.dependencies, { cache: { type: 'local', required: false } })

  await app.definition.setup?.(mockSetupCtx)
  assert(setupRan, 'the setup callback passed to defineSpaceApp must be the one @zanix/app calls')
})

Deno.test('defineSpaceApp: an invalid name throws, same as defineZanixApp', () => {
  assertThrows(() => defineSpaceApp({ name: 'Not Valid' }))
})

Deno.test('defineSpaceApp: forwards headers into setDefaultPageHeaders, app-wide', () => {
  try {
    defineSpaceApp({ name: 'storefront', headers: { frameOptions: 'DENY' } })
    assertEquals(getDefaultPageHeaders(), { frameOptions: 'DENY' })
  } finally {
    resetDefaultPageHeaders()
  }
})

Deno.test('defineSpaceApp: omitting headers never touches the app-wide default', () => {
  resetDefaultPageHeaders()
  defineSpaceApp({ name: 'storefront' })
  assertEquals(getDefaultPageHeaders(), undefined)
})

Deno.test('defineSpaceApp: forwards pwa into setPwaConfig, eagerly (not deferred to setup)', () => {
  try {
    const pwa = { name: 'Storefront', icon: '/tmp/icon.png' }
    defineSpaceApp({ name: 'storefront', pwa })
    assertEquals(getPwaConfig(), pwa)
  } finally {
    setPwaConfig(undefined)
  }
})

Deno.test('defineSpaceApp: omitting pwa never touches the app-wide pwa config', () => {
  setPwaConfig(undefined)
  defineSpaceApp({ name: 'storefront' })
  assertEquals(getPwaConfig(), undefined)
})

Deno.test(
  'defineSpaceApp: forwards globalCss into setGlobalCssPaths, eagerly (not deferred to setup)',
  () => {
    try {
      const globalCss = ['./styles/reset.css', './styles/app.css']
      defineSpaceApp({ name: 'storefront', globalCss })
      assertEquals(getGlobalCssPaths(), globalCss)
    } finally {
      setGlobalCssPaths(undefined)
    }
  },
)

Deno.test('defineSpaceApp: omitting globalCss never touches the app-wide global CSS paths', () => {
  setGlobalCssPaths(undefined)
  defineSpaceApp({ name: 'storefront' })
  assertEquals(getGlobalCssPaths(), undefined)
})

Deno.test('defineSpaceApp: pwa: false clears any previously set pwa config', () => {
  setPwaConfig({ name: 'Old App', icon: '/tmp/icon.png' })
  try {
    defineSpaceApp({ name: 'storefront', pwa: false })
    assertEquals(getPwaConfig(), undefined)
  } finally {
    setPwaConfig(undefined)
  }
})

Deno.test(
  "defineSpaceApp: setup()'s own loadRoutes() call uses a registered dev import override",
  async () => {
    // Same shape as `load-routes.test.tsx`'s "second call deregisters" test, but exercised
    // through `defineSpaceApp`'s OWN internal `loadRoutes()` call (never called directly here) —
    // this is what proves the registry actually reaches that call, not just `loadRoutes` itself.
    const routesDir = await Deno.makeTempDir()
    try {
      await Deno.writeTextFile(join(routesDir, 'page.tsx'), 'export default null\n')

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
        await app.definition.setup?.(mockSetupCtx)

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
    const routesDir = await Deno.makeTempDir()
    try {
      await Deno.writeTextFile(join(routesDir, 'page.tsx'), 'export default null\n')

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
        return Promise.resolve({ default: generation === 1 ? GenOnePage : GenTwoPage })
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
        assert(reload, 'a reloader must be registered once a dev import override is set')
        await reload()

        const servers = await bootstrapServers({ ssr: { port: 20906, application: 'storefront' } })
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
  'defineSpaceApp: outside dev mode, setup() never registers a routes reloader',
  async () => {
    setDevRoutesReloader(undefined) // baseline: nothing registered from an earlier test
    const app = defineSpaceApp({ name: 'storefront' })
    await app.definition.setup?.(mockSetupCtx)

    assertEquals(getDevRoutesReloader(), undefined)
  },
)

Deno.test(
  "defineSpaceApp: registers this app's PWA routes as part of setup(), same timing as loadRoutes()",
  async () => {
    const app = defineSpaceApp({
      name: 'storefront',
      pwa: { name: 'Storefront', icon: '/tmp/icon.png', iconSizes: [] },
    })
    try {
      await app.definition.setup?.(mockSetupCtx)

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
