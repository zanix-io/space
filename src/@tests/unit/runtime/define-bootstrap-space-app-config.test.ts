import { assertEquals } from '@std/assert'
import { defineBootstrapSpaceAppConfig } from 'modules/runtime/define-bootstrap-space-app-config.ts'
import {
  getBootstrapSpaceAppConfig,
  resetUserBootstrapConfig,
} from 'modules/runtime/bootstrap-config-registry.ts'

// `defineBootstrapSpaceAppConfig` itself is never called anywhere else in this suite — every
// existing test exercises `bootstrap-config-registry.ts`'s `setUserBootstrapConfig` directly
// instead. Without this file, `defineBootstrapSpaceAppConfig` could stop delegating (or delegate
// with the wrong argument) with nothing here to catch it.
Deno.test(
  'defineBootstrapSpaceAppConfig: registers options that getBootstrapSpaceAppConfig then reflects, merged with its own defaults',
  () => {
    resetUserBootstrapConfig()

    defineBootstrapSpaceAppConfig({
      remoteInstances: { endpoint: 'http://my-space:8000' },
      server: { rest: { port: 3001 } },
    })

    assertEquals(getBootstrapSpaceAppConfig(), {
      remoteInstances: { endpoint: 'http://my-space:8000' },
      server: { ssr: {}, rest: { port: 3001 } },
    })
    resetUserBootstrapConfig()
  },
)

Deno.test(
  'defineBootstrapSpaceAppConfig: calling it again replaces the previously registered options',
  () => {
    resetUserBootstrapConfig()

    defineBootstrapSpaceAppConfig({ server: { rest: { port: 3001 } } })
    defineBootstrapSpaceAppConfig({ server: { ssr: { port: 8080 } } })

    assertEquals(getBootstrapSpaceAppConfig(), {
      server: { ssr: { port: 8080 }, rest: {} },
    })
    resetUserBootstrapConfig()
  },
)
