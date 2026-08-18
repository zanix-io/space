import { assertEquals } from '@std/assert'
import { join } from '@std/path'
import { resolvePwaPluginOptions } from 'modules/bundler/resolve-pwa-plugin-options.ts'

Deno.test('resolvePwaPluginOptions: maps iconSizes/offlineFallback, resolves icon vs root', () => {
  const resolved = resolvePwaPluginOptions(
    {
      name: 'Storefront',
      icon: './icon-source.png',
      iconSizes: [32, 180],
      offlineFallback: '/offline',
    },
    '/project/root',
  )
  assertEquals(resolved, {
    icons: {
      source: join('/project/root', 'icon-source.png'),
      sizes: [32, 180],
    },
    offlineFallback: '/offline',
  })
})

Deno.test('resolvePwaPluginOptions: omitted iconSizes/offlineFallback stay undefined', () => {
  const resolved = resolvePwaPluginOptions(
    { name: 'Storefront', icon: './icon-source.png' },
    '/project/root',
  )
  assertEquals(resolved, {
    icons: {
      source: join('/project/root', 'icon-source.png'),
      sizes: undefined,
    },
    offlineFallback: undefined,
  })
})

Deno.test('resolvePwaPluginOptions: an already-absolute icon path is left as-is', () => {
  const resolved = resolvePwaPluginOptions(
    { name: 'Storefront', icon: '/absolute/icon.png' },
    '/project/root',
  )
  assertEquals(resolved.icons.source, '/absolute/icon.png')
})
