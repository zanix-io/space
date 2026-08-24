import { assert, assertEquals, assertRejects } from '@std/assert'
import { dirname, join } from '@std/path'
import { getTemporaryFolder } from '@zanix/helpers'
import { InternalError } from '@zanix/errors'
import { scanAssets } from 'modules/assets/scan-assets.ts'

const TMP_ROOT = getTemporaryFolder(import.meta.url)

async function withTempDir(
  build: (dir: string) => Promise<void>,
): Promise<string> {
  const dir = await Deno.makeTempDir({ dir: TMP_ROOT })
  await build(dir)
  return dir
}

async function touch(path: string, content = 'x'): Promise<void> {
  await Deno.mkdir(dirname(path), { recursive: true })
  await Deno.writeTextFile(path, content)
}

async function cleanup(...dirs: string[]): Promise<void> {
  await Promise.all(dirs.map((dir) => Deno.remove(dir, { recursive: true })))
}

Deno.test({
  name: 'scanAssets: finds a root-level file with its own name as the relative path',
  fn: async () => {
    const dir = await withTempDir(async (dir) => {
      await touch(join(dir, 'logo.svg'))
    })
    try {
      const resolved = await scanAssets(dir)
      assertEquals(resolved.size, 1)
      assertEquals(resolved.get('logo.svg'), join(dir, 'logo.svg'))
    } finally {
      await cleanup(dir)
    }
  },
})

Deno.test('scanAssets: finds nested files, relative path joined with /', async () => {
  const dir = await withTempDir(async (dir) => {
    await touch(join(dir, 'icons', 'favicon.png'))
  })
  try {
    const resolved = await scanAssets(dir)
    assertEquals(
      resolved.get('icons/favicon.png'),
      join(dir, 'icons', 'favicon.png'),
    )
  } finally {
    await cleanup(dir)
  }
})

Deno.test('scanAssets: a missing directory contributes zero assets, not an error', async () => {
  const resolved = await scanAssets('./this-assets-dir-does-not-exist')
  assertEquals(resolved.size, 0)
})

/**
 * Regression coverage: `walkOneAssetsDir`'s own `walk()` used to rethrow a non-`NotFound` error
 * completely raw. Build/composition-time-only (never runs per-request), so this proves the
 * shared `InternalError` class specifically — not `code`/`userMessage`, which the real exemption
 * (`WebServerManager`'s own `readSslFile`) deliberately skips for a boot/build-time-only failure.
 * `Deno.readDir()` on a path that is actually a FILE (not `NotFound`) is a real, deterministic,
 * cross-platform way to trigger `Deno.errors.NotADirectory`.
 */
Deno.test(
  'scanAssets: a non-NotFound native read failure (e.g. assetsDir is actually a file) is wrapped into InternalError, never rethrown raw',
  async () => {
    const dir = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      const notADir = join(dir, 'actually-a-file')
      await Deno.writeTextFile(notADir, 'x')
      const error = await assertRejects(() => scanAssets(notADir), InternalError)
      assertEquals(error.cause instanceof Deno.errors.NotADirectory, true)
    } finally {
      await cleanup(dir)
    }
  },
)

Deno.test('scanAssets: finds every file across multiple independent branches', async () => {
  const dir = await withTempDir(async (dir) => {
    await touch(join(dir, 'logo.svg'))
    await touch(join(dir, 'icons', 'favicon.png'))
    await touch(join(dir, 'fonts', 'inter.woff2'))
  })
  try {
    const resolved = await scanAssets(dir)
    assertEquals(
      [...resolved.keys()].sort(),
      ['fonts/inter.woff2', 'icons/favicon.png', 'logo.svg'],
    )
  } finally {
    await cleanup(dir)
  }
})

Deno.test(
  'scanAssets(assetsDir[]): a file in the FIRST directory shadows the same relative path in a ' +
    'later directory entirely — the later one is never even read',
  async () => {
    const overrideDir = await Deno.makeTempDir({ dir: TMP_ROOT })
    const baseDir = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      await touch(join(overrideDir, 'logo.svg'), 'override-logo')
      await touch(join(baseDir, 'logo.svg'), 'base-logo')

      const resolved = await scanAssets([overrideDir, baseDir])
      assertEquals(resolved.get('logo.svg'), join(overrideDir, 'logo.svg'))
    } finally {
      await cleanup(overrideDir, baseDir)
    }
  },
)

Deno.test(
  'scanAssets(assetsDir[]): an asset the override does NOT have falls back to the base directory',
  async () => {
    const overrideDir = await Deno.makeTempDir({ dir: TMP_ROOT })
    const baseDir = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      await touch(join(overrideDir, 'logo.svg'))
      await touch(join(baseDir, 'logo.svg'))
      await touch(join(baseDir, 'icons', 'favicon.png'))

      const resolved = await scanAssets([overrideDir, baseDir])
      assertEquals(
        resolved.get('icons/favicon.png'),
        join(baseDir, 'icons', 'favicon.png'),
      )
    } finally {
      await cleanup(overrideDir, baseDir)
    }
  },
)

Deno.test(
  'scanAssets(assetsDir[]): resolves correctly across 3+ directories, first match at any position wins',
  async () => {
    const first = await Deno.makeTempDir({ dir: TMP_ROOT })
    const second = await Deno.makeTempDir({ dir: TMP_ROOT })
    const third = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      // 'a.txt' only in the second directory — falls through past the first, resolves from the second.
      await touch(join(second, 'a.txt'), 'from-second')
      // 'b.txt' in both second and third — second (earlier) wins.
      await touch(join(second, 'b.txt'), 'from-second')
      await touch(join(third, 'b.txt'), 'from-third')
      // 'c.txt' only in the third — resolves from the third.
      await touch(join(third, 'c.txt'), 'from-third')

      const resolved = await scanAssets([first, second, third])
      assertEquals(resolved.get('a.txt'), join(second, 'a.txt'))
      assertEquals(resolved.get('b.txt'), join(second, 'b.txt'))
      assertEquals(resolved.get('c.txt'), join(third, 'c.txt'))
    } finally {
      await cleanup(first, second, third)
    }
  },
)

Deno.test('scanAssets(a single string): behaves exactly like an array of one', async () => {
  const dir = await withTempDir(async (dir) => {
    await touch(join(dir, 'logo.svg'))
  })
  try {
    const viaString = await scanAssets(dir)
    const viaArray = await scanAssets([dir])
    assertEquals(viaString, viaArray)
  } finally {
    await cleanup(dir)
  }
})

Deno.test(
  'scanAssets: a relative path containing ".." never appears as a key — file names/dirs are ' +
    'taken from real Deno.readDir entries, never from an unsanitized external string',
  async () => {
    const dir = await withTempDir(async (dir) => {
      await touch(join(dir, 'logo.svg'))
    })
    try {
      const resolved = await scanAssets(dir)
      for (const relativePath of resolved.keys()) {
        assert(!relativePath.includes('..'), relativePath)
      }
    } finally {
      await cleanup(dir)
    }
  },
)
