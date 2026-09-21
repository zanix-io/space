import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { join } from '@std/path'
import sharp from 'sharp'
import { getTemporaryFolder } from '@zanix/helpers'
import { buildSpaceClient } from 'modules/bundler/build-client.ts'
import { SW_FILE_NAME } from 'modules/bundler/pwa-plugin.ts'

const TMP_ROOT = getTemporaryFolder(import.meta.url)

/** Builds a real client with `push` and a `serviceWorkerScript` under `renderer`, and returns the
 * `sw.js` the build wrote. */
async function buildWorker(renderer: 'react' | 'preact'): Promise<string> {
  const root = await Deno.makeTempDir({ dir: TMP_ROOT })
  try {
    await Deno.writeFile(
      join(root, 'icon-source.png'),
      await sharp({
        create: {
          width: 512,
          height: 512,
          channels: 4,
          background: { r: 1, g: 2, b: 3, alpha: 1 },
        },
      }).png().toBuffer(),
    )
    await Deno.mkdir(join(root, 'src'))
    await Deno.writeTextFile(
      join(root, 'src/sw-extra.js'),
      "const APP_SCRIPT = 'runs in the worker'\n",
    )

    const result = await buildSpaceClient({
      root,
      renderer,
      css: { tailwind: false },
      pwa: {
        name: 'Storefront',
        icon: './icon-source.png',
        iconSizes: [192, 512],
        push: { defaultUrl: '/home' },
        serviceWorkerScript: './src/sw-extra.js',
      },
    })
    return await Deno.readTextFile(join(result.outDir, SW_FILE_NAME))
  } finally {
    await Deno.remove(root, { recursive: true })
  }
}

/**
 * The worker is produced by `pwaPlugin`, composed by `buildSpaceClient` from `PwaConfig` alone, so
 * the renderer must never influence it. Both renderers are built for real and their workers
 * compared byte for byte, not merely checked for the same substrings.
 */
Deno.test(
  'buildSpaceClient: pwa.push and pwa.serviceWorkerScript produce the same sw.js under react and preact',
  async () => {
    const [react, preact] = [await buildWorker('react'), await buildWorker('preact')]

    assertEquals(preact, react)
    assertStringIncludes(react, "self.addEventListener('push'")
    assertStringIncludes(react, "self.addEventListener('notificationclick'")
    assertStringIncludes(
      react,
      JSON.stringify({
        fallbackTitle: 'Storefront',
        defaultUrl: '/home',
        iconUrl: '/icons/icon-192.png',
      }),
    )
    assertStringIncludes(react, "const APP_SCRIPT = 'runs in the worker'")
    // The built worker keeps the cached shell: only the unbuilt one is cache-free.
    assertStringIncludes(react, "self.addEventListener('fetch'")
    new Function(react)
  },
)

Deno.test(
  'buildSpaceClient: a pwa without push or a script builds the same cached-shell worker as before',
  async () => {
    const root = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      await Deno.writeFile(
        join(root, 'icon-source.png'),
        await sharp({
          create: {
            width: 512,
            height: 512,
            channels: 4,
            background: { r: 1, g: 2, b: 3, alpha: 1 },
          },
        }).png().toBuffer(),
      )
      const result = await buildSpaceClient({
        root,
        css: { tailwind: false },
        pwa: { name: 'Storefront', icon: './icon-source.png', iconSizes: [192] },
      })
      const source = await Deno.readTextFile(join(result.outDir, SW_FILE_NAME))

      assert(!source.includes("'push'"))
      assert(!source.includes("'notificationclick'"))
      assertStringIncludes(source, "self.addEventListener('fetch'")
    } finally {
      await Deno.remove(root, { recursive: true })
    }
  },
)
