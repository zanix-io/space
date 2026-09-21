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
    push: undefined,
    serviceWorkerScript: undefined,
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
    push: undefined,
    serviceWorkerScript: undefined,
  })
})

Deno.test('resolvePwaPluginOptions: an already-absolute icon path is left as-is', () => {
  const resolved = resolvePwaPluginOptions(
    { name: 'Storefront', icon: '/absolute/icon.png' },
    '/project/root',
  )
  assertEquals(resolved.icons.source, '/absolute/icon.png')
})

Deno.test('resolvePwaPluginOptions: push defaults to the app name and the site root', () => {
  const resolved = resolvePwaPluginOptions(
    { name: 'Storefront', icon: './icon-source.png', push: {} },
    '/project/root',
  )
  assertEquals(resolved.push, { fallbackTitle: 'Storefront', defaultUrl: '/' })
})

Deno.test('resolvePwaPluginOptions: an explicit push title and default url are kept', () => {
  const resolved = resolvePwaPluginOptions(
    {
      name: 'Storefront',
      icon: './icon-source.png',
      push: { fallbackTitle: 'News', defaultUrl: '/inbox' },
    },
    '/project/root',
  )
  assertEquals(resolved.push, { fallbackTitle: 'News', defaultUrl: '/inbox' })
})

Deno.test('resolvePwaPluginOptions: serviceWorkerScript resolves against the project root', () => {
  const resolved = resolvePwaPluginOptions(
    { name: 'Storefront', icon: './icon-source.png', serviceWorkerScript: './src/sw-extra.js' },
    '/project/root',
  )
  assertEquals(resolved.serviceWorkerScript, join('/project/root', 'src/sw-extra.js'))
})
