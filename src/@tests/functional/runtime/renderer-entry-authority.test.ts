import { assertRejects, assertStringIncludes } from '@std/assert'
import { activateApps, deactivateApps } from '@zanix/app/runtime'
import { defineSpaceApp } from '../../../../mod.ts'
import { installReactRuntime } from '../../../../mod-react.ts'
import { installPreactRuntime } from '../../../../mod-preact.ts'
import { getInstalledRenderer } from 'modules/router/renderer-runtime.ts'
import { assertEquals } from '@std/assert'

/**
 * The relationship between the two things that could each look like "the renderer setting", pinned
 * so they can never drift into being two configurations.
 *
 * - `defineSpaceApp({ renderer })` is the DECISION. It is the only place a project states which
 *   renderer it uses, and nothing here changes that.
 * - Importing `@zanix/space/react` / `@zanix/space/preact` is the INSTALLATION. It supplies an
 *   implementation to a core that ships none, and says nothing about what the project chose.
 *
 * The two meet exactly once, in `defineSpaceApp`'s own `setup`, as a check — never as a fallback and
 * never as an inference. A project that declares one renderer and installs the other is a real
 * configuration error, and it is reported as one rather than rendering with whichever happened to
 * load. There is deliberately no way for the import to become the configuration.
 *
 * @module
 */

console.error = () => {}

const ROUTES = 'src/@tests/support/fixtures/app-routes'

Deno.test(
  'renderer authority: `@zanix/space/react` + renderer:"react" activates cleanly, and the ' +
    'installed implementation is the one the app declared',
  async () => {
    installReactRuntime()
    assertEquals(getInstalledRenderer(), 'react')

    const app = defineSpaceApp({ name: 'authority-react', routesDir: ROUTES, renderer: 'react' })
    const activated = await activateApps([app])
    await deactivateApps(activated)
  },
)

Deno.test(
  'renderer authority: `@zanix/space/preact` + renderer:"preact" activates cleanly too — the ' +
    'same contract, with neither renderer privileged',
  async () => {
    installPreactRuntime()
    assertEquals(getInstalledRenderer(), 'preact')

    const app = defineSpaceApp({ name: 'authority-preact', routesDir: ROUTES, renderer: 'preact' })
    const activated = await activateApps([app])
    await deactivateApps(activated)
    // Left as React for every later test in this process, which is this suite's own default.
    installReactRuntime()
  },
)

Deno.test(
  'renderer authority: declaring one renderer while the OTHER entry point is installed fails ' +
    'loudly, naming both — the import can never silently become the configuration',
  async () => {
    installPreactRuntime()
    try {
      const app = defineSpaceApp({
        name: 'authority-mismatch',
        routesDir: ROUTES,
        renderer: 'react',
      })
      const error = await assertRejects(() => activateApps([app]), Error)

      assertStringIncludes(error.message, "declares renderer 'react'")
      assertStringIncludes(error.message, "'preact' is installed")
      // Actionable: it says which of the two to change, rather than just reporting a conflict.
      assertStringIncludes(error.message, '@zanix/space/preact')
    } finally {
      installReactRuntime()
    }
  },
)
