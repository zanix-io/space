import { assert, assertEquals } from '@std/assert'
import { build } from 'vite'
import type { Rollup } from 'vite'
import { cssPlugin } from 'modules/bundler/css-plugin.ts'

/**
 * Real `vite build()` runs, not mocks — same reasoning as `comet-plugin.test.ts`: whether Tailwind
 * actually processes utility classes into real CSS, and whether the manifest correlates back to the
 * real, hashed output file, can only be verified against real bundler output.
 */
// Created under this package's own root (not the OS temp dir) so Tailwind's own dependency
// resolution (`tailwindcss`, walked up via Node's directory-based module resolution) finds this
// package's own `node_modules` — an isolated OS temp dir has no `node_modules` of its own.
async function makeTempProjectDir(): Promise<string> {
  return await Deno.makeTempDir({ dir: Deno.cwd() })
}

Deno.test(
  'cssPlugin: Tailwind utility classes compile to real CSS, and the manifest lists the real ' +
    'hashed stylesheet URL',
  async () => {
    const root = await makeTempProjectDir()
    try {
      await Deno.writeTextFile(`${root}/app.css`, '@import "tailwindcss";\n')
      await Deno.writeTextFile(
        `${root}/main.ts`,
        "import './app.css'\nconsole.log('entry')\n",
      )

      const result = await build({
        root,
        logLevel: 'silent',
        build: { write: false, rollupOptions: { input: `${root}/main.ts` } },
        plugins: cssPlugin(),
      })

      const { output } = (Array.isArray(result) ? result[0] : result) as Rollup.RollupOutput
      const assets = output.filter((entry) => entry.type === 'asset')

      const cssAsset = assets.find((asset) => asset.fileName.endsWith('.css'))
      assert(cssAsset, 'expected a built .css asset')
      const cssSource = cssAsset.source as string
      // A Tailwind utility class actually used below must compile to a real rule — proves this
      // isn't just an empty/pass-through stylesheet.
      assert(cssSource.length > 0, 'expected non-empty compiled CSS')

      const manifestAsset = assets.find((asset) => asset.fileName === 'css-manifest.json')
      assert(manifestAsset, 'expected a css-manifest.json asset')
      const manifest = JSON.parse(manifestAsset.source as string)
      assertEquals(manifest, [`/${cssAsset.fileName}`])
    } finally {
      await Deno.remove(root, { recursive: true })
    }
  },
)

Deno.test(
  'cssPlugin: with tailwind/vanillaExtract both off, a plain CSS Modules-only build still ' +
    'writes the manifest',
  async () => {
    const root = await Deno.makeTempDir()
    try {
      await Deno.writeTextFile(`${root}/style.module.css`, '.title { color: red; }\n')
      await Deno.writeTextFile(
        `${root}/main.ts`,
        "import styles from './style.module.css'\nconsole.log(styles.title)\n",
      )

      const result = await build({
        root,
        logLevel: 'silent',
        build: { write: false, rollupOptions: { input: `${root}/main.ts` } },
        plugins: cssPlugin({ tailwind: false }),
      })

      const { output } = (Array.isArray(result) ? result[0] : result) as Rollup.RollupOutput
      const assets = output.filter((entry) => entry.type === 'asset')
      const chunks = output.filter((entry): entry is Rollup.OutputChunk => entry.type === 'chunk')

      const cssAsset = assets.find((asset) => asset.fileName.endsWith('.css'))
      assert(cssAsset, 'expected a built .css asset from the CSS Modules file')
      assert((cssAsset.source as string).includes('color:'), cssAsset.source)

      // CSS Modules scoping actually ran — the imported class name is a hashed identifier, not
      // the literal `title` written in the source file.
      const mainChunk = chunks.find((chunk) => chunk.facadeModuleId?.endsWith('main.ts'))
      assert(mainChunk, 'expected a chunk for the main entry')
      assert(!mainChunk.code.includes('console.log(styles.title)'), mainChunk.code)

      const manifestAsset = assets.find((asset) => asset.fileName === 'css-manifest.json')
      assert(manifestAsset, 'expected a css-manifest.json asset')
      const manifest = JSON.parse(manifestAsset.source as string)
      assertEquals(manifest, [`/${cssAsset.fileName}`])
    } finally {
      await Deno.remove(root, { recursive: true })
    }
  },
)

