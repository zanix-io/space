// Installs a renderer, exactly as a real app does — same precedent
// `define-space-app-activation.test.tsx` already establishes.
import '../../../../mod-react.ts'
import { assert, assertEquals } from '@std/assert'
import { activateApps, deactivateApps } from '@zanix/app/runtime'
import { bootstrapServers, webServerManager } from '@zanix/server'
import { getTemporaryFolder } from '@zanix/helpers'
import { defineSpaceApp } from 'modules/runtime/mod.ts'
import type { SpaceAppConfig } from 'typings/manifest.ts'

const TMP_ROOT = getTemporaryFolder(import.meta.url)
// Any page: an app with no SSR route at all starts no SSR server to fetch from.
const PAGE_ROUTES = 'src/@tests/support/fixtures/app-routes'
const ICO = new Uint8Array([0, 0, 1, 0, 9])
const PNG = new Uint8Array([137, 80, 78, 71, 7])

/** Starts a real app composed from `config` and fetches each path from it. */
async function fetchFromApp(
  name: string,
  port: number,
  config: Partial<SpaceAppConfig>,
  paths: string[],
): Promise<Response[]> {
  const app = defineSpaceApp({ name, ...config })
  const activated = await activateApps([app])
  const [serverId] = await bootstrapServers({ ssr: { application: name, port } })
  assert(serverId, 'the server should have been started')
  try {
    return await Promise.all(paths.map((path) => fetch(`http://localhost:${port}${path}`)))
  } finally {
    await webServerManager.stop([serverId])
    await deactivateApps(activated)
  }
}

Deno.test('defineSpaceApp({ siteIcons }) without pwa serves both icons and nothing of a PWA', async () => {
  const root = await Deno.makeTempDir({ dir: TMP_ROOT })
  try {
    await Deno.writeFile(`${root}/favicon.ico`, ICO)
    await Deno.writeFile(`${root}/apple.png`, PNG)
    const [favicon, apple, manifest, icon] = await fetchFromApp(
      'fixture-site-icons-app',
      20994,
      { siteIcons: { favicon: `${root}/favicon.ico`, appleTouchIcon: `${root}/apple.png` } },
      ['/favicon.ico', '/apple-touch-icon.png', '/manifest.webmanifest', '/icons/icon-192.png'],
    )
    assertEquals(favicon.status, 200)
    assertEquals(favicon.headers.get('content-type'), 'image/x-icon')
    assertEquals(new Uint8Array(await favicon.arrayBuffer()), ICO)
    assertEquals(apple.status, 200)
    assertEquals(apple.headers.get('content-type'), 'image/png')
    assertEquals(new Uint8Array(await apple.arrayBuffer()), PNG)
    assertEquals(manifest.status, 404)
    assertEquals(icon.status, 404)
    await manifest.body?.cancel()
    await icon.body?.cancel()
  } finally {
    await Deno.remove(root, { recursive: true })
  }
})

Deno.test('defineSpaceApp: unset siteIcons and a missing file both answer 404', async () => {
  const root = await Deno.makeTempDir({ dir: TMP_ROOT })
  try {
    const [unsetFavicon, unsetApple] = await fetchFromApp(
      'fixture-site-icons-unset-app',
      20995,
      { routesDir: PAGE_ROUTES },
      ['/favicon.ico', '/apple-touch-icon.png'],
    )
    assertEquals(unsetFavicon.status, 404)
    assertEquals(unsetApple.status, 404)
    await unsetFavicon.body?.cancel()
    await unsetApple.body?.cancel()

    const [missingFavicon, missingApple] = await fetchFromApp(
      'fixture-site-icons-missing-app',
      20996,
      {
        routesDir: PAGE_ROUTES,
        siteIcons: { favicon: `${root}/missing.ico`, appleTouchIcon: `${root}/missing.png` },
      },
      ['/favicon.ico', '/apple-touch-icon.png'],
    )
    assertEquals(missingFavicon.status, 404)
    assertEquals(missingApple.status, 404)
    await missingFavicon.body?.cancel()
    await missingApple.body?.cancel()
  } finally {
    await Deno.remove(root, { recursive: true })
  }
})

Deno.test('defineSpaceApp: siteIcons overrides pwa.favicon and the route is registered once', async () => {
  const root = await Deno.makeTempDir({ dir: TMP_ROOT })
  try {
    const siteIco = new Uint8Array([1, 1, 1, 1])
    await Deno.writeFile(`${root}/site.ico`, siteIco)
    await Deno.writeFile(`${root}/pwa.ico`, ICO)
    await Deno.writeFile(`${root}/pwa.png`, PNG)
    const [favicon, apple, manifest] = await fetchFromApp(
      'fixture-site-icons-precedence-app',
      20997,
      {
        siteIcons: { favicon: `${root}/site.ico` },
        pwa: {
          name: 'Storefront',
          icon: './icon-source.png',
          iconSizes: [192],
          favicon: `${root}/pwa.ico`,
          appleTouchIcon: `${root}/pwa.png`,
        },
      },
      ['/favicon.ico', '/apple-touch-icon.png', '/manifest.webmanifest'],
    )
    assertEquals(new Uint8Array(await favicon.arrayBuffer()), siteIco)
    assertEquals(new Uint8Array(await apple.arrayBuffer()), PNG)
    assertEquals(manifest.status, 200)
    await manifest.body?.cancel()
  } finally {
    await Deno.remove(root, { recursive: true })
  }
})

Deno.test('defineSpaceApp: pwa.favicon alone still serves the favicon', async () => {
  const root = await Deno.makeTempDir({ dir: TMP_ROOT })
  try {
    await Deno.writeFile(`${root}/pwa.ico`, ICO)
    const [favicon, apple] = await fetchFromApp(
      'fixture-site-icons-pwa-only-app',
      20998,
      {
        pwa: {
          name: 'Storefront',
          icon: './icon-source.png',
          iconSizes: [192],
          favicon: `${root}/pwa.ico`,
        },
      },
      ['/favicon.ico', '/apple-touch-icon.png'],
    )
    assertEquals(favicon.status, 200)
    assertEquals(new Uint8Array(await favicon.arrayBuffer()), ICO)
    assertEquals(apple.status, 404)
    await apple.body?.cancel()
  } finally {
    await Deno.remove(root, { recursive: true })
  }
})
