// Installs a renderer, exactly as a real app does: `@zanix/space` itself ships none, so a
// test that renders must import the entry point it is testing against.
import '../../../../mod-react.ts'
import { assert, assertEquals, assertThrows } from '@std/assert'
import { join } from '@std/path'
import { getTemporaryFolder } from '@zanix/helpers'
import { isZanixAppDefinition } from '@zanix/app'
import { ProgramModule } from '@zanix/server'
import { defineSpaceApp } from 'modules/runtime/mod.ts'
import { Page, SpacePageController } from 'modules/router/mod.ts'
import {
  getDefaultPageHeaders,
  resetDefaultPageHeaders,
} from 'modules/router/default-page-headers.ts'
import { getThemeResolver, resetThemeResolver } from 'modules/theme/theme-registry.ts'
import { getPwaConfig, setPwaConfig } from 'modules/pwa/mod.ts'
import { getActiveRenderer, setActiveRenderer } from 'modules/router/active-renderer.ts'
import { getGlobalCssPaths, setGlobalCssPaths } from 'modules/render/css-manifest.ts'
import {
  getAssetsDirConfig,
  getResolvedAssets,
  resetAssetsDirConfig,
  resetResolvedAssets,
} from 'modules/assets/asset-registry.ts'
import { getMessagesDir, resetMessagesDir } from 'modules/i18n/messages-registry.ts'
import {
  getDevRoutesReloader,
  setDevImportModule,
  setDevRoutesReloader,
} from 'modules/dev/dev-engine-registry.ts'

console.error = () => {}

const TMP_ROOT = getTemporaryFolder(import.meta.url)

const mockSetupCtx = {
  resource: () => undefined,
  config: { get: () => undefined, has: () => false },
} as never

function OverriddenView() {
  return <p>dev-import-override-ok</p>
}

