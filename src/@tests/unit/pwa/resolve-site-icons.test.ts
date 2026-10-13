import { assertEquals } from '@std/assert'
import { resolveSiteIcons } from 'modules/pwa/register-pwa.ts'

const PWA = { name: 'Storefront', icon: './icon.png' }

Deno.test('resolveSiteIcons: nothing configured resolves no icon', () => {
  assertEquals(resolveSiteIcons(undefined, undefined), {
    favicon: undefined,
    appleTouchIcon: undefined,
  })
  assertEquals(resolveSiteIcons(undefined, false), {
    favicon: undefined,
    appleTouchIcon: undefined,
  })
})

Deno.test('resolveSiteIcons: the pwa shortcut applies when siteIcons names nothing', () => {
  assertEquals(
    resolveSiteIcons(undefined, { ...PWA, favicon: './a.ico', appleTouchIcon: './a.png' }),
    { favicon: './a.ico', appleTouchIcon: './a.png' },
  )
})

Deno.test('resolveSiteIcons: siteIcons wins per icon over the pwa shortcut', () => {
  assertEquals(
    resolveSiteIcons(
      { favicon: './site.ico' },
      { ...PWA, favicon: './pwa.ico', appleTouchIcon: './pwa.png' },
    ),
    { favicon: './site.ico', appleTouchIcon: './pwa.png' },
  )
})
