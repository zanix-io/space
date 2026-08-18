import { assert, assertEquals, assertFalse } from '@std/assert'
import { join } from '@std/path'
import sharp from 'sharp'
import { getTemporaryFolder } from '@zanix/helpers'
import { buildSpaceClient } from 'modules/bundler/build-client.ts'
import { iconFileName } from 'modules/pwa/icon-naming.ts'
import { SW_FILE_NAME } from 'modules/bundler/pwa-plugin.ts'
import { addGlobalCssPaths, setGlobalCssPaths } from 'modules/render/css-manifest.ts'
import { getActiveRenderer, setActiveRenderer } from 'modules/router/active-renderer.ts'
import { resetAssetsDirConfig, setAssetsDirConfig } from 'modules/assets/asset-registry.ts'

const TMP_ROOT = getTemporaryFolder(import.meta.url)

async function withTempDir(
  run: (root: string) => Promise<void>,
): Promise<void> {
  const root = await Deno.makeTempDir({ dir: TMP_ROOT })
  try {
    await run(root)
  } finally {
    await Deno.remove(root, { recursive: true })
  }
}

/** Same as {@linkcode withTempDir}, but rooted INSIDE this package's own directory
 * (`css-plugin.test.ts`'s own established convention) — real Tailwind processing needs
 * `@tailwindcss/vite`'s own directory-walk resolution to reach a real `node_modules/tailwindcss`,
 * which only exists by walking up from somewhere inside this project, never from an isolated OS
 * temp dir. `TMP_ROOT` (this file's own `__tmp__`, nested inside the project tree) already
 * satisfies that walk-up just as well, so both helpers share the same root. Only the
 * `tailwind: true` (default) test below needs this; every other test disables Tailwind
 * explicitly and stays a plain, isolated OS temp dir. */
async function withTempDirInProject(
  run: (root: string) => Promise<void>,
): Promise<void> {
  const root = await Deno.makeTempDir({ dir: TMP_ROOT })
  try {
    await run(root)
  } finally {
    await Deno.remove(root, { recursive: true })
  }
}

/** Every `.js` file directly under `dir`, in whatever order `Deno.readDir` yields. */
async function listJsFiles(dir: string): Promise<string[]> {
  const names: string[] = []
  for await (const entry of Deno.readDir(dir)) {
    if (entry.name.endsWith('.js')) names.push(entry.name)
  }
  return names
}

/** The single `.js` file directly under `dir` — throws (a real assertion failure via `find`
 * returning `undefined` would be a confusing non-null-assertion instead) if there isn't exactly
 * one, since every test that calls this already expects exactly one chunk. */
async function theOneJsFile(dir: string): Promise<string> {
  const files = await listJsFiles(dir)
  if (files.length !== 1) {
    throw new Error(`expected exactly one .js file, got: ${files.join(', ')}`)
  }
  return files[0]
}

Deno.test(
  'buildSpaceClient: builds a real comet as its own entry, writes comets-manifest.json, no duplicate chunk',
  async () => {
    await withTempDir(async (root) => {
      const cometPath = join(root, 'counter.tsx')
      await Deno.writeTextFile(
        cometPath,
        `'use comet'\nexport default function Counter() { return 'counter' }\n`,
      )

      const result = await buildSpaceClient({ root, css: { tailwind: false } })

      assertEquals(result.comets, [await Deno.realPath(cometPath)])

      const assetsDir = join(result.outDir, 'assets')
      // Exactly one chunk for the one comet — the real regression this covers: an earlier version
      // of `cometPlugin` force-emitted a SECOND, duplicate chunk for a file that was ALSO already
      // a real `rollupOptions.input` entry (confirmed empirically before `knownEntryPaths` fixed
      // it).
      const jsFile = await theOneJsFile(assetsDir)

      const manifest = JSON.parse(
        await Deno.readTextFile(join(result.outDir, 'comets-manifest.json')),
      )
      const realCometPath = await Deno.realPath(cometPath)
      assertEquals(manifest[realCometPath], `/assets/${jsFile}`)

      const code = await Deno.readTextFile(join(assetsDir, jsFile))
      assert(code.includes('counter'), code)
    })
  },
)