Deno.test('defineSpaceApp: minimal config (only `name`) is valid', () => {
  const app = defineSpaceApp({ name: 'storefront' })

  assert(
    isZanixAppDefinition(app),
    'must be a real ZanixAppDefinition, not a plain object',
  )
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
  assertEquals(app.definition.dependencies, {
    cache: { type: 'local', required: false },
  })

  // A dedicated Application scope — `createLogApiController()` (always called from `setup()`)
  // registers a real, process-wide route; without its own scope, this and every other test that
  // calls `setup()` directly (bypassing `activateApps`'s real per-Application isolation) would
  // collapse into the shared default Application and collide with each other's registration.
  await ProgramModule.defineApplication(
    'storefront-forwards-setup-test',
    () => app.definition.setup?.(mockSetupCtx),
  )
  assert(
    setupRan,
    'the setup callback passed to defineSpaceApp must be the one @zanix/app calls',
  )
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

Deno.test(
  'defineSpaceApp: forwards theme.resolve into setThemeResolver, eagerly (same timing as headers)',
  () => {
    try {
      const resolve = () => ({ '--space-color-primary': '#16a34a' })
      defineSpaceApp({ name: 'storefront', theme: { resolve } })
      assertEquals(getThemeResolver(), resolve)
    } finally {
      resetThemeResolver()
    }
  },
)

Deno.test('defineSpaceApp: omitting theme never touches the registered resolver', () => {
  resetThemeResolver()
  defineSpaceApp({ name: 'storefront' })
  assertEquals(getThemeResolver(), undefined)
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
  'defineSpaceApp: forwards renderer into setActiveRenderer, eagerly (not deferred to ' +
    'setup/activateApps) — an external orchestrator that only imports the manifest (e.g. ' +
    '`zanix space build`, which never calls activateApps()) must see the real value right after ' +
    'this call returns',
  () => {
    try {
      defineSpaceApp({ name: 'storefront', renderer: 'preact' })
      assertEquals(getActiveRenderer(), 'preact')
    } finally {
      setActiveRenderer('react')
    }
  },
)

Deno.test('defineSpaceApp: omitting renderer eagerly defaults the active renderer to react', () => {
  setActiveRenderer('preact')
  defineSpaceApp({ name: 'storefront' })
  assertEquals(getActiveRenderer(), 'react')
})

Deno.test(
  'defineSpaceApp: forwards globalCss into addGlobalCssPaths, eagerly (not deferred to setup)',
  () => {
    setGlobalCssPaths(undefined)
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

Deno.test(
  "defineSpaceApp: a HOST app's own globalCss composes AFTER a base app's own — neither " +
    "declares or references the other's paths",
  () => {
    setGlobalCssPaths(undefined)
    try {
      // The base app's own defineSpaceApp() call, activated first — e.g. a reusable @acme/shop-app
      // package, imported/activated before the host's own customization app.
      defineSpaceApp({ name: 'shop-base', globalCss: ['./base.css'] })
      // The HOST's own defineSpaceApp() call — its own globalCss, no idea the base app even exists.
      defineSpaceApp({ name: 'shop-host', globalCss: ['./custom.css'] })

      assertEquals(getGlobalCssPaths(), ['./base.css', './custom.css'])
    } finally {
      setGlobalCssPaths(undefined)
    }
  },
)

Deno.test(
  "defineSpaceApp: a host that declares NO globalCss of its own leaves the base app's untouched",
  () => {
    setGlobalCssPaths(undefined)
    try {
      defineSpaceApp({ name: 'shop-base', globalCss: ['./base.css'] })
      defineSpaceApp({ name: 'shop-host' }) // no globalCss at all

      assertEquals(getGlobalCssPaths(), ['./base.css'])
    } finally {
      setGlobalCssPaths(undefined)
    }
  },
)

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
  'defineSpaceApp: omitting assetsDir never touches getResolvedAssets — backward compatible ' +
    'with every app that never declares it',
  async () => {
    resetResolvedAssets()
    const app = defineSpaceApp({ name: 'storefront' })
    // Own Application scope, same reasoning as the test above.
    await ProgramModule.defineApplication(
      'storefront-omitted-assetsdir-test',
      () => app.definition.setup?.(mockSetupCtx),
    )
    assertEquals(getResolvedAssets(), undefined)
  },
)

Deno.test(
  'defineSpaceApp: forwards assetsDir into setAssetsDirConfig, eagerly (not deferred to ' +
    'setup/activateApps) — an external orchestrator that only imports the manifest (e.g. ' +
    'buildSpaceClient(), which never calls activateApps()) must see the real value right after ' +
    'this call returns',
  () => {
    try {
      defineSpaceApp({ name: 'storefront-assets-eager', assetsDir: './my-assets' })
      assertEquals(getAssetsDirConfig(), './my-assets')
    } finally {
      resetAssetsDirConfig()
    }
  },
)

Deno.test('defineSpaceApp: omitting assetsDir never touches getAssetsDirConfig either', () => {
  resetAssetsDirConfig()
  defineSpaceApp({ name: 'storefront-assets-eager-omitted' })
  assertEquals(getAssetsDirConfig(), undefined)
})

Deno.test(
  'defineSpaceApp: the SCANNED asset map still only resolves via setup() (async — the raw ' +
    'assetsDir value itself is now ALSO eager, see the dedicated getAssetsDirConfig() test below, ' +
    'but scanning the directory is real filesystem work with no reason to also run eagerly) — a ' +
    'declared directory populates getResolvedAssets()',
  async () => {
    const assetsDir = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      await Deno.writeTextFile(join(assetsDir, 'logo.svg'), '<svg></svg>')

      const app = defineSpaceApp({ name: 'storefront-assets-unit', assetsDir })
      // A dedicated Application scope — `registerAssets()` (called from `setup()`) registers a
      // REAL route now, unlike when this test was first written; without its own scope it would
      // collide with the next test's own `/assets/:path*` registration under the shared default
      // Application.
      await ProgramModule.defineApplication(
        'storefront-assets-unit',
        () => app.definition.setup?.(mockSetupCtx),
      )

      assertEquals(
        getResolvedAssets()?.get('logo.svg'),
        join(assetsDir, 'logo.svg'),
      )
    } finally {
      resetResolvedAssets()
      await Deno.remove(assetsDir, { recursive: true })
    }
  },
)

Deno.test(
  'defineSpaceApp: assetsDir as an array resolves first-match-wins, same as scanAssets alone',
  async () => {
    const overrideDir = await Deno.makeTempDir({ dir: TMP_ROOT })
    const baseDir = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      await Deno.writeTextFile(join(overrideDir, 'logo.svg'), 'override')
      await Deno.writeTextFile(join(baseDir, 'logo.svg'), 'base')
      await Deno.mkdir(join(baseDir, 'icons'), { recursive: true })
      await Deno.writeTextFile(
        join(baseDir, 'icons', 'favicon.png'),
        'base-icon',
      )

      const app = defineSpaceApp({
        name: 'shop-custom-assets-unit',
        assetsDir: [overrideDir, baseDir],
      })
      // Own Application scope, same reasoning as the test above.
      await ProgramModule.defineApplication(
        'shop-custom-assets-unit',
        () => app.definition.setup?.(mockSetupCtx),
      )

      const resolved = getResolvedAssets()
      assertEquals(resolved?.get('logo.svg'), join(overrideDir, 'logo.svg'))
      assertEquals(
        resolved?.get('icons/favicon.png'),
        join(baseDir, 'icons', 'favicon.png'),
      )
    } finally {
      resetResolvedAssets()
      await Deno.remove(overrideDir, { recursive: true })
      await Deno.remove(baseDir, { recursive: true })
    }
  },
)

Deno.test(
  'defineSpaceApp: omitting messagesDir never touches getMessagesDir — backward compatible with ' +
    'every app that never declares it',
  () => {
    resetMessagesDir()
    defineSpaceApp({ name: 'storefront-no-messages' })
    assertEquals(getMessagesDir(), undefined)
  },
)

Deno.test(
  'defineSpaceApp: forwards messagesDir into setMessagesDir, eagerly (not deferred to ' +
    "setup/activateApps) — same precedent as assetsDir's own path: `zanix space build`, which " +
    'never calls activateApps(), must see the real value right after this call returns, so its ' +
    "own message-compilation step (@zanix/cli's writeCompiledMessagesTree) can find it",
  () => {
    resetMessagesDir()
    try {
      defineSpaceApp({ name: 'storefront-messages-unit', messagesDir: './messages' })
      assertEquals(getMessagesDir(), './messages')
    } finally {
      resetMessagesDir()
    }
  },
)

Deno.test(
  'defineSpaceApp: messagesDir as an array is stored as-is, eagerly, same as a single string',
  () => {
    resetMessagesDir()
    try {
      defineSpaceApp({
        name: 'storefront-messages-array-unit',
        messagesDir: ['./messages-override', './messages'],
      })
      assertEquals(getMessagesDir(), ['./messages-override', './messages'])
    } finally {
      resetMessagesDir()
    }
  },
)

Deno.test(
  'defineSpaceApp: messagesDir is still readable after setup() runs too — eager storage does not ' +
    "get overwritten or cleared by setup()'s own composition scope",
  async () => {
    resetMessagesDir()
    try {
      const app = defineSpaceApp({
        name: 'storefront-messages-post-setup',
        messagesDir: './messages',
      })
      // Own Application scope, same reasoning as the assetsDir tests above.
      await ProgramModule.defineApplication(
        'storefront-messages-post-setup',
        () => app.definition.setup?.(mockSetupCtx),
      )
      assertEquals(getMessagesDir(), './messages')
    } finally {
      resetMessagesDir()
    }
  },
)

Deno.test(
  'defineSpaceApp: routesDir accepts an array, forwarded as-is to loadRoutes — a page from a ' +
    "later directory still resolves when an earlier one doesn't declare it",
  async () => {
    const overrideDir = await Deno.makeTempDir({ dir: TMP_ROOT })
    const baseDir = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      // Override directory declares nothing — every request must fall back to the base app.
      await Deno.writeTextFile(
        join(baseDir, 'page.tsx'),
        'export default null\n',
      )

      @Page()
      class BasePage extends SpacePageController {
        public override component = OverriddenView
      }

      const imported: string[] = []
      setDevImportModule((filePath) => {
        imported.push(filePath)
        return Promise.resolve({ default: BasePage })
      })

      try {
        const app = defineSpaceApp({
          name: 'storefront',
          routesDir: [overrideDir, baseDir],
        })
        // Own Application scope, same reasoning as the assetsDir tests above.
        await ProgramModule.defineApplication(
          'storefront-routesdir-array-test',
          () => app.definition.setup?.(mockSetupCtx),
        )

        assert(
          imported.includes(join(baseDir, 'page.tsx')),
          'falls back to the base directory',
        )
        assert(
          !imported.some((p) => p.startsWith(overrideDir)),
          'an empty override directory imports nothing of its own',
        )
      } finally {
        setDevImportModule(undefined)
        setDevRoutesReloader(undefined)
      }
    } finally {
      await Deno.remove(overrideDir, { recursive: true })
      await Deno.remove(baseDir, { recursive: true })
    }
  },
)

Deno.test(
  'defineSpaceApp: outside dev mode, setup() never registers a routes reloader',
  async () => {
    setDevRoutesReloader(undefined) // baseline: nothing registered from an earlier test
    const app = defineSpaceApp({ name: 'storefront' })
    // Own Application scope, same reasoning as the assetsDir tests above.
    await ProgramModule.defineApplication(
      'storefront-no-dev-reloader-test',
      () => app.definition.setup?.(mockSetupCtx),
    )

    assertEquals(getDevRoutesReloader(), undefined)
  },
)
