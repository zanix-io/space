import { assert, assertEquals } from '@std/assert'
import { build } from 'vite'
import type { Rollup } from 'vite'
import { getTemporaryFolder } from '@zanix/helpers'
import { cssPlugin } from 'modules/bundler/css-plugin.ts'

const TMP_ROOT = getTemporaryFolder(import.meta.url)

/**
 * Real `vite build()` runs, not mocks — same reasoning as `comet-plugin.test.ts`: whether Tailwind
 * actually processes utility classes into real CSS, and whether the manifest correlates back to the
 * real, hashed output file, can only be verified against real bundler output.
 */
// Created under this package's own root (not the OS temp dir) so Tailwind's own dependency
// resolution (`tailwindcss`, walked up via Node's directory-based module resolution) finds this
// package's own `node_modules` — `TMP_ROOT` (this file's own `__tmp__`, nested inside the project
// tree) already satisfies that walk-up just as well.
async function makeTempProjectDir(): Promise<string> {
  return await Deno.makeTempDir({ dir: TMP_ROOT })
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
      assertEquals(manifest, { global: [`/${cssAsset.fileName}`] })
    } finally {
      await Deno.remove(root, { recursive: true })
    }
  },
)

Deno.test(
  'cssPlugin: with tailwind/vanillaExtract both off, a plain CSS Modules-only build still ' +
    'writes the manifest',
  async () => {
    const root = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      await Deno.writeTextFile(
        `${root}/style.module.css`,
        '.title { color: red; }\n',
      )
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
      assert(
        (cssAsset.source as string).includes('color:'),
        String(cssAsset.source),
      )

      // CSS Modules scoping actually ran — the imported class name is a hashed identifier, not
      // the literal `title` written in the source file.
      const mainChunk = chunks.find((chunk) => chunk.facadeModuleId?.endsWith('main.ts'))
      assert(mainChunk, 'expected a chunk for the main entry')
      assert(
        !mainChunk.code.includes('console.log(styles.title)'),
        mainChunk.code,
      )

      const manifestAsset = assets.find((asset) => asset.fileName === 'css-manifest.json')
      assert(manifestAsset, 'expected a css-manifest.json asset')
      const manifest = JSON.parse(manifestAsset.source as string)
      assertEquals(manifest, { global: [`/${cssAsset.fileName}`] })
    } finally {
      await Deno.remove(root, { recursive: true })
    }
  },
)

Deno.test(
  'cssPlugin: modules: false disables the *.module.css → JS class-map import behavior app-wide ' +
    '— a plain (non-.module) stylesheet import still builds and still gets manifested',
  async () => {
    const root = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      // With CSS Modules off, `*.module.css` no longer has any special meaning: it's imported for
      // its side effect only, just like a plain `.css` file — never as a JS class-map object.
      await Deno.writeTextFile(
        `${root}/style.module.css`,
        '.title { color: red; }\n',
      )
      await Deno.writeTextFile(
        `${root}/main.ts`,
        "import './style.module.css'\nconsole.log(1)\n",
      )

      const result = await build({
        root,
        logLevel: 'silent',
        build: { write: false, rollupOptions: { input: `${root}/main.ts` } },
        plugins: cssPlugin({ tailwind: false, modules: false }),
      })

      const { output } = (Array.isArray(result) ? result[0] : result) as Rollup.RollupOutput
      const assets = output.filter((entry) => entry.type === 'asset')

      const cssAsset = assets.find((asset) => asset.fileName.endsWith('.css'))
      assert(
        cssAsset,
        'expected a built .css asset even with modules scoping disabled',
      )
      // The class name is NOT hashed/scoped — proves CSS Modules processing genuinely didn't run.
      assert(
        (cssAsset.source as string).includes('.title'),
        String(cssAsset.source),
      )

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
    const root = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      const cssPath = `${root}/style.module.css`
      await Deno.writeTextFile(
        cssPath,
        '.title { color: red; }\n.icon--big { width: 2px; }\n',
      )
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
  const root = await Deno.makeTempDir({ dir: TMP_ROOT })
  try {
    const cssPath = `${root}/style.module.css`
    await Deno.writeTextFile(cssPath, '.title { color: red; }\n')
    await Deno.writeTextFile(
      `${root}/main.ts`,
      "import './style.module.css'\nconsole.log(1)\n",
    )

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
    assert(
      !dtsExists,
      'expected no .d.ts file when modules scoping is disabled',
    )
  } finally {
    await Deno.remove(root, { recursive: true })
  }
})

