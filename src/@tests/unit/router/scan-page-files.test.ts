import { assert, assertEquals } from '@std/assert'
import { dirname, join } from '@std/path'
import { getTemporaryFolder } from '@zanix/helpers'
import { scanPageFiles } from 'modules/router/mod.ts'

const TMP_ROOT = getTemporaryFolder(import.meta.url)

async function withTempRoutes(
  build: (routesDir: string) => Promise<void>,
): Promise<Awaited<ReturnType<typeof scanPageFiles>>> {
  const routesDir = await Deno.makeTempDir({ dir: TMP_ROOT })
  try {
    await build(routesDir)
    const pages = await scanPageFiles(routesDir)
    return pages.sort((a, b) => a.routePath.localeCompare(b.routePath))
  } finally {
    await Deno.remove(routesDir, { recursive: true })
  }
}

async function touch(path: string): Promise<void> {
  await Deno.mkdir(dirname(path), { recursive: true })
  await Deno.writeTextFile(
    path,
    'export default function () { return null }\n',
  )
}

Deno.test('scanPageFiles: finds a root-level page.tsx with an empty route path', async () => {
  const pages = await withTempRoutes(async (dir) => {
    await touch(join(dir, 'page.tsx'))
  })

  assertEquals(pages.length, 1)
  assertEquals(pages[0].routePath, '')
  assert(pages[0].filePath.endsWith('page.tsx'))
})

Deno.test('scanPageFiles: derives the route path from nested folders', async () => {
  const pages = await withTempRoutes(async (dir) => {
    await touch(join(dir, 'products', 'page.tsx'))
  })

  assertEquals(pages.map((p) => p.routePath), ['products'])
})

Deno.test('scanPageFiles: maps a [param] folder segment to a :param route segment', async () => {
  const pages = await withTempRoutes(async (dir) => {
    await touch(join(dir, 'products', '[id]', 'page.tsx'))
  })

  assertEquals(pages.map((p) => p.routePath), ['products/:id'])
})

Deno.test('scanPageFiles: ignores files not literally named page.tsx', async () => {
  const pages = await withTempRoutes(async (dir) => {
    await touch(join(dir, 'products', 'layout.tsx'))
    await touch(join(dir, 'products', 'page.tsx'))
  })

  assertEquals(pages.map((p) => p.routePath), ['products'])
})

Deno.test('scanPageFiles: a missing routesDir returns zero pages, not an error', async () => {
  const pages = await scanPageFiles('./this-routes-dir-does-not-exist')

  assertEquals(pages, [])
})

Deno.test('scanPageFiles: finds every page across multiple independent branches', async () => {
  const pages = await withTempRoutes(async (dir) => {
    await touch(join(dir, 'page.tsx'))
    await touch(join(dir, 'products', 'page.tsx'))
    await touch(join(dir, 'products', '[id]', 'page.tsx'))
    await touch(join(dir, 'about', 'page.tsx'))
  })

  assertEquals(pages.map((p) => p.routePath), [
    '',
    'about',
    'products',
    'products/:id',
  ])
})

Deno.test(
  'scanPageFiles: a page with no layout/loading/error has one segment, all fields empty',
  async () => {
    const pages = await withTempRoutes(async (dir) => {
      await touch(join(dir, 'page.tsx'))
    })

    assertEquals(pages[0].segments, [{
      layoutFilePath: undefined,
      loadingFilePath: undefined,
      errorFilePath: undefined,
    }])
  },
)

Deno.test(
  'scanPageFiles: derives the segment chain root-first, one entry per directory level',
  async () => {
    const pages = await withTempRoutes(async (dir) => {
      await touch(join(dir, 'layout.tsx'))
      await touch(join(dir, 'products', 'error.tsx'))
      await touch(join(dir, 'products', '[id]', 'loading.tsx'))
      await touch(join(dir, 'products', '[id]', 'page.tsx'))
    })

    assertEquals(pages.length, 1)
    const [root, products, id] = pages[0].segments
    assert(root.layoutFilePath?.endsWith('layout.tsx'))
    assertEquals(root.loadingFilePath, undefined)
    assertEquals(root.errorFilePath, undefined)

    assertEquals(products.layoutFilePath, undefined)
    assert(products.errorFilePath?.endsWith(join('products', 'error.tsx')))

    assert(
      id.loadingFilePath?.endsWith(join('products', '[id]', 'loading.tsx')),
    )
    assertEquals(id.layoutFilePath, undefined)
    assertEquals(id.errorFilePath, undefined)
  },
)

