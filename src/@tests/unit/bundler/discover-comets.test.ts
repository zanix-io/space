import { assertEquals, assertRejects } from '@std/assert'
import { join } from '@std/path'
import { getTemporaryFolder } from '@zanix/helpers'
import { InternalError } from '@zanix/errors'
import {
  discoverComets,
  discoverUsedCometImports,
  findCandidatesInFile,
  findReExport,
  parseClause,
} from 'modules/bundler/discover-comets.ts'

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

Deno.test("discoverComets: finds a file marked 'use comet', wherever it lives", async () => {
  await withTempDir(async (root) => {
    await Deno.mkdir(join(root, 'nested', 'deep'), { recursive: true })
    const cometPath = join(root, 'nested', 'deep', 'counter.tsx')
    await Deno.writeTextFile(
      cometPath,
      `'use comet'\nexport default function Counter() {}\n`,
    )

    const found = await discoverComets(root)
    assertEquals(found, [await Deno.realPath(cometPath)])
  })
})

Deno.test('discoverComets: a file with no directive is not a comet', async () => {
  await withTempDir(async (root) => {
    await Deno.writeTextFile(
      join(root, 'plain.tsx'),
      `export default function Plain() {}\n`,
    )
    assertEquals(await discoverComets(root), [])
  })
})

Deno.test('discoverComets: skips node_modules/dist/.vite entirely', async () => {
  await withTempDir(async (root) => {
    await Promise.all(
      ['node_modules', 'dist', '.dist', '.vite', '.git'].map(async (dir) => {
        await Deno.mkdir(join(root, dir), { recursive: true })
        await Deno.writeTextFile(
          join(root, dir, 'fake.tsx'),
          `'use comet'\nexport default function Fake() {}\n`,
        )
      }),
    )
    assertEquals(await discoverComets(root), [])
  })
})

Deno.test('discoverComets: ignores a non-source extension, directive text or not', async () => {
  await withTempDir(async (root) => {
    await Deno.writeTextFile(
      join(root, 'notes.md'),
      `'use comet'\nnot actually code\n`,
    )
    assertEquals(await discoverComets(root), [])
  })
})

Deno.test('discoverComets: finds every comet across multiple independent branches', async () => {
  await withTempDir(async (root) => {
    await Deno.mkdir(join(root, 'a'), { recursive: true })
    await Deno.mkdir(join(root, 'b'), { recursive: true })
    const first = join(root, 'a', 'one.tsx')
    const second = join(root, 'b', 'two.tsx')
    await Deno.writeTextFile(
      first,
      `'use comet'\nexport default function One() {}\n`,
    )
    await Deno.writeTextFile(
      second,
      `"use comet"\nexport default function Two() {}\n`,
    )

    const found = await discoverComets(root)
    assertEquals(
      found.sort(),
      [await Deno.realPath(first), await Deno.realPath(second)].sort(),
    )
  })
})

Deno.test('discoverComets: a missing root is zero comets, not an error', async () => {
  const missing = await Deno.makeTempDir({ dir: TMP_ROOT })
  await Deno.remove(missing)
  assertEquals(await discoverComets(missing), [])
})

/**
 * Regression coverage: `discoverComets`'s own `visit()` used to rethrow a non-`NotFound` error
 * completely raw. Build-time-only (never runs per-request), so this proves the shared
 * `InternalError` class specifically — not `code`/`userMessage`, which the real exemption
 * (`WebServerManager`'s own `readSslFile`) deliberately skips for a boot/build-time-only failure.
 * `Deno.readDir()` on a path that is actually a FILE (not `NotFound`) is a real, deterministic,
 * cross-platform way to trigger `Deno.errors.NotADirectory`.
 */