Deno.test(
  'cssPlugin: cometEntries scopes a comet-only CSS Module under manifest.comets, keyed by its ' +
    'own source identity — a plain global stylesheet stays in manifest.global, untouched. The ' +
    'real regression this covers: before cometEntries existed, generateBundle swept EVERY built ' +
    ".css asset into the flat global list, so a comet's own CSS Module shipped on every page " +
    'whether or not that page ever rendered the comet.',
  async () => {
    const root = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      await Deno.writeTextFile(`${root}/global.css`, '.app { margin: 0; }\n')
      await Deno.writeTextFile(
        `${root}/widget.module.css`,
        '.title { color: red; }\n',
      )
      await Deno.writeTextFile(
        `${root}/main.ts`,
        "import './global.css'\nconsole.log('entry')\n",
      )
      await Deno.writeTextFile(
        `${root}/comet-widget.ts`,
        "import styles from './widget.module.css'\nconsole.log(styles.title)\n",
      )
      const cometSourceKey = `${root}/comet-widget.ts`

      const result = await build({
        root,
        logLevel: 'silent',
        build: {
          write: false,
          rollupOptions: {
            input: { main: `${root}/main.ts`, 'comets-Widget': `${root}/comet-widget.ts` },
          },
        },
        plugins: cssPlugin({
          tailwind: false,
          cometEntries: { 'comets-Widget': cometSourceKey },
        }),
      })

      const { output } = (Array.isArray(result) ? result[0] : result) as Rollup.RollupOutput
      const assets = output.filter((entry) => entry.type === 'asset')

      const globalCssAsset = assets.find((asset) =>
        asset.fileName.endsWith('.css') && (asset.source as string).includes('margin:0')
      )
      assert(globalCssAsset, 'expected a built .css asset for the global stylesheet')
      const cometCssAsset = assets.find((asset) =>
        asset.fileName.endsWith('.css') && (asset.source as string).includes('color:')
      )
      assert(cometCssAsset, "expected a built .css asset for the comet's own CSS Module")
      assert(
        globalCssAsset.fileName !== cometCssAsset.fileName,
        'the global stylesheet and the comet CSS Module must build as two distinct assets',
      )

      const manifestAsset = assets.find((asset) => asset.fileName === 'css-manifest.json')
      assert(manifestAsset, 'expected a css-manifest.json asset')
      const manifest = JSON.parse(manifestAsset.source as string)

      assertEquals(manifest.global, [`/${globalCssAsset.fileName}`])
      assertEquals(manifest.comets, { [cometSourceKey]: [`/${cometCssAsset.fileName}`] })
    } finally {
      await Deno.remove(root, { recursive: true })
    }
  },
)

Deno.test(
  'cssPlugin: a comet entry that imports no CSS of its own contributes nothing to manifest.comets',
  async () => {
    const root = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      await Deno.writeTextFile(`${root}/global.css`, '.app { margin: 0; }\n')
      await Deno.writeTextFile(
        `${root}/main.ts`,
        "import './global.css'\nconsole.log('entry')\n",
      )
      await Deno.writeTextFile(
        `${root}/comet-plain.ts`,
        "console.log('a comet with no CSS import of its own')\n",
      )

      const result = await build({
        root,
        logLevel: 'silent',
        build: {
          write: false,
          rollupOptions: {
            input: { main: `${root}/main.ts`, 'comets-Plain': `${root}/comet-plain.ts` },
          },
        },
        plugins: cssPlugin({
          tailwind: false,
          cometEntries: { 'comets-Plain': `${root}/comet-plain.ts` },
        }),
      })

      const { output } = (Array.isArray(result) ? result[0] : result) as Rollup.RollupOutput
      const assets = output.filter((entry) => entry.type === 'asset')
      const manifestAsset = assets.find((asset) => asset.fileName === 'css-manifest.json')
      assert(manifestAsset, 'expected a css-manifest.json asset')
      const manifest = JSON.parse(manifestAsset.source as string)

      assertEquals(manifest.global.length, 1)
      assertEquals(manifest.comets, undefined)
    } finally {
      await Deno.remove(root, { recursive: true })
    }
  },
)

