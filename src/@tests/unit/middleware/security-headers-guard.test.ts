import { assertEquals } from '@std/assert'
import type { GuardContext } from '@zanix/server'
import { securityHeadersGuard } from 'modules/middleware/security-headers-guard.ts'

const ctx = {} as GuardContext

Deno.test(
  'securityHeadersGuard: COOP/COEP/CORP are all omitted by default',
  async () => {
    const { headers } = await securityHeadersGuard()(ctx)
    assertEquals(headers?.['Cross-Origin-Opener-Policy'], undefined)
    assertEquals(headers?.['Cross-Origin-Embedder-Policy'], undefined)
    assertEquals(headers?.['Cross-Origin-Resource-Policy'], undefined)
  },
)

Deno.test(
  'securityHeadersGuard: COOP/COEP/CORP are set exactly as given when opted in',
  async () => {
    const { headers } = await securityHeadersGuard({
      crossOriginOpenerPolicy: 'same-origin',
      crossOriginEmbedderPolicy: 'require-corp',
      crossOriginResourcePolicy: 'same-site',
    })(ctx)
    assertEquals(headers?.['Cross-Origin-Opener-Policy'], 'same-origin')
    assertEquals(headers?.['Cross-Origin-Embedder-Policy'], 'require-corp')
    assertEquals(headers?.['Cross-Origin-Resource-Policy'], 'same-site')
  },
)

Deno.test(
  'securityHeadersGuard: opting into one of the three does not turn on the others',
  async () => {
    const { headers } = await securityHeadersGuard({ crossOriginResourcePolicy: 'same-site' })(ctx)
    assertEquals(headers?.['Cross-Origin-Resource-Policy'], 'same-site')
    assertEquals(headers?.['Cross-Origin-Opener-Policy'], undefined)
    assertEquals(headers?.['Cross-Origin-Embedder-Policy'], undefined)
  },
)
