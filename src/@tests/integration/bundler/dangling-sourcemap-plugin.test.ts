import { assert, assertEquals } from '@std/assert'
import { join } from '@std/path'
import { getTemporaryFolder } from '@zanix/helpers'
import { danglingSourcemapPlugin } from 'modules/bundler/dangling-sourcemap-plugin.ts'
import { createSpaceDevEngine } from 'modules/bundler/dev-engine.ts'

const TMP_ROOT = getTemporaryFolder(import.meta.url)

const SOURCE = `export const marker = 'dep'\n`
const isRouteEntry = (id: string) => id.endsWith('/page.tsx')

type LoadHook = (id: string) => Promise<{ code: string; map: null } | null>

async function withTempRoot(run: (root: string) => Promise<void>): Promise<void> {
  const root = await Deno.makeTempDir({ dir: TMP_ROOT })
  try {
    await run(root)
  } finally {
    await Deno.remove(root, { recursive: true })
  }
}

async function writeDependency(root: string, name: string, content: string): Promise<string> {
  const dir = join(root, 'node_modules', 'dep')
  await Deno.mkdir(dir, { recursive: true })
  const file = join(dir, name)
  await Deno.writeTextFile(file, content)
  return file
}

const load = danglingSourcemapPlugin().load as unknown as LoadHook

Deno.test('danglingSourcemapPlugin: strips a comment whose map file is missing', async () => {
  await withTempRoot(async (root) => {
    const file = await writeDependency(
      root,
      'index.mjs',
      `${SOURCE}//# sourceMappingURL=index_mjs.js.map\n`,
    )
    const result = await load(file)
    assertEquals(result?.code, `${SOURCE}\n`)
    assertEquals(result?.map, null)
  })
})

Deno.test('danglingSourcemapPlugin: ignores a module id query', async () => {
  await withTempRoot(async (root) => {
    const file = await writeDependency(root, 'index.mjs', `${SOURCE}//# sourceMappingURL=x.map\n`)
    assert((await load(`${file}?v=abc`))?.code.includes('sourceMappingURL') === false)
  })
})

Deno.test('danglingSourcemapPlugin: leaves a comment whose map file exists', async () => {
  await withTempRoot(async (root) => {
    const file = await writeDependency(root, 'index.mjs', `${SOURCE}//# sourceMappingURL=i.map\n`)
    await writeDependency(root, 'i.map', '{}')
    assertEquals(await load(file), null)
  })
})

Deno.test('danglingSourcemapPlugin: leaves an inline data: map', async () => {
  await withTempRoot(async (root) => {
    const file = await writeDependency(
      root,
      'index.mjs',
      `${SOURCE}//# sourceMappingURL=data:application/json;base64,e30=\n`,
    )
    assertEquals(await load(file), null)
  })
})

Deno.test('danglingSourcemapPlugin: leaves a script with no comment', async () => {
  await withTempRoot(async (root) => {
    assertEquals(await load(await writeDependency(root, 'index.mjs', SOURCE)), null)
  })
})

Deno.test('danglingSourcemapPlugin: leaves a file outside node_modules', async () => {
  await withTempRoot(async (root) => {
    const file = join(root, 'own.mjs')
    await Deno.writeTextFile(file, `${SOURCE}//# sourceMappingURL=missing.map\n`)
    assertEquals(await load(file), null)
  })
})

Deno.test('danglingSourcemapPlugin: ignores non-script files and non-file ids', async () => {
  await withTempRoot(async (root) => {
    const css = await writeDependency(root, 'a.css', `a{}\n/*# sourceMappingURL=a.css.map */\n`)
    assertEquals(await load(css), null)
    assertEquals(await load('\0virtual:x'), null)
    assertEquals(await load(join(root, 'node_modules', 'dep', 'gone.mjs')), null)
  })
})

Deno.test(
  'createSpaceDevEngine: a dependency with a dangling sourcemap loads without a Vite warning',
  async () => {
    await withTempRoot(async (root) => {
      await writeDependency(
        root,
        'index.mjs',
        `${SOURCE}//# sourceMappingURL=index_mjs.js.map\n`,
      )
      await Deno.writeTextFile(
        join(root, 'page.tsx'),
        `export { marker } from './node_modules/dep/index.mjs'\n`,
      )

      const warnings: string[] = []
      const originalWarn = console.warn
      console.warn = (...args: unknown[]) => {
        warnings.push(args.map(String).join(' '))
      }
      const engine = await createSpaceDevEngine({ root, isRouteEntry })
      try {
        const mod = await engine.ssrLoadModule('/page.tsx')
        assertEquals(mod.marker, 'dep')
      } finally {
        console.warn = originalWarn
        await engine.close()
      }
      assertEquals(warnings.filter((w) => w.includes('Failed to load source map')), [])
    })
  },
)
