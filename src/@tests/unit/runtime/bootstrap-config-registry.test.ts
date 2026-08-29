import { assertEquals } from '@std/assert'
import {
  getBootstrapSpaceAppConfig,
  resetUserBootstrapConfig,
  setUserBootstrapConfig,
} from 'modules/runtime/bootstrap-config-registry.ts'

Deno.test(
  'getBootstrapSpaceAppConfig: defaults to server.ssr/server.rest, both {}, when nothing was ever registered',
  () => {
    resetUserBootstrapConfig()
    assertEquals(getBootstrapSpaceAppConfig(), { server: { ssr: {}, rest: {} } })
  },
)

Deno.test(
  'setUserBootstrapConfig/getBootstrapSpaceAppConfig: a registered server.rest overrides the bare default',
  () => {
    resetUserBootstrapConfig()
    setUserBootstrapConfig({ server: { rest: { port: 3001 } } })

    assertEquals(getBootstrapSpaceAppConfig(), {
      server: { ssr: {}, rest: { port: 3001 } },
    })
    resetUserBootstrapConfig()
  },
)

Deno.test(
  'setUserBootstrapConfig/getBootstrapSpaceAppConfig: a registered server.ssr overrides the bare default too',
  () => {
    resetUserBootstrapConfig()
    setUserBootstrapConfig({ server: { ssr: { port: 8080 } } })

    assertEquals(getBootstrapSpaceAppConfig(), {
      server: { ssr: { port: 8080 }, rest: {} },
    })
    resetUserBootstrapConfig()
  },
)

Deno.test(
  'setUserBootstrapConfig/getBootstrapSpaceAppConfig: top-level fields (remoteInstances/uses/resources) pass through untouched',
  () => {
    resetUserBootstrapConfig()
    setUserBootstrapConfig({
      remoteInstances: { endpoint: 'http://my-space:8000' },
    })

    assertEquals(getBootstrapSpaceAppConfig(), {
      remoteInstances: { endpoint: 'http://my-space:8000' },
      server: { ssr: {}, rest: {} },
    })
    resetUserBootstrapConfig()
  },
)

Deno.test(
  'resetUserBootstrapConfig: clears a previously registered config back to the bare defaults',
  () => {
    setUserBootstrapConfig({ server: { rest: { port: 3001 } } })
    resetUserBootstrapConfig()

    assertEquals(getBootstrapSpaceAppConfig(), { server: { ssr: {}, rest: {} } })
  },
)
