import { assertEquals } from '@std/assert'
import {
  getPwaBuildOutput,
  getPwaConfig,
  loadPwaBuildOutput,
  resolvePwaHead,
  setPwaBuildOutput,
  setPwaConfig,
} from 'modules/pwa/pwa-registry.ts'
import { MANIFEST_ROUTE, SW_ROUTE } from 'modules/pwa/web-manifest.ts'

Deno.test('resolvePwaHead: undefined when no PWA is configured', () => {
  setPwaConfig(undefined)
  assertEquals(resolvePwaHead(), undefined)
})

Deno.test(
  'resolvePwaHead: manifestHref + themeColor when configured, no serviceWorkerHref without a build output',
  () => {
    setPwaConfig({
      name: 'Storefront',
      themeColor: '#2563eb',
      icon: '/tmp/icon.png',
    })
    try {
      assertEquals(resolvePwaHead(), {
        manifestHref: MANIFEST_ROUTE,
        themeColor: '#2563eb',
        serviceWorkerHref: undefined,
      })
    } finally {
      setPwaConfig(undefined)
    }
  },
)

Deno.test(
  'resolvePwaHead: includes serviceWorkerHref once a build output is registered',
  () => {
    setPwaConfig({ name: 'Storefront', icon: '/tmp/icon.png' })
    setPwaBuildOutput('/tmp/dist/client')
    try {
      assertEquals(resolvePwaHead(), {
        manifestHref: MANIFEST_ROUTE,
        themeColor: undefined,
        serviceWorkerHref: SW_ROUTE,
      })
    } finally {
      setPwaConfig(undefined)
      setPwaBuildOutput(undefined)
    }
  },
)

Deno.test('getPwaConfig: returns exactly what was set', () => {
  const config = { name: 'Storefront', icon: '/tmp/icon.png' }
  setPwaConfig(config)
  try {
    assertEquals(getPwaConfig(), config)
  } finally {
    setPwaConfig(undefined)
  }
})

Deno.test('loadPwaBuildOutput/getPwaBuildOutput: returns the directory that was set', () => {
  loadPwaBuildOutput('/tmp/dist/client')
  try {
    assertEquals(getPwaBuildOutput(), '/tmp/dist/client')
  } finally {
    setPwaBuildOutput(undefined)
  }
})

Deno.test('getPwaBuildOutput: undefined before any build output was ever registered', () => {
  setPwaBuildOutput(undefined)
  assertEquals(getPwaBuildOutput(), undefined)
})