Deno.test(
  'buildSpaceClient: builds declared global CSS as a real entry and writes css-manifest.json',
  async () => {
    await withTempDir(async (root) => {
      await Deno.writeTextFile(
        join(root, 'reset.css'),
        '.reset { margin: 0; }\n',
      )

      const result = await buildSpaceClient({
        root,
        globalCss: ['./reset.css'],
        css: { tailwind: false },
      })

      const manifest = JSON.parse(
        await Deno.readTextFile(join(result.outDir, 'css-manifest.json')),
      )
      assertEquals(manifest.global.length, 1)
      const cssFile = join(result.outDir, manifest.global[0].replace(/^\//, ''))
      assert(
        (await Deno.readTextFile(cssFile)).includes('margin:0'),
        await Deno.readTextFile(cssFile),
      )
    })
  },
)

Deno.test(
  'buildSpaceClient: globalCss preserves DECLARATION order in css-manifest.json and threads a ' +
    "{href, media} entry's own media through — real regression coverage for the order bug (P2-12a)",
  async () => {
    await withTempDir(async (root) => {
      await Deno.writeTextFile(join(root, 'mobile.css'), '.m { color: red; }\n')
      await Deno.writeTextFile(join(root, 'base.css'), '.b { color: blue; }\n')
      await Deno.writeTextFile(join(root, 'extra.css'), '.e { color: green; }\n')

      const result = await buildSpaceClient({
        root,
        css: { tailwind: false },
        globalCss: [
          { href: './mobile.css', media: '(max-width: 599px)' },
          './base.css',
          './extra.css',
        ],
      })

      const manifest = JSON.parse(
        await Deno.readTextFile(join(result.outDir, 'css-manifest.json')),
      )
      assertEquals(manifest.global.length, 3)
      assert(
        typeof manifest.global[0] === 'object' && manifest.global[0].media === '(max-width: 599px)',
        JSON.stringify(manifest.global),
      )
      assert(manifest.global[0].href.includes('mobile'), JSON.stringify(manifest.global))
      assertEquals(typeof manifest.global[1], 'string')
      assert(manifest.global[1].includes('base'), JSON.stringify(manifest.global))
      assertEquals(typeof manifest.global[2], 'string')
      assert(manifest.global[2].includes('extra'), JSON.stringify(manifest.global))
    })
  },
)

Deno.test(
  "buildSpaceClient: discovers each page's own static styles (P2-12b), scopes them under " +
    "css-manifest.json's pages, keyed by the SAME filePath scanPageFiles/page-tree-registry.ts " +
    'use at request time, in declaration order, with media threaded through — real, end-to-end ' +
    'proof via the actual production build pipeline, two different pages never sharing CSS',
  async () => {
    await withTempDir(async (root) => {
      await Deno.mkdir(join(root, 'routes', 'products', '[id]'), { recursive: true })
      await Deno.mkdir(join(root, 'routes', 'about'), { recursive: true })
      await Deno.writeTextFile(
        join(root, 'routes', 'products', '[id]', 'product.css'),
        '.p { color: red; }\n',
      )
      await Deno.writeTextFile(
        join(root, 'routes', 'products', '[id]', 'product-mobile.css'),
        '.pm { color: blue; }\n',
      )
      await Deno.writeTextFile(
        join(root, 'routes', 'products', '[id]', 'page.tsx'),
        `export default class ProductPage {\n` +
          `  static styles = ['./product.css', { href: './product-mobile.css', media: '(max-width: 599px)' }]\n` +
          `}\n`,
      )
      await Deno.writeTextFile(
        join(root, 'routes', 'about', 'about.css'),
        '.ab { color: green; }\n',
      )
      await Deno.writeTextFile(
        join(root, 'routes', 'about', 'page.tsx'),
        `export default class AboutPage { static styles = ['./about.css'] }\n`,
      )

      const result = await buildSpaceClient({
        root,
        css: { tailwind: false },
        routesDir: join(root, 'routes'),
      })

      const manifest = JSON.parse(
        await Deno.readTextFile(join(result.outDir, 'css-manifest.json')),
      )
      const productKey = join(root, 'routes', 'products', '[id]', 'page.tsx')
      const aboutKey = join(root, 'routes', 'about', 'page.tsx')

      assert(manifest.pages, 'expected a pages scope in the manifest')
      assertEquals(manifest.pages[productKey].length, 2)
      // Declaration order: './product.css' (plain string) first, THEN the {href, media} entry —
      // matching the fixture's own `styles` array above, exactly (P2-12b's own order guarantee).
      assertEquals(typeof manifest.pages[productKey][0], 'string')
      assert(
        manifest.pages[productKey][0].includes('routes-products-_id_-product-') &&
          !manifest.pages[productKey][0].includes('mobile'),
        JSON.stringify(manifest.pages),
      )
      assert(
        typeof manifest.pages[productKey][1] === 'object' &&
          manifest.pages[productKey][1].media === '(max-width: 599px)',
        JSON.stringify(manifest.pages),
      )
      assert(
        manifest.pages[productKey][1].href.includes('product-mobile'),
        JSON.stringify(manifest.pages),
      )
      assertFalse(
        manifest.pages[productKey].some((ref: unknown) =>
          (typeof ref === 'string' ? ref : (ref as { href: string }).href).includes('about')
        ),
        JSON.stringify(manifest.pages),
      )

      assertEquals(manifest.pages[aboutKey].length, 1)
      assert(manifest.pages[aboutKey][0].includes('about'), JSON.stringify(manifest.pages))
      assertFalse(
        manifest.pages[aboutKey].some((ref: unknown) =>
          (typeof ref === 'string' ? ref : (ref as { href: string }).href).includes('product')
        ),
        JSON.stringify(manifest.pages),
      )
    })
  },
)

Deno.test(
  'buildSpaceClient: a page with no static styles contributes nothing — an app with zero ' +
    'page-level styles never writes a pages scope at all',
  async () => {
    await withTempDir(async (root) => {
      await Deno.mkdir(join(root, 'routes', 'home'), { recursive: true })
      await Deno.writeTextFile(
        join(root, 'routes', 'home', 'page.tsx'),
        `export default class HomePage {}\n`,
      )
      await Deno.writeTextFile(join(root, 'global.css'), '.app { margin: 0; }\n')

      const result = await buildSpaceClient({
        root,
        css: { tailwind: false },
        globalCss: ['./global.css'],
        routesDir: join(root, 'routes'),
      })

      const manifest = JSON.parse(
        await Deno.readTextFile(join(result.outDir, 'css-manifest.json')),
      )
      assertEquals(manifest.global.length, 1)
      assertEquals(manifest.pages, undefined)
    })
  },
)

Deno.test(
  'buildSpaceClient: zero comets and zero global CSS returns cleanly, no build attempted',
  async () => {
    await withTempDir(async (root) => {
      const result = await buildSpaceClient({ root, css: { tailwind: false } })
      assertEquals(result.comets, [])
      // No `dist/client` directory at all — the build was skipped entirely, not run empty.
      let exists = true
      try {
        await Deno.stat(result.outDir)
      } catch (error) {
        exists = !(error instanceof Deno.errors.NotFound)
      }
      assertEquals(exists, false)
    })
  },
)

Deno.test(
  "buildSpaceClient: an explicit renderer: 'preact' composes @preact/preset-vite instead of " +
    'react() — real regression coverage for the spacePlugin({ renderer }) forwarding, see ' +
    'space-plugin.test.ts for the plugin-name-level assertion this exercises end to end',
  async () => {
    await withTempDir(async (root) => {
      const cometPath = join(root, 'counter.tsx')
      await Deno.writeTextFile(
        cometPath,
        `'use comet'\nexport default function Counter() { return 'counter' }\n`,
      )

      // Must not throw — proves spacePlugin({ renderer: 'preact' }) composes cleanly into the
      // same real Vite build pipeline `buildSpaceClient` already exercises for React.
      const result = await buildSpaceClient({
        root,
        renderer: 'preact',
        css: { tailwind: false },
      })
      const assetsDir = join(result.outDir, 'assets')
      const jsFile = await theOneJsFile(assetsDir)
      const code = await Deno.readTextFile(join(assetsDir, jsFile))
      assert(code.includes('counter'), code)
    })
  },
)

Deno.test(
  'buildSpaceClient: omitting renderer defaults to getActiveRenderer() — the same eager flag ' +
    "defineSpaceApp({ renderer }) populates, not a hardcoded 'react'",
  async () => {
    try {
      setActiveRenderer('preact')
      await withTempDir(async (root) => {
        const cometPath = join(root, 'counter.tsx')
        await Deno.writeTextFile(
          cometPath,
          `'use comet'\nexport default function Counter() { return 'counter' }\n`,
        )

        // Must not throw — same real-build proof as above, this time via the DEFAULT rather than
        // an explicit override, with the active renderer flag set to 'preact' beforehand.
        const result = await buildSpaceClient({ root, css: { tailwind: false } })
        const assetsDir = join(result.outDir, 'assets')
        const jsFile = await theOneJsFile(assetsDir)
        const code = await Deno.readTextFile(join(assetsDir, jsFile))
        assert(code.includes('counter'), code)
      })
      assertEquals(getActiveRenderer(), 'preact')
    } finally {
      setActiveRenderer('react')
    }
  },
)

Deno.test('buildSpaceClient: minify defaults to true', async () => {
  await withTempDir(async (root) => {
    const cometPath = join(root, 'counter.tsx')
    await Deno.writeTextFile(
      cometPath,
      `'use comet'\nexport default function Counter() {\n  const veryLongLocalVariableName = 1\n  return veryLongLocalVariableName\n}\n`,
    )

    const result = await buildSpaceClient({ root, css: { tailwind: false } })
    const assetsDir = join(result.outDir, 'assets')
    const jsFile = await theOneJsFile(assetsDir)
    const code = await Deno.readTextFile(join(assetsDir, jsFile))
    assert(
      !code.includes('veryLongLocalVariableName'),
      'minified output should not keep the original long identifier name',
    )
  })
})

Deno.test('buildSpaceClient: minify: false keeps real, readable (multi-line) output', async () => {
  await withTempDir(async (root) => {
    const cometPath = join(root, 'counter.tsx')
    await Deno.writeTextFile(
      cometPath,
      `'use comet'\nexport default function Counter() {\n  return 1\n}\n`,
    )

    const minified = await buildSpaceClient({
      root,
      outDir: 'dist/minified',
      css: { tailwind: false },
    })
    const unminified = await buildSpaceClient({
      root,
      outDir: 'dist/unminified',
      css: { tailwind: false },
      minify: false,
    })

    const readCode = async (result: typeof minified) => {
      const assetsDir = join(result.outDir, 'assets')
      const jsFile = await theOneJsFile(assetsDir)
      return await Deno.readTextFile(join(assetsDir, jsFile))
    }

    const minifiedCode = await readCode(minified)
    const unminifiedCode = await readCode(unminified)

    // Real evidence of the difference `minify` actually makes — not comparing byte-for-byte
    // content (Rolldown's own transform step does basic constant-folding regardless of `minify`),
    // but the one thing genuinely distinct between the two: real, multi-line formatting survives
    // only when minification is off.
    assert(
      unminifiedCode.split('\n').length > minifiedCode.split('\n').length,
      JSON.stringify({ minifiedCode, unminifiedCode }),
    )
    assert(unminifiedCode.includes('function Counter'), unminifiedCode)
  })
})

Deno.test(
  'buildSpaceClient: two comets sharing the same basename in different folders never collide',
  async () => {
    await withTempDir(async (root) => {
      await Deno.mkdir(join(root, 'a'), { recursive: true })
      await Deno.mkdir(join(root, 'b'), { recursive: true })
      const first = join(root, 'a', 'counter.tsx')
      const second = join(root, 'b', 'counter.tsx')
      await Deno.writeTextFile(
        first,
        `'use comet'\nexport default function A() { return 'from-a' }\n`,
      )
      await Deno.writeTextFile(
        second,
        `'use comet'\nexport default function B() { return 'from-b' }\n`,
      )

      const result = await buildSpaceClient({ root, css: { tailwind: false } })
      assertEquals(result.comets.length, 2)

      const assetsDir = join(result.outDir, 'assets')
      const jsFiles = await listJsFiles(assetsDir)
      assertEquals(jsFiles.length, 2, jsFiles.join(', '))

      const allCode = (await Promise.all(
        jsFiles.map((name) => Deno.readTextFile(join(assetsDir, name))),
      )).join('\n')
      assert(allCode.includes('from-a'), allCode)
      assert(allCode.includes('from-b'), allCode)
    })
  },
)

Deno.test(
  'buildSpaceClient: real Tailwind processing (the tailwind:true default) produces real utility CSS',
  async () => {
    await withTempDirInProject(async (root) => {
      await Deno.writeTextFile(
        join(root, 'app.css'),
        '@import "tailwindcss";\n',
      )
      await Deno.writeTextFile(
        join(root, 'counter.tsx'),
        `'use comet'\nexport default function Counter() { return { className: 'text-red-500' } }\n`,
      )

      // No `css` option at all — exercises the real default (`tailwind: true`), which every
      // other test in this file deliberately avoids. Confirmed empirically NOT to hit the
      // Lightning CSS/Deno native-binding crash `dev-engine.ts`'s own doc documents for the DEV
      // server path — that's specific to `createServer()`'s own default CSS transformer, and does
      // not apply to a real production `build()`.
      const result = await buildSpaceClient({ root, globalCss: ['./app.css'] })

      const manifest = JSON.parse(
        await Deno.readTextFile(join(result.outDir, 'css-manifest.json')),
      )
      assertEquals(manifest.global.length, 1)
      const cssContent = await Deno.readTextFile(
        join(result.outDir, (manifest.global[0] as string).replace(/^\//, '')),
      )
      // Real evidence of real Tailwind utility generation, not just passthrough CSS — a plain
      // `@import "tailwindcss";` alone contains no `color` declaration at all.
      assert(cssContent.includes('color'), cssContent)
    })
  },
)

Deno.test(
  "buildSpaceClient: with globalCss omitted, defaults to getGlobalCssPaths() — a single app's " +
    'own defineSpaceApp()-declared stylesheet reaches the production build with no explicit option',
  async () => {
    await withTempDir(async (root) => {
      await Deno.writeTextFile(join(root, 'app.css'), '.app { margin: 0; }\n')
      try {
        // Stands in for `defineSpaceApp({ globalCss: ['./app.css'] })` having already run.
        addGlobalCssPaths(['./app.css'])

        const result = await buildSpaceClient({
          root,
          css: { tailwind: false },
        })

        const manifest = JSON.parse(
          await Deno.readTextFile(join(result.outDir, 'css-manifest.json')),
        )
        assertEquals(manifest.global.length, 1)
        const cssContent = await Deno.readTextFile(
          join(result.outDir, (manifest.global[0] as string).replace(/^\//, '')),
        )
        assert(cssContent.includes('margin:0'), cssContent)
      } finally {
        setGlobalCssPaths(undefined)
      }
    })
  },
)

Deno.test(
  'buildSpaceClient: with globalCss omitted, a COMPOSED base+host globalCss (via ' +
    "addGlobalCssPaths) reaches the production build — neither app's own file is dropped",
  async () => {
    await withTempDir(async (root) => {
      await Deno.writeTextFile(
        join(root, 'base.css'),
        '.base { margin: 0; }\n',
      )
      await Deno.writeTextFile(
        join(root, 'custom.css'),
        '.custom { padding: 0; }\n',
      )
      try {
        // The base app's own `defineSpaceApp()` call, then the host's own, composed in order.
        addGlobalCssPaths(['./base.css'])
        addGlobalCssPaths(['./custom.css'])

        const result = await buildSpaceClient({
          root,
          css: { tailwind: false },
        })

        const manifest = JSON.parse(
          await Deno.readTextFile(join(result.outDir, 'css-manifest.json')),
        )
        assertEquals(
          manifest.global.length,
          2,
          "both the base app's and the host's own sheet must build",
        )

        const allCss = (await Promise.all(
          (manifest.global as string[]).map((href) =>
            Deno.readTextFile(join(result.outDir, href.replace(/^\//, '')))
          ),
        )).join('\n')
        assert(allCss.includes('margin:0'), allCss)
        assert(allCss.includes('padding:0'), allCss)
      } finally {
        setGlobalCssPaths(undefined)
      }
    })
  },
)

Deno.test(
  'buildSpaceClient: an explicit globalCss option still wins over getGlobalCssPaths() — the ' +
    'default only applies when the option is omitted entirely',
  async () => {
    await withTempDir(async (root) => {
      await Deno.writeTextFile(
        join(root, 'composed.css'),
        '.composed { margin: 0; }\n',
      )
      await Deno.writeTextFile(
        join(root, 'explicit.css'),
        '.explicit { padding: 0; }\n',
      )
      try {
        addGlobalCssPaths(['./composed.css'])

        const result = await buildSpaceClient({
          root,
          globalCss: ['./explicit.css'],
          css: { tailwind: false },
        })

        const manifest = JSON.parse(
          await Deno.readTextFile(join(result.outDir, 'css-manifest.json')),
        )
        assertEquals(manifest.global.length, 1)
        const cssContent = await Deno.readTextFile(
          join(result.outDir, (manifest.global[0] as string).replace(/^\//, '')),
        )
        assert(cssContent.includes('padding:0'), cssContent)
        assert(!cssContent.includes('margin:0'), cssContent)
      } finally {
        setGlobalCssPaths(undefined)
      }
    })
  },
)

Deno.test(
  'buildSpaceClient: pwa (author-facing PwaConfig) resolves internally into real icons + sw.js — no separate plugin config',
  async () => {
    await withTempDir(async (root) => {
      const sourcePath = join(root, 'icon-source.png')
      const source = await sharp({
        create: {
          width: 512,
          height: 512,
          channels: 4,
          background: { r: 1, g: 2, b: 3, alpha: 1 },
        },
      }).png().toBuffer()
      await Deno.writeFile(sourcePath, source)

      const result = await buildSpaceClient({
        root,
        css: { tailwind: false },
        pwa: {
          name: 'Storefront',
          icon: './icon-source.png',
          iconSizes: [192],
        },
      })

      const icon192 = join(result.outDir, 'icons', iconFileName(192))
      const metadata = await sharp(await Deno.readFile(icon192)).metadata()
      assertEquals(metadata.width, 192)
      assertEquals(metadata.height, 192)

      const swExists = await Deno.stat(join(result.outDir, SW_FILE_NAME)).then(
        () => true,
      ).catch(
        () => false,
      )
      assert(
        swExists,
        'expected a real sw.js written to the client build output',
      )
    })
  },
)

Deno.test(
  'buildSpaceClient: an explicit assetsDir option hashes real files and writes assets-manifest.json',
  async () => {
    await withTempDir(async (root) => {
      const assetsDir = join(root, 'assets-src')
      await Deno.mkdir(assetsDir, { recursive: true })
      await Deno.writeTextFile(join(assetsDir, 'logo.svg'), '<svg>base</svg>')

      const result = await buildSpaceClient({
        root,
        css: { tailwind: false },
        assetsDir,
      })

      const manifest = JSON.parse(
        await Deno.readTextFile(join(result.outDir, 'assets-manifest.json')),
      )
      assert(/^\/assets\/logo-[\w-]+\.svg$/.test(manifest['logo.svg']), manifest['logo.svg'])
      const builtContent = await Deno.readTextFile(
        join(result.outDir, (manifest['logo.svg'] as string).replace(/^\//, '')),
      )
      assertEquals(builtContent, '<svg>base</svg>')
    })
  },
)

Deno.test(
  "buildSpaceClient: with assetsDir omitted, defaults to getAssetsDirConfig() — a single app's " +
    'own defineSpaceApp({ assetsDir }) reaches the production build with no explicit option',
  async () => {
    await withTempDir(async (root) => {
      const assetsDir = join(root, 'assets-src')
      await Deno.mkdir(assetsDir, { recursive: true })
      await Deno.writeTextFile(join(assetsDir, 'logo.svg'), '<svg>eager-default</svg>')
      try {
        // Stands in for `defineSpaceApp({ assetsDir })` having already run.
        setAssetsDirConfig(assetsDir)

        const result = await buildSpaceClient({ root, css: { tailwind: false } })

        const manifest = JSON.parse(
          await Deno.readTextFile(join(result.outDir, 'assets-manifest.json')),
        )
        assert('logo.svg' in manifest, JSON.stringify(manifest))
      } finally {
        resetAssetsDirConfig()
      }
    })
  },
)

Deno.test(
  'buildSpaceClient: an app with only assetsDir configured (no comets, no globalCss, no pwa) ' +
    'still runs a real build — assetsPlugin needs a real Rollup build to emit anything at all',
  async () => {
    await withTempDir(async (root) => {
      const assetsDir = join(root, 'assets-src')
      await Deno.mkdir(assetsDir, { recursive: true })
      await Deno.writeTextFile(join(assetsDir, 'logo.svg'), '<svg>assets-only</svg>')

      const result = await buildSpaceClient({
        root,
        css: { tailwind: false },
        assetsDir,
      })

      const manifestExists = await Deno.stat(join(result.outDir, 'assets-manifest.json'))
        .then(() => true)
        .catch(() => false)
      assert(manifestExists, 'expected a real assets-manifest.json even with no other entries')
    })
  },
)

Deno.test(
  'buildSpaceClient: with assetsDir omitted entirely and never configured, no assets-manifest.json ' +
    'is written at all — an app that never opts in pays nothing',
  async () => {
    await withTempDir(async (root) => {
      resetAssetsDirConfig()
      await Deno.writeTextFile(join(root, 'app.css'), '.app { margin: 0; }\n')
      addGlobalCssPaths(['./app.css'])
      try {
        const result = await buildSpaceClient({ root, css: { tailwind: false } })

        const manifestExists = await Deno.stat(join(result.outDir, 'assets-manifest.json'))
          .then(() => true)
          .catch(() => false)
        assert(!manifestExists, 'expected no assets-manifest.json when assetsDir was never set')
      } finally {
        setGlobalCssPaths(undefined)
      }
    })
  },
)