Deno.test(
  'discoverComets: a non-NotFound native read failure (e.g. root is actually a file) is wrapped into InternalError, never rethrown raw',
  async () => {
    const dir = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      const notADir = join(dir, 'actually-a-file')
      await Deno.writeTextFile(notADir, 'x')
      const error = await assertRejects(() => discoverComets(notADir), InternalError)
      assertEquals(error.cause instanceof Deno.errors.NotADirectory, true)
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
)

Deno.test('parseClause: a bare name maps to itself as both source and local', () => {
  assertEquals(parseClause('SubmitGuard'), [{ source: 'SubmitGuard', local: 'SubmitGuard' }])
})

Deno.test('parseClause: an aliased name keeps the source/local distinction', () => {
  assertEquals(parseClause('Widget as MyWidget'), [{ source: 'Widget', local: 'MyWidget' }])
})

Deno.test('parseClause: several names, some aliased, some not, in one clause', () => {
  assertEquals(
    parseClause('A, B as C,  D  '),
    [
      { source: 'A', local: 'A' },
      { source: 'B', local: 'C' },
      { source: 'D', local: 'D' },
    ],
  )
})

Deno.test(
  'findCandidatesInFile: a named import from a bare specifier, rendered as JSX, is a candidate',
  () => {
    const found = findCandidatesInFile(
      "import { SubmitGuard } from '@zanix/space/comet/react'\n" +
        "export default function Layout() { return <SubmitGuard formId='logout' /> }\n",
      '/app/layout.tsx',
    )
    assertEquals(found, [
      {
        specifier: '@zanix/space/comet/react',
        exportedName: 'SubmitGuard',
        referrerFile: '/app/layout.tsx',
      },
    ])
  },
)

Deno.test(
  'findCandidatesInFile: an aliased import is matched by its LOCAL name in JSX, reported under its own source name',
  () => {
    const found = findCandidatesInFile(
      "import { Widget as MyWidget } from 'some-pkg'\n" +
        'export default function Layout() { return <MyWidget /> }\n',
      '/app/layout.tsx',
    )
    assertEquals(found, [
      { specifier: 'some-pkg', exportedName: 'Widget', referrerFile: '/app/layout.tsx' },
    ])
  },
)

Deno.test(
  'findCandidatesInFile: a named import never rendered as JSX anywhere in the file is not a candidate',
  () => {
    const found = findCandidatesInFile(
      "import { unusedHelper } from 'some-pkg'\nexport default function Layout() { return null }\n",
      '/app/layout.tsx',
    )
    assertEquals(found, [])
  },
)

Deno.test(
  'findCandidatesInFile: a relative specifier is never a candidate, JSX-rendered or not — only ' +
    "a package's own real published source ever carries a 'use comet' directive worth resolving",
  () => {
    const found = findCandidatesInFile(
      "import { Widget } from './my-own-widget.tsx'\n" +
        'export default function Layout() { return <Widget /> }\n',
      '/app/layout.tsx',
    )
    assertEquals(found, [])
  },
)

Deno.test('findReExport: matches a plain re-export by its own local name', () => {
  assertEquals(
    findReExport("export { Widget } from './internal.ts'\n", 'Widget'),
    { specifier: './internal.ts', source: 'Widget' },
  )
})

Deno.test('findReExport: matches an ALIASED re-export by its local (not source) name', () => {
  assertEquals(
    findReExport("export { Impl as Widget } from './internal.ts'\n", 'Widget'),
    { specifier: './internal.ts', source: 'Impl' },
  )
})

Deno.test('findReExport: no matching clause at all returns null', () => {
  assertEquals(findReExport("export { Other } from './internal.ts'\n", 'Widget'), null)
})

Deno.test(
  "discoverUsedCometImports: follows a bare specifier aliased through deno.json's own import " +
    "map down through its package's own relative re-export barrel to the real comet file",
  async () => {
    await withTempDir(async (root) => {
      const vendorDir = join(root, 'vendor')
      await Deno.mkdir(vendorDir, { recursive: true })
      const internalPath = join(vendorDir, 'internal.ts')
      await Deno.writeTextFile(
        internalPath,
        `'use comet'\nexport function Widget() { return null }\n`,
      )
      await Deno.writeTextFile(
        join(vendorDir, 'index.ts'),
        `export { Widget } from './internal.ts'\n`,
      )
      await Deno.writeTextFile(
        join(root, 'deno.json'),
        JSON.stringify({ imports: { 'vendor-pkg': join(vendorDir, 'index.ts') } }),
      )
      const routesDir = join(root, 'routes')
      await Deno.mkdir(routesDir, { recursive: true })
      await Deno.writeTextFile(
        join(routesDir, 'layout.tsx'),
        "import { Widget } from 'vendor-pkg'\n" +
          'export default function Layout() { return <Widget /> }\n',
      )

      const found = await discoverUsedCometImports(root)
      assertEquals(found, new Set([await Deno.realPath(internalPath)]))
    })
  },
)

Deno.test(
  'discoverUsedCometImports: a bare specifier whose resolved package carries no ' +
    "'use comet' directive anywhere along its re-export chain contributes nothing, no throw",
  async () => {
    await withTempDir(async (root) => {
      const vendorDir = join(root, 'vendor')
      await Deno.mkdir(vendorDir, { recursive: true })
      await Deno.writeTextFile(
        join(vendorDir, 'index.ts'),
        `export function PlainUtil() { return null }\n`,
      )
      await Deno.writeTextFile(
        join(root, 'deno.json'),
        JSON.stringify({ imports: { 'vendor-pkg': join(vendorDir, 'index.ts') } }),
      )
      await Deno.writeTextFile(
        join(root, 'layout.tsx'),
        "import { PlainUtil } from 'vendor-pkg'\n" +
          'export default function Layout() { return <PlainUtil /> }\n',
      )

      assertEquals(await discoverUsedCometImports(root), new Set())
    })
  },
)

Deno.test(
  'discoverUsedCometImports: an import from a bare specifier never resolved by any import map ' +
    'is a dead end, not a crash',
  async () => {
    await withTempDir(async (root) => {
      await Deno.writeTextFile(
        join(root, 'layout.tsx'),
        "import { Widget } from 'never-declared-anywhere'\n" +
          'export default function Layout() { return <Widget /> }\n',
      )
      assertEquals(await discoverUsedCometImports(root), new Set())
    })
  },
)

Deno.test(
  'discoverUsedCometImports: nothing imported anywhere, or nothing rendered as JSX, resolves to an empty set',
  async () => {
    await withTempDir(async (root) => {
      await Deno.writeTextFile(
        join(root, 'plain.tsx'),
        'export default function Plain() { return null }\n',
      )
      assertEquals(await discoverUsedCometImports(root), new Set())
    })
  },
)

Deno.test(
  'discoverUsedCometImports: the SAME real comet imported from two independent files resolves ' +
    'to one single entry, not a duplicate',
  async () => {
    await withTempDir(async (root) => {
      const vendorDir = join(root, 'vendor')
      await Deno.mkdir(vendorDir, { recursive: true })
      const internalPath = join(vendorDir, 'index.ts')
      await Deno.writeTextFile(
        internalPath,
        `'use comet'\nexport function Widget() { return null }\n`,
      )
      await Deno.writeTextFile(
        join(root, 'deno.json'),
        JSON.stringify({ imports: { 'vendor-pkg': internalPath } }),
      )
      await Deno.writeTextFile(
        join(root, 'layout.tsx'),
        "import { Widget } from 'vendor-pkg'\n" +
          'export default function Layout() { return <Widget /> }\n',
      )
      await Deno.writeTextFile(
        join(root, 'form.tsx'),
        "import { Widget } from 'vendor-pkg'\n" +
          'export default function Form() { return <Widget /> }\n',
      )

      const found = await discoverUsedCometImports(root)
      assertEquals(found, new Set([await Deno.realPath(internalPath)]))
    })
  },
)

Deno.test(
  'discoverUsedCometImports: a re-export CYCLE (A re-exports from B, B re-exports back from A) ' +
    'terminates via the visited-hop guard instead of looping forever',
  async () => {
    await withTempDir(async (root) => {
      const pkgA = join(root, 'a.ts')
      const pkgB = join(root, 'b.ts')
      await Deno.writeTextFile(pkgA, `export { X as X } from './b.ts'\n`)
      await Deno.writeTextFile(pkgB, `export { X as X } from './a.ts'\n`)
      await Deno.writeTextFile(
        join(root, 'deno.json'),
        JSON.stringify({ imports: { 'cyclic-pkg': pkgA } }),
      )
      await Deno.writeTextFile(
        join(root, 'layout.tsx'),
        "import { X } from 'cyclic-pkg'\nexport default function Layout() { return <X /> }\n",
      )

      assertEquals(await discoverUsedCometImports(root), new Set())
    })
  },
)

Deno.test(
  'discoverUsedCometImports: a re-export chain longer than the depth bound never reaches its own ' +
    "real 'use comet' file — the bound is real, not merely theoretical",
  async () => {
    await withTempDir(async (root) => {
      const hopPaths = Array.from({ length: 6 }, (_, i) => join(root, `hop${i}.ts`))
      await Promise.all(
        Array.from(
          { length: 5 },
          (_, i) => Deno.writeTextFile(hopPaths[i], `export { X as X } from './hop${i + 1}.ts'\n`),
        ),
      )
      await Deno.writeTextFile(hopPaths[5], `'use comet'\nexport function X() { return null }\n`)
      await Deno.writeTextFile(
        join(root, 'deno.json'),
        JSON.stringify({ imports: { 'deep-pkg': hopPaths[0] } }),
      )
      await Deno.writeTextFile(
        join(root, 'layout.tsx'),
        "import { X } from 'deep-pkg'\nexport default function Layout() { return <X /> }\n",
      )

      assertEquals(await discoverUsedCometImports(root), new Set())
    })
  },
)