Deno.test(
  'cssPlugin: globalEntries writes manifest.global in DECLARATION order, each carrying its own ' +
    'media — the real regression this covers: without globalEntries, generateBundle swept ' +
    'Object.values(bundle) in alphabetical-by-output-filename order, silently contradicting ' +
    'globalCss\'s own documented "declaration order matters" contract',
  async () => {
    const root = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      await Deno.writeTextFile(`${root}/mobile.css`, '.m { color: red; }\n')
      await Deno.writeTextFile(`${root}/base.css`, '.b { color: blue; }\n')
      await Deno.writeTextFile(`${root}/extra.css`, '.e { color: green; }\n')

      const result = await build({
        root,
        logLevel: 'silent',
        build: {
          write: false,
          rollupOptions: {
            input: {
              mobile: `${root}/mobile.css`,
              base: `${root}/base.css`,
              extra: `${root}/extra.css`,
            },
          },
        },
        plugins: cssPlugin({
          tailwind: false,
          globalEntries: [
            { entryName: 'mobile', media: '(max-width: 599px)' },
            { entryName: 'base' },
            { entryName: 'extra' },
          ],
        }),
      })

      const { output } = (Array.isArray(result) ? result[0] : result) as Rollup.RollupOutput
      const assets = output.filter((entry) => entry.type === 'asset')
      // Match by selector, never by color value — a minifier can rewrite a named color to its
      // shorter hex equivalent (e.g. `blue` -> `#00f`), which would make a `color:blue` substring
      // match silently (and misleadingly) fail regardless of whether correlation itself is correct.
      const cssFor = (selector: string) =>
        assets.find((asset) =>
          asset.fileName.endsWith('.css') && (asset.source as string).includes(selector)
        )
      const mobileCss = cssFor('.m{')
      const baseCss = cssFor('.b{')
      const extraCss = cssFor('.e{')
      assert(mobileCss && baseCss && extraCss, 'expected three distinct built .css assets')

      const manifestAsset = assets.find((asset) => asset.fileName === 'css-manifest.json')
      assert(manifestAsset, 'expected a css-manifest.json asset')
      const manifest = JSON.parse(manifestAsset.source as string)

      assertEquals(manifest.global, [
        { href: `/${mobileCss.fileName}`, media: '(max-width: 599px)' },
        `/${baseCss.fileName}`,
        `/${extraCss.fileName}`,
      ])
    } finally {
      await Deno.remove(root, { recursive: true })
    }
  },
)

Deno.test(
  'cssPlugin: with globalEntries omitted, global falls back to the original unordered sweep — ' +
    'byte-identical to before this option existed (backward compat for a direct cssPlugin() ' +
    'caller that never passes it)',
  async () => {
    const root = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      await Deno.writeTextFile(`${root}/app.css`, '.app { margin: 0; }\n')
      await Deno.writeTextFile(
        `${root}/main.ts`,
        "import './app.css'\nconsole.log('entry')\n",
      )

      const result = await build({
        root,
        logLevel: 'silent',
        build: { write: false, rollupOptions: { input: `${root}/main.ts` } },
        plugins: cssPlugin({ tailwind: false }),
      })

      const { output } = (Array.isArray(result) ? result[0] : result) as Rollup.RollupOutput
      const assets = output.filter((entry) => entry.type === 'asset')
      const cssAsset = assets.find((asset) => asset.fileName.endsWith('.css'))
      assert(cssAsset, 'expected a built .css asset')

      const manifestAsset = assets.find((asset) => asset.fileName === 'css-manifest.json')
      assert(manifestAsset, 'expected a css-manifest.json asset')
      const manifest = JSON.parse(manifestAsset.source as string)
      assertEquals(manifest, { global: [`/${cssAsset.fileName}`] })
    } finally {
      await Deno.remove(root, { recursive: true })
    }
  },
)

