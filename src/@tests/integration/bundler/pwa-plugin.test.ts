import { assert, assertEquals } from '@std/assert'
import { build } from 'vite'
import type { Rollup } from 'vite'
import sharp from 'sharp'
import { getTemporaryFolder } from '@zanix/helpers'
import { pwaPlugin, SW_FILE_NAME } from 'modules/bundler/pwa-plugin.ts'
import { cssPlugin } from 'modules/bundler/css-plugin.ts'
import { iconFileName } from 'modules/pwa/icon-naming.ts'

const TMP_ROOT = getTemporaryFolder(import.meta.url)

/**
 * Real `vite build()` + real `sharp` resizing, not mocks — same reasoning as
 * `comet-plugin.test.ts`/`css-plugin.test.ts`: whether the emitted icon files are actually
 * correctly-sized PNGs can only be verified by decoding the real output bytes.
 */
Deno.test(
  'pwaPlugin: generates real, correctly-sized PNG icons from a single source image',
  async () => {
    const root = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      const sourcePath = `${root}/icon-source.png`
      const source = await sharp({
        create: {
          width: 1024,
          height: 1024,
          channels: 4,
          background: { r: 10, g: 20, b: 30, alpha: 1 },
        },
      }).png().toBuffer()
      await Deno.writeFile(sourcePath, source)
      await Deno.writeTextFile(`${root}/main.ts`, "console.log('entry')\n")

      const result = await build({
        root,
        logLevel: 'silent',
        build: { write: false, rollupOptions: { input: `${root}/main.ts` } },
        plugins: [pwaPlugin({ icons: { source: sourcePath } })],
      })

      const { output } = (Array.isArray(result) ? result[0] : result) as Rollup.RollupOutput
      const assets = output.filter((entry) => entry.type === 'asset')

      await Promise.all(
        [192, 512].map(async (size) => {
          const expectedFileName = `icons/${iconFileName(size)}`
          const asset = assets.find((a) => a.fileName === expectedFileName)
          assert(asset, `expected an emitted asset at ${expectedFileName}`)
          const metadata = await sharp(asset.source as Uint8Array).metadata()
          assertEquals(metadata.width, size)
          assertEquals(metadata.height, size)
          assertEquals(metadata.format, 'png')
        }),
      )
    } finally {
      await Deno.remove(root, { recursive: true })
    }
  },
)

Deno.test('pwaPlugin: a custom sizes list overrides the [192, 512] default', async () => {
  const root = await Deno.makeTempDir({ dir: TMP_ROOT })
  try {
    const sourcePath = `${root}/icon-source.png`
    const source = await sharp({
      create: {
        width: 256,
        height: 256,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 1 },
      },
    }).png().toBuffer()
    await Deno.writeFile(sourcePath, source)
    await Deno.writeTextFile(`${root}/main.ts`, "console.log('entry')\n")

    const result = await build({
      root,
      logLevel: 'silent',
      build: { write: false, rollupOptions: { input: `${root}/main.ts` } },
      plugins: [pwaPlugin({ icons: { source: sourcePath, sizes: [32, 180] } })],
    })

    const { output } = (Array.isArray(result) ? result[0] : result) as Rollup.RollupOutput
    const assets = output.filter((entry) => entry.type === 'asset')

    assert(assets.find((a) => a.fileName === `icons/${iconFileName(32)}`))
    assert(assets.find((a) => a.fileName === `icons/${iconFileName(180)}`))
    assert(
      !assets.find((a) => a.fileName === `icons/${iconFileName(192)}`),
      'default sizes must not leak in',
    )
  } finally {
    await Deno.remove(root, { recursive: true })
  }
})

Deno.test(
  'pwaPlugin: emits sw.js precaching the real built CSS URL(s), regardless of cssPlugin ordering',
  async () => {
    const root = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      const sourcePath = `${root}/icon-source.png`
      const source = await sharp({
        create: {
          width: 64,
          height: 64,
          channels: 4,
          background: { r: 1, g: 2, b: 3, alpha: 1 },
        },
      }).png().toBuffer()
      await Deno.writeFile(sourcePath, source)
      await Deno.writeTextFile(`${root}/app.css`, '.title { color: red; }\n')
      await Deno.writeTextFile(
        `${root}/main.ts`,
        "import './app.css'\nconsole.log('entry')\n",
      )

      const result = await build({
        root,
        logLevel: 'silent',
        build: { write: false, rollupOptions: { input: `${root}/main.ts` } },
        plugins: [
          cssPlugin({ tailwind: false }),
          pwaPlugin({
            icons: { source: sourcePath },
            offlineFallback: '/offline',
          }),
        ],
      })

      const { output } = (Array.isArray(result) ? result[0] : result) as Rollup.RollupOutput
      const assets = output.filter((entry) => entry.type === 'asset')

      const cssAsset = assets.find((a) => a.fileName.endsWith('.css'))
      assert(cssAsset, 'expected a built .css asset')

      const swAsset = assets.find((a) => a.fileName === SW_FILE_NAME)
      assert(swAsset, `expected an emitted ${SW_FILE_NAME}`)
      const swSource = swAsset.source as string
      new Function(swSource) // real syntax validity check, not just a string-contains assertion
      assert(swSource.includes(`/${cssAsset.fileName}`), swSource)
      assert(swSource.includes(JSON.stringify('/offline')), swSource)
    } finally {
      await Deno.remove(root, { recursive: true })
    }
  },
)

Deno.test('pwaPlugin: with no offlineFallback given, sw.js embeds a literal null', async () => {
  const root = await Deno.makeTempDir({ dir: TMP_ROOT })
  try {
    const sourcePath = `${root}/icon-source.png`
    const source = await sharp({
      create: {
        width: 64,
        height: 64,
        channels: 4,
        background: { r: 1, g: 2, b: 3, alpha: 1 },
      },
    }).png().toBuffer()
    await Deno.writeFile(sourcePath, source)
    await Deno.writeTextFile(`${root}/main.ts`, "console.log('entry')\n")

    const result = await build({
      root,
      logLevel: 'silent',
      build: { write: false, rollupOptions: { input: `${root}/main.ts` } },
      plugins: [pwaPlugin({ icons: { source: sourcePath } })],
    })

    const { output } = (Array.isArray(result) ? result[0] : result) as Rollup.RollupOutput
    const swAsset = output.find((a) => a.type === 'asset' && a.fileName === SW_FILE_NAME)
    assert(swAsset && swAsset.type === 'asset')
    assert((swAsset.source as string).includes('OFFLINE_FALLBACK = null'))
  } finally {
    await Deno.remove(root, { recursive: true })
  }
})
