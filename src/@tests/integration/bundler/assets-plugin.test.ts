import { assert, assertEquals, assertExists } from '@std/assert'
import { build } from 'vite'
import type { Rollup } from 'vite'
import sharp from 'sharp'
import { getTemporaryFolder } from '@zanix/helpers'
import { assetsPlugin } from 'modules/bundler/assets-plugin.ts'
import { resolveAssetHref, setAssetsManifestState } from 'modules/assets/assets-manifest.ts'

const TMP_ROOT = getTemporaryFolder(import.meta.url)

/** A real, deterministic photo-like JPEG (see `image-optimize.test.ts`'s own doc for why a
 * gradient beats per-pixel random noise for reliable, non-flaky compression comparisons). */
async function gradientJpeg(width: number, height: number, quality: number): Promise<Uint8Array> {
  const raw = new Uint8Array(width * height * 3)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3
      raw[i] = Math.floor((x / width) * 255)
      raw[i + 1] = Math.floor((y / height) * 255)
      raw[i + 2] = Math.floor(128 + 127 * Math.sin((x + y) / 12))
    }
  }
  return await sharp(raw, { raw: { width, height, channels: 3 } }).jpeg({ quality }).toBuffer()
}

/**
 * Real `vite build()` runs, not mocks — same reasoning `comet-plugin.test.ts` already documents:
 * `assetsPlugin`'s entire job (hashing each file, then writing a manifest that correlates back to
 * it) can only be verified against real bundler output.
 */
Deno.test(
  'assetsPlugin: hashes every file under assetsDir and writes a manifest correlating each ' +
    'relative path to its real, hashed output URL — including nested paths, preserved as-is',
  async () => {
    const assetsDir = await Deno.makeTempDir({ dir: TMP_ROOT })
    const root = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      await Deno.writeTextFile(`${assetsDir}/logo.svg`, '<svg>base</svg>')
      await Deno.mkdir(`${assetsDir}/icons`, { recursive: true })
      await Deno.writeTextFile(`${assetsDir}/icons/favicon.png`, 'fake-png-bytes')
      await Deno.writeTextFile(`${root}/main.ts`, 'export const x = 1\n')

      const result = await build({
        root,
        logLevel: 'silent',
        build: { write: false, minify: false, rollupOptions: { input: `${root}/main.ts` } },
        plugins: [assetsPlugin({ assetsDir })],
      })

      const { output } = (Array.isArray(result) ? result[0] : result) as Rollup.RollupOutput
      const assets = output.filter((entry) => entry.type === 'asset')

      const logoAsset = assets.find((a) => a.fileName.startsWith('assets/logo'))
      assert(logoAsset, 'expected a hashed logo.svg asset')
      assert(/logo-[\w-]+\.svg$/.test(logoAsset.fileName), logoAsset.fileName)
      assertEquals(new TextDecoder().decode(logoAsset.source as Uint8Array), '<svg>base</svg>')

      const iconAsset = assets.find((a) => a.fileName.startsWith('assets/icons/favicon'))
      assert(iconAsset, 'expected a hashed icons/favicon.png asset, nested path preserved')
      assert(/icons\/favicon-[\w-]+\.png$/.test(iconAsset.fileName), iconAsset.fileName)

      const manifestAsset = assets.find((a) => a.fileName === 'assets-manifest.json')
      assert(manifestAsset, 'expected an assets-manifest.json asset')
      const manifest = JSON.parse(manifestAsset.source as string)
      assertEquals(manifest['logo.svg'], `/${logoAsset.fileName}`)
      assertEquals(manifest['icons/favicon.png'], `/${iconAsset.fileName}`)
    } finally {
      await Deno.remove(assetsDir, { recursive: true })
      await Deno.remove(root, { recursive: true })
    }
  },
)

Deno.test(
  'assetsPlugin: an assetsDir with no files writes no manifest at all — no route needed for an ' +
    'app with nothing to hash',
  async () => {
    const assetsDir = await Deno.makeTempDir({ dir: TMP_ROOT })
    const root = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      await Deno.writeTextFile(`${root}/main.ts`, 'export const x = 1\n')

      const result = await build({
        root,
        logLevel: 'silent',
        build: { write: false, rollupOptions: { input: `${root}/main.ts` } },
        plugins: [assetsPlugin({ assetsDir })],
      })

      const { output } = (Array.isArray(result) ? result[0] : result) as Rollup.RollupOutput
      assertEquals(output.find((a) => a.fileName === 'assets-manifest.json'), undefined)
    } finally {
      await Deno.remove(assetsDir, { recursive: true })
      await Deno.remove(root, { recursive: true })
    }
  },
)

