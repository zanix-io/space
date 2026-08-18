import { assertEquals } from '@std/assert'
import type { GuardContext } from '@zanix/server'
import {
  SECURITY_HEADER_NAMES,
  securityHeadersGuard,
  type SecurityHeadersOptions,
} from 'modules/middleware/security-headers-guard.ts'

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
    const { headers } = await securityHeadersGuard({
      crossOriginResourcePolicy: 'same-site',
    })(ctx)
    assertEquals(headers?.['Cross-Origin-Resource-Policy'], 'same-site')
    assertEquals(headers?.['Cross-Origin-Opener-Policy'], undefined)
    assertEquals(headers?.['Cross-Origin-Embedder-Policy'], undefined)
  },
)

Deno.test(
  'SECURITY_HEADER_NAMES: every field it maps actually corresponds to the real header ' +
    "securityHeadersGuard sets for it — the single source of truth SpacePageController's own " +
    'applySecurityGuards relies on to check a guard Headers object for each field',
  async () => {
    const explicitOptions = {
      frameOptions: 'DENY',
      referrerPolicy: 'no-referrer',
      noSniff: true,
      permissionsPolicy: { camera: [] },
      strictTransportSecurity: 'max-age=1',
      crossOriginOpenerPolicy: 'same-origin',
      crossOriginEmbedderPolicy: 'require-corp',
      crossOriginResourcePolicy: 'same-site',
    } as SecurityHeadersOptions

    const { headers } = await securityHeadersGuard(explicitOptions)(ctx)

    for (
      const field of Object.keys(SECURITY_HEADER_NAMES) as (keyof typeof SECURITY_HEADER_NAMES)[]
    ) {
      const realHeaderName = SECURITY_HEADER_NAMES[field]
      assertEquals(
        headers?.[realHeaderName] !== undefined,
        true,
        `${field} -> ${realHeaderName} did not produce a real header when explicitly configured`,
      )
    }
  },
)
