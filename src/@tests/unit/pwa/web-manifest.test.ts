import { assertEquals } from '@std/assert'
import { buildWebManifest, iconRoute, MANIFEST_ROUTE } from 'modules/pwa/web-manifest.ts'

Deno.test('MANIFEST_ROUTE: a fixed, standard path', () => {
  assertEquals(MANIFEST_ROUTE, '/manifest.webmanifest')
})

Deno.test('buildWebManifest: minimal config', () => {
  const manifest = buildWebManifest({ name: 'Storefront', icon: './icon.png' })

  assertEquals(manifest.name, 'Storefront')
  assertEquals(manifest.short_name, 'Storefront')
  assertEquals(manifest.start_url, '/')
  assertEquals(manifest.display, 'standalone')
  assertEquals(manifest.icons, [
    { src: iconRoute(192), sizes: '192x192', type: 'image/png' },
    { src: iconRoute(512), sizes: '512x512', type: 'image/png' },
  ])
  assertEquals(manifest.theme_color, undefined)
  assertEquals(manifest.background_color, undefined)
  assertEquals(manifest.shortcuts, undefined)
})

Deno.test('buildWebManifest: shortName overrides the short_name fallback', () => {
  const manifest = buildWebManifest({
    name: 'Storefront',
    shortName: 'Store',
    icon: './icon.png',
  })
  assertEquals(manifest.short_name, 'Store')
})

Deno.test('buildWebManifest: themeColor/backgroundColor pass through only when set', () => {
  const manifest = buildWebManifest({
    name: 'Storefront',
    themeColor: '#2563eb',
    backgroundColor: '#ffffff',
    icon: './icon.png',
  })
  assertEquals(manifest.theme_color, '#2563eb')
  assertEquals(manifest.background_color, '#ffffff')
})

Deno.test('buildWebManifest: custom iconSizes changes the icons array', () => {
  const manifest = buildWebManifest({
    name: 'Storefront',
    icon: './icon.png',
    iconSizes: [32, 180],
  })
  assertEquals(manifest.icons, [
    { src: iconRoute(32), sizes: '32x32', type: 'image/png' },
    { src: iconRoute(180), sizes: '180x180', type: 'image/png' },
  ])
})

Deno.test('buildWebManifest: shortcuts map through, with and without their own icon', () => {
  const manifest = buildWebManifest({
    name: 'Storefront',
    icon: './icon.png',
    shortcuts: [
      { name: 'Cart', url: '/cart' },
      { name: 'Wishlist', url: '/wishlist', icon: '/icons/wishlist.png' },
    ],
  })
  assertEquals(manifest.shortcuts, [
    { name: 'Cart', url: '/cart' },
    {
      name: 'Wishlist',
      url: '/wishlist',
      icons: [{ src: '/icons/wishlist.png', sizes: 'any' }],
    },
  ])
})

Deno.test('buildWebManifest: an empty shortcuts array omits the field entirely', () => {
  const manifest = buildWebManifest({
    name: 'Storefront',
    icon: './icon.png',
    shortcuts: [],
  })
  assertEquals(manifest.shortcuts, undefined)
})