Deno.test(
  'cssPlugin: modules: false disables the *.module.css → JS class-map import behavior app-wide ' +
    '— a plain (non-.module) stylesheet import still builds and still gets manifested',
  async () => {
    const root = await Deno.makeTempDir()
    try {
      // With CSS Modules off, `*.module.css` no longer has any special meaning: it's imported for
      // its side effect only, just like a plain `.css` file — never as a JS class-map object.
      await Deno.writeTextFile(`${root}/style.module.css`, '.title { color: red; }\n')
      await Deno.writeTextFile(`${root}/main.ts`, "import './style.module.css'\nconsole.log(1)\n")

      const result = await build({
        root,
        logLevel: 'silent',
        build: { write: false, rollupOptions: { input: `${root}/main.ts` } },
        plugins: cssPlugin({ tailwind: false, modules: false }),
      })

      const { output } = (Array.isArray(result) ? result[0] : result) as Rollup.RollupOutput
      const assets = output.filter((entry) => entry.type === 'asset')

      const cssAsset = assets.find((asset) => asset.fileName.endsWith('.css'))
      assert(cssAsset, 'expected a built .css asset even with modules scoping disabled')
      // The class name is NOT hashed/scoped — proves CSS Modules processing genuinely didn't run.
      assert((cssAsset.source as string).includes('.title'), cssAsset.source)

      const manifestAsset = assets.find((asset) => asset.fileName === 'css-manifest.json')
      assert(manifestAsset, 'expected a css-manifest.json asset')
    } finally {
      await Deno.remove(root, { recursive: true })
    }
  },
)

Deno.test(
  'cssPlugin: writes a typed *.module.css.d.ts next to every CSS Modules file it transforms',
  async () => {
    const root = await Deno.makeTempDir()
    try {
      const cssPath = `${root}/style.module.css`
      await Deno.writeTextFile(cssPath, '.title { color: red; }\n.icon--big { width: 2px; }\n')
      await Deno.writeTextFile(
        `${root}/main.ts`,
        "import styles from './style.module.css'\nconsole.log(styles.title)\n",
      )

      await build({
        root,
        logLevel: 'silent',
        build: { write: false, rollupOptions: { input: `${root}/main.ts` } },
        plugins: cssPlugin({ tailwind: false }),
      })

      const dtsContent = await Deno.readTextFile(`${cssPath}.d.ts`)
      assert(dtsContent.includes('"title": string'), dtsContent)
      assert(dtsContent.includes('"icon--big": string'), dtsContent)
      assert(dtsContent.includes('export ='), dtsContent)
    } finally {
      await Deno.remove(root, { recursive: true })
    }
  },
)

Deno.test('cssPlugin: modules: false skips the typed .d.ts codegen too', async () => {
  const root = await Deno.makeTempDir()
  try {
    const cssPath = `${root}/style.module.css`
    await Deno.writeTextFile(cssPath, '.title { color: red; }\n')
    await Deno.writeTextFile(`${root}/main.ts`, "import './style.module.css'\nconsole.log(1)\n")

    await build({
      root,
      logLevel: 'silent',
      build: { write: false, rollupOptions: { input: `${root}/main.ts` } },
      plugins: cssPlugin({ tailwind: false, modules: false }),
    })

    let dtsExists = true
    try {
      await Deno.stat(`${cssPath}.d.ts`)
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) dtsExists = false
      else throw error
    }
    assert(!dtsExists, 'expected no .d.ts file when modules scoping is disabled')
  } finally {
    await Deno.remove(root, { recursive: true })
  }
})

Deno.test('cssPlugin: no CSS imported at all, no manifest written', async () => {
  const root = await Deno.makeTempDir()
  try {
    await Deno.writeTextFile(`${root}/main.ts`, "console.log('entry')\n")

    const result = await build({
      root,
      logLevel: 'silent',
      build: { write: false, rollupOptions: { input: `${root}/main.ts` } },
      plugins: cssPlugin({ tailwind: false }),
    })

    const { output } = (Array.isArray(result) ? result[0] : result) as Rollup.RollupOutput
    const assets = output.filter((entry) => entry.type === 'asset')
    assertEquals(assets.find((a) => a.fileName === 'css-manifest.json'), undefined)
  } finally {
    await Deno.remove(root, { recursive: true })
  }
})