Deno.test(
  "scanPageFiles: a directory's own layout/loading/error never leaks into a sibling branch",
  async () => {
    const pages = await withTempRoutes(async (dir) => {
      await touch(join(dir, 'products', 'layout.tsx'))
      await touch(join(dir, 'products', 'page.tsx'))
      await touch(join(dir, 'about', 'page.tsx'))
    })

    const about = pages.find((p) => p.routePath === 'about')
    assert(about)
    const emptySegment = {
      layoutFilePath: undefined,
      loadingFilePath: undefined,
      errorFilePath: undefined,
    }
    // Two levels deep (routes root + its own 'about' directory), both empty — 'products' sibling's
    // layout.tsx must never show up here.
    assertEquals(about.segments, [emptySegment, emptySegment])
  },
)

Deno.test(
  "scanPageFiles(routesDir[]): a page overridden in the FIRST directory shadows the base app's " +
    'same route entirely — the base copy is never even imported',
  async () => {
    const overrideDir = await Deno.makeTempDir({ dir: TMP_ROOT })
    const baseDir = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      await touch(join(overrideDir, 'products', 'page.tsx'))
      await Deno.writeTextFile(
        join(overrideDir, 'products', 'page.tsx'),
        'export default function () { return "override" }\n',
      )
      await touch(join(baseDir, 'products', 'page.tsx'))
      await touch(join(baseDir, 'about', 'page.tsx'))

      const pages = await scanPageFiles([overrideDir, baseDir])
      const products = pages.find((p) => p.routePath === 'products')
      const about = pages.find((p) => p.routePath === 'about')

      assert(products)
      assert(
        products.filePath.startsWith(overrideDir),
        'the override directory must win',
      )
      // The base app's own pages the override doesn't touch still resolve, falling back cleanly.
      assert(about)
      assert(about.filePath.startsWith(baseDir))
    } finally {
      await Deno.remove(overrideDir, { recursive: true })
      await Deno.remove(baseDir, { recursive: true })
    }
  },
)

Deno.test(
  "scanPageFiles(routesDir[]): a page's nested layout/error/loading chain resolves entirely " +
    'within the SAME directory that provided it, never completed from a sibling routesDir entry',
  async () => {
    const overrideDir = await Deno.makeTempDir({ dir: TMP_ROOT })
    const baseDir = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      // Base app declares a root layout AND a nested page with its own error boundary.
      await touch(join(baseDir, 'layout.tsx'))
      await touch(join(baseDir, 'products', 'error.tsx'))
      await touch(join(baseDir, 'products', 'page.tsx'))
      // Override directory replaces the SAME page, but declares no layout/error of its own.
      await touch(join(overrideDir, 'products', 'page.tsx'))

      const pages = await scanPageFiles([overrideDir, baseDir])
      const products = pages.find((p) => p.routePath === 'products')
      assert(products)
      assert(products.filePath.startsWith(overrideDir))
      // No "Frankenstein" completion: the override's own segment chain has NEITHER the base app's
      // root layout NOR its products/error.tsx — both are absent, not silently borrowed.
      for (const segment of products.segments) {
        assertEquals(segment.layoutFilePath, undefined)
        assertEquals(segment.errorFilePath, undefined)
      }
    } finally {
      await Deno.remove(overrideDir, { recursive: true })
      await Deno.remove(baseDir, { recursive: true })
    }
  },
)

Deno.test(
  'scanPageFiles(a single string): behaves exactly as before array support existed',
  async () => {
    const pages = await withTempRoutes(async (dir) => {
      await touch(join(dir, 'page.tsx'))
      await touch(join(dir, 'about', 'page.tsx'))
    })

    assertEquals(pages.map((p) => p.routePath), ['', 'about'])
  },
)