Deno.test(
  'assetsPlugin(assetsDir[]): first-match-wins across directories, same as scanAssets alone',
  async () => {
    const overrideDir = await Deno.makeTempDir({ dir: TMP_ROOT })
    const baseDir = await Deno.makeTempDir({ dir: TMP_ROOT })
    const root = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      await Deno.writeTextFile(`${overrideDir}/logo.svg`, 'override-logo')
      await Deno.writeTextFile(`${baseDir}/logo.svg`, 'base-logo')
      await Deno.writeTextFile(`${root}/main.ts`, 'export const x = 1\n')

      const result = await build({
        root,
        logLevel: 'silent',
        build: { write: false, minify: false, rollupOptions: { input: `${root}/main.ts` } },
        plugins: [assetsPlugin({ assetsDir: [overrideDir, baseDir] })],
      })

      const { output } = (Array.isArray(result) ? result[0] : result) as Rollup.RollupOutput
      const assets = output.filter((entry) => entry.type === 'asset')
      const logoAssets = assets.filter((a) => a.fileName.startsWith('assets/logo'))

      assertEquals(logoAssets.length, 1, 'only the override directory copy should be emitted')
      assertEquals(
        new TextDecoder().decode(logoAssets[0].source as Uint8Array),
        'override-logo',
      )
    } finally {
      await Deno.remove(overrideDir, { recursive: true })
      await Deno.remove(baseDir, { recursive: true })
      await Deno.remove(root, { recursive: true })
    }
  },
)

Deno.test(
  "assetsPlugin: omitting `optimize` entirely keeps every existing consumer's output byte-for-byte identical",
  async () => {
    const assetsDir = await Deno.makeTempDir({ dir: TMP_ROOT })
    const root = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      const source = await gradientJpeg(2000, 1500, 100)
      await Deno.writeFile(`${assetsDir}/hero.jpg`, source)
      await Deno.writeTextFile(`${root}/main.ts`, 'export const x = 1\n')

      const result = await build({
        root,
        logLevel: 'silent',
        build: { write: false, minify: false, rollupOptions: { input: `${root}/main.ts` } },
        plugins: [assetsPlugin({ assetsDir })], // no `optimize` at all
      })

      const { output } = (Array.isArray(result) ? result[0] : result) as Rollup.RollupOutput
      const assets = output.filter((entry) => entry.type === 'asset')
      const heroAsset = assets.find((a) => a.fileName.startsWith('assets/hero'))
      assertExists(heroAsset)
      assertEquals(heroAsset.source as Uint8Array, source, 'must be the exact original bytes')
      assertEquals(
        assets.filter((a) => a.fileName.startsWith('assets/hero')).length,
        1,
        'no variants should ever appear without an explicit optimize.images',
      )
    } finally {
      await Deno.remove(assetsDir, { recursive: true })
      await Deno.remove(root, { recursive: true })
    }
  },
)

Deno.test(
  'assetsPlugin: optimize.images with breakpoints — additive variants in the manifest, ' +
    'original key untouched, full flow verified via loadAssetsManifest + resolveAssetHref',
  async () => {
    const assetsDir = await Deno.makeTempDir({ dir: TMP_ROOT })
    const root = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      const source = await gradientJpeg(2000, 1500, 100)
      await Deno.writeFile(`${assetsDir}/hero.jpg`, source)
      await Deno.writeTextFile(`${root}/main.ts`, 'export const x = 1\n')

      const result = await build({
        root,
        logLevel: 'silent',
        build: { write: false, minify: false, rollupOptions: { input: `${root}/main.ts` } },
        plugins: [assetsPlugin({ assetsDir, optimize: { images: { breakpoints: ['msm'] } } })],
      })

      const { output } = (Array.isArray(result) ? result[0] : result) as Rollup.RollupOutput
      const assets = output.filter((entry) => entry.type === 'asset')

      const original = assets.find((a) => a.fileName.match(/^assets\/hero-[\w-]+\.jpg$/))
      assertExists(original, 'original hero.jpg entry must still exist, untouched')
      assertEquals(original.source as Uint8Array, source)

      const msmVariant = assets.find((a) => a.fileName.match(/^assets\/hero\.msm-[\w-]+\.jpg$/))
      assertExists(msmVariant, 'expected an additive hero.msm.jpg variant in the output')

      const manifestAsset = assets.find((a) => a.fileName === 'assets-manifest.json')
      assertExists(manifestAsset)
      const manifest = JSON.parse(manifestAsset.source as string)
      assertEquals(manifest['hero.jpg'], `/${original.fileName}`)
      assertEquals(manifest['hero.msm.jpg'], `/${msmVariant.fileName}`)

      // Full flow: real emitted manifest → loadAssetsManifest → resolveAssetHref, no shortcuts.
      try {
        setAssetsManifestState({ manifest })
        assertEquals(resolveAssetHref('hero.jpg'), `/${original.fileName}`)
        assertEquals(resolveAssetHref('hero.msm.jpg'), `/${msmVariant.fileName}`)
      } finally {
        setAssetsManifestState(undefined)
      }
    } finally {
      await Deno.remove(assetsDir, { recursive: true })
      await Deno.remove(root, { recursive: true })
    }
  },
)

