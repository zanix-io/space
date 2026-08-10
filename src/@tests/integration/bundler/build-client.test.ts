import { assert, assertEquals } from '@std/assert'
import { join } from '@std/path'
import sharp from 'sharp'
import { buildSpaceClient } from 'modules/bundler/build-client.ts'
import { iconFileName } from 'modules/pwa/icon-naming.ts'
import { SW_FILE_NAME } from 'modules/bundler/pwa-plugin.ts'

async function withTempDir(run: (root: string) => Promise<void>): Promise<void> {
  const root = await Deno.makeTempDir()
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
 * temp dir. Only the `tailwind: true` (default) test below needs this; every other test disables
 * Tailwind explicitly and stays a plain, isolated OS temp dir. */
async function withTempDirInProject(run: (root: string) => Promise<void>): Promise<void> {
  const root = await Deno.makeTempDir({ dir: Deno.cwd() })
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
  if (files.length !== 1) throw new Error(`expected exactly one .js file, got: ${files.join(', ')}`)
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
      await Deno.writeTextFile(join(root, 'reset.css'), '.reset { margin: 0; }\n')

      const result = await buildSpaceClient({
        root,
        globalCss: ['./reset.css'],
        css: { tailwind: false },
      })

      const manifest = JSON.parse(await Deno.readTextFile(join(result.outDir, 'css-manifest.json')))
      assertEquals(manifest.length, 1)
      const cssFile = join(result.outDir, manifest[0].replace(/^\//, ''))
      assert(
        (await Deno.readTextFile(cssFile)).includes('margin:0'),
        await Deno.readTextFile(cssFile),
      )
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
      await Deno.writeTextFile(join(root, 'app.css'), '@import "tailwindcss";\n')
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

      const manifest = JSON.parse(await Deno.readTextFile(join(result.outDir, 'css-manifest.json')))
      assertEquals(manifest.length, 1)
      const cssContent = await Deno.readTextFile(
        join(result.outDir, (manifest[0] as string).replace(/^\//, '')),
      )
      // Real evidence of real Tailwind utility generation, not just passthrough CSS — a plain
      // `@import "tailwindcss";` alone contains no `color` declaration at all.
      assert(cssContent.includes('color'), cssContent)
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
        pwa: { name: 'Storefront', icon: './icon-source.png', iconSizes: [192] },
      })

      const icon192 = join(result.outDir, 'icons', iconFileName(192))
      const metadata = await sharp(await Deno.readFile(icon192)).metadata()
      assertEquals(metadata.width, 192)
      assertEquals(metadata.height, 192)

      const swExists = await Deno.stat(join(result.outDir, SW_FILE_NAME)).then(() => true).catch(
        () => false,
      )
      assert(swExists, 'expected a real sw.js written to the client build output')
    })
  },
)
