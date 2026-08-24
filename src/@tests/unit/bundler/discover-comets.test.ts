import { assertEquals, assertRejects } from '@std/assert'
import { join } from '@std/path'
import { getTemporaryFolder } from '@zanix/helpers'
import { InternalError } from '@zanix/errors'
import { discoverComets } from 'modules/bundler/discover-comets.ts'

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