Deno.test(
  'assetsPlugin: optimize.svg — same key replaced only when strictly smaller, no new keys',
  async () => {
    const assetsDir = await Deno.makeTempDir({ dir: TMP_ROOT })
    const root = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      const svg =
        '<svg xmlns="http://www.w3.org/2000/svg" width="10"><!-- c --><circle r="1"/></svg>'
      await Deno.writeTextFile(`${assetsDir}/icon.svg`, svg)
      await Deno.writeTextFile(`${root}/main.ts`, 'export const x = 1\n')

      const result = await build({
        root,
        logLevel: 'silent',
        build: { write: false, minify: false, rollupOptions: { input: `${root}/main.ts` } },
        plugins: [assetsPlugin({ assetsDir, optimize: { svg: true } })],
      })

      const { output } = (Array.isArray(result) ? result[0] : result) as Rollup.RollupOutput
      const assets = output.filter((entry) => entry.type === 'asset')
      const iconAssets = assets.filter((a) => a.fileName.startsWith('assets/icon'))

      assertEquals(iconAssets.length, 1, 'SVG optimization never produces additional keys')
      const text = new TextDecoder().decode(iconAssets[0].source as Uint8Array)
      assert(!text.includes('<!-- c -->'), 'expected the comment to be stripped')
      assert((iconAssets[0].source as Uint8Array).byteLength < svg.length)
    } finally {
      await Deno.remove(assetsDir, { recursive: true })
      await Deno.remove(root, { recursive: true })
    }
  },
)

Deno.test(
  'assetsPlugin: optimize.include scopes which assets are optimized — a file outside the ' +
    'glob is left completely untouched even with optimize.images on',
  async () => {
    const assetsDir = await Deno.makeTempDir({ dir: TMP_ROOT })
    const root = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      await Deno.mkdir(`${assetsDir}/img`, { recursive: true })
      const included = await gradientJpeg(2000, 1500, 100)
      await Deno.writeFile(`${assetsDir}/img/hero.jpg`, included)
      const excluded = await gradientJpeg(2000, 1500, 100)
      await Deno.writeFile(`${assetsDir}/other.jpg`, excluded)
      await Deno.writeTextFile(`${root}/main.ts`, 'export const x = 1\n')

      const result = await build({
        root,
        logLevel: 'silent',
        build: { write: false, minify: false, rollupOptions: { input: `${root}/main.ts` } },
        plugins: [
          assetsPlugin({
            assetsDir,
            optimize: { images: true, include: ['img/**'] },
          }),
        ],
      })

      const { output } = (Array.isArray(result) ? result[0] : result) as Rollup.RollupOutput
      const assets = output.filter((entry) => entry.type === 'asset')

      const includedAsset = assets.find((a) => a.fileName.match(/^assets\/img\/hero-[\w-]+\.jpg$/))
      assertExists(includedAsset)
      assert(
        (includedAsset.source as Uint8Array).byteLength < included.byteLength,
        'the included file should have actually been optimized',
      )

      const excludedAsset = assets.find((a) => a.fileName.match(/^assets\/other-[\w-]+\.jpg$/))
      assertExists(excludedAsset)
      assertEquals(
        excludedAsset.source as Uint8Array,
        excluded,
        'a file outside the include glob must stay byte-for-byte untouched',
      )
    } finally {
      await Deno.remove(assetsDir, { recursive: true })
      await Deno.remove(root, { recursive: true })
    }
  },
)

Deno.test(
  'assetsPlugin: an asset whose extension is not supported by images/svg is never touched, ' +
    'even when it matches optimize.include',
  async () => {
    const assetsDir = await Deno.makeTempDir({ dir: TMP_ROOT })
    const root = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      const textAsset = 'this is not an image or an svg\n'
      await Deno.writeTextFile(`${assetsDir}/readme.txt`, textAsset)
      await Deno.writeTextFile(`${root}/main.ts`, 'export const x = 1\n')

      const result = await build({
        root,
        logLevel: 'silent',
        build: { write: false, minify: false, rollupOptions: { input: `${root}/main.ts` } },
        plugins: [
          assetsPlugin({
            assetsDir,
            optimize: { images: true, svg: true, include: ['*.txt'] },
          }),
        ],
      })

      const { output } = (Array.isArray(result) ? result[0] : result) as Rollup.RollupOutput
      const assets = output.filter((entry) => entry.type === 'asset')
      const readmeAsset = assets.find((a) => a.fileName.startsWith('assets/readme'))
      assertExists(readmeAsset)
      assertEquals(new TextDecoder().decode(readmeAsset.source as Uint8Array), textAsset)
    } finally {
      await Deno.remove(assetsDir, { recursive: true })
      await Deno.remove(root, { recursive: true })
    }
  },
)