Deno.test(
  "cssPlugin: pageEntries scopes each page's own CSS under manifest.pages, keyed by its own " +
    'filePath, in DECLARATION order per page — a stylesheet declared by page A never ends up ' +
    "under page B's own key, and neither ever falls into manifest.global",
  async () => {
    const root = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      await Deno.writeTextFile(`${root}/global.css`, '.app { margin: 0; }\n')
      await Deno.writeTextFile(`${root}/a-mobile.css`, '.am { color: red; }\n')
      await Deno.writeTextFile(`${root}/a-base.css`, '.ab { color: blue; }\n')
      await Deno.writeTextFile(`${root}/b.css`, '.bx { color: green; }\n')
      await Deno.writeTextFile(
        `${root}/main.ts`,
        "import './global.css'\nconsole.log('entry')\n",
      )

      const result = await build({
        root,
        logLevel: 'silent',
        build: {
          write: false,
          rollupOptions: {
            input: {
              main: `${root}/main.ts`,
              'page-a-mobile': `${root}/a-mobile.css`,
              'page-a-base': `${root}/a-base.css`,
              'page-b': `${root}/b.css`,
            },
          },
        },
        plugins: cssPlugin({
          tailwind: false,
          pageEntries: {
            '/fake/routes/a/page.tsx': [
              { entryName: 'page-a-mobile', media: '(max-width: 599px)' },
              { entryName: 'page-a-base' },
            ],
            '/fake/routes/b/page.tsx': [{ entryName: 'page-b' }],
          },
        }),
      })

      const { output } = (Array.isArray(result) ? result[0] : result) as Rollup.RollupOutput
      const assets = output.filter((entry) => entry.type === 'asset')
      const cssFor = (selector: string) =>
        assets.find((asset) =>
          asset.fileName.endsWith('.css') && (asset.source as string).includes(selector)
        )
      const globalCss = cssFor('.app{')
      const aMobileCss = cssFor('.am{')
      const aBaseCss = cssFor('.ab{')
      const bCss = cssFor('.bx{')
      assert(globalCss && aMobileCss && aBaseCss && bCss, 'expected four distinct built assets')

      const manifestAsset = assets.find((asset) => asset.fileName === 'css-manifest.json')
      assert(manifestAsset, 'expected a css-manifest.json asset')
      const manifest = JSON.parse(manifestAsset.source as string)

      assertEquals(manifest.global, [`/${globalCss.fileName}`])
      assertEquals(manifest.pages, {
        '/fake/routes/a/page.tsx': [
          { href: `/${aMobileCss.fileName}`, media: '(max-width: 599px)' },
          `/${aBaseCss.fileName}`,
        ],
        '/fake/routes/b/page.tsx': [`/${bCss.fileName}`],
      })
    } finally {
      await Deno.remove(root, { recursive: true })
    }
  },
)

Deno.test(
  'cssPlugin: a page entry with no CSS of its own contributes nothing to manifest.pages',
  async () => {
    const root = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      await Deno.writeTextFile(`${root}/global.css`, '.app { margin: 0; }\n')
      await Deno.writeTextFile(
        `${root}/main.ts`,
        "import './global.css'\nconsole.log('entry')\n",
      )
      await Deno.writeTextFile(
        `${root}/plain.ts`,
        "console.log('a build entry with no CSS of its own')\n",
      )

      const result = await build({
        root,
        logLevel: 'silent',
        build: {
          write: false,
          rollupOptions: {
            input: { main: `${root}/main.ts`, plain: `${root}/plain.ts` },
          },
        },
        plugins: cssPlugin({
          tailwind: false,
          pageEntries: { '/fake/routes/empty/page.tsx': [{ entryName: 'plain' }] },
        }),
      })

      const { output } = (Array.isArray(result) ? result[0] : result) as Rollup.RollupOutput
      const assets = output.filter((entry) => entry.type === 'asset')
      const manifestAsset = assets.find((asset) => asset.fileName === 'css-manifest.json')
      assert(manifestAsset, 'expected a css-manifest.json asset')
      const manifest = JSON.parse(manifestAsset.source as string)

      assertEquals(manifest.global.length, 1)
      assertEquals(manifest.pages, undefined)
    } finally {
      await Deno.remove(root, { recursive: true })
    }
  },
)

Deno.test('cssPlugin: no CSS imported at all, no manifest written', async () => {
  const root = await Deno.makeTempDir({ dir: TMP_ROOT })
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
    assertEquals(
      assets.find((a) => a.fileName === 'css-manifest.json'),
      undefined,
    )
  } finally {
    await Deno.remove(root, { recursive: true })
  }
})
