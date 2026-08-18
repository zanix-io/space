import { assert, assertEquals } from '@std/assert'
import { dirname, join } from '@std/path'
import { getTemporaryFolder } from '@zanix/helpers'
import { loadRoutes } from 'modules/router/mod.ts'
import { getNotFoundComponent, getRootLayout } from 'modules/router/app-shell-registry.ts'
import { getPageTree } from 'modules/router/page-tree-registry.ts'

console.error = () => {}

const TMP_ROOT = getTemporaryFolder(import.meta.url)

/** A fake `importModule` that resolves each `filePath` to its own distinct, IDENTITY-STABLE marker
 * object (the same object reference every time the same `filePath` is imported) — `getPageTree`
 * looks its argument up in a `WeakMap` keyed by object identity, so a test asserting against it
 * needs the exact object `loadRoutes` actually imported, not a structurally-equal stand-in. */
function fakeImportModule() {
  const targets = new Map<string, { filePath: string }>()
  const importModule = (filePath: string) => {
    let target = targets.get(filePath)
    if (!target) {
      target = { filePath }
      targets.set(filePath, target)
    }
    return Promise.resolve({ default: target })
  }
  return {
    importModule,
    targetFor: (filePath: string) => targets.get(filePath),
  }
}

async function touch(path: string): Promise<void> {
  await Deno.mkdir(dirname(path), { recursive: true })
  await Deno.writeTextFile(path, 'export default null\n')
}

Deno.test(
  "loadRoutes(routesDir[]): a page overridden in an earlier directory shadows the base app's " +
    'same route, while an untouched page still falls back to the base app',
  async () => {
    const overrideDir = await Deno.makeTempDir({ dir: TMP_ROOT })
    const baseDir = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      await touch(join(overrideDir, 'products', 'page.tsx'))
      await touch(join(baseDir, 'products', 'page.tsx'))
      await touch(join(baseDir, 'about', 'page.tsx'))

      const { importModule, targetFor } = fakeImportModule()
      await loadRoutes([overrideDir, baseDir], { importModule })

      const overriddenProducts = targetFor(
        join(overrideDir, 'products', 'page.tsx'),
      )
      const baseProducts = targetFor(join(baseDir, 'products', 'page.tsx'))
      const about = targetFor(join(baseDir, 'about', 'page.tsx'))

      assert(
        overriddenProducts,
        "the override directory's own page must have been imported",
      )
      assert(
        getPageTree(overriddenProducts as never),
        'the override page must be registered',
      )
      assert(
        !baseProducts,
        "the base app's SHADOWED page must never even be imported",
      )
      assert(
        about && getPageTree(about as never),
        'an untouched page still falls back to base',
      )
    } finally {
      await Deno.remove(overrideDir, { recursive: true })
      await Deno.remove(baseDir, { recursive: true })
    }
  },
)

Deno.test(
  'loadRoutes(routesDir[]): the root layout.tsx is a singleton — the FIRST directory to declare ' +
    'it wins the APP-WIDE shell, even though a later directory also has one',
  async () => {
    const overrideDir = await Deno.makeTempDir({ dir: TMP_ROOT })
    const baseDir = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      await touch(join(overrideDir, 'layout.tsx'))
      // No page anywhere under baseDir's root — so baseDir's own layout.tsx has no page of its
      // OWN to be a per-page ancestor for either (see the next test for that separate case);
      // its only possible role here is the app-wide singleton, which it must lose.
      await touch(join(baseDir, 'layout.tsx'))

      const { importModule, targetFor } = fakeImportModule()
      await loadRoutes([overrideDir, baseDir], { importModule })

      assertEquals(getRootLayout(), targetFor(join(overrideDir, 'layout.tsx')))
      assert(
        !targetFor(join(baseDir, 'layout.tsx')),
        'the shadowed root layout must never import',
      )
    } finally {
      await Deno.remove(overrideDir, { recursive: true })
      await Deno.remove(baseDir, { recursive: true })
    }
  },
)

Deno.test(
  'loadRoutes(routesDir[]): a root layout.tsx/not-found.tsx declared ONLY by a later directory ' +
    'still wins when an earlier directory declares neither — first directory that HAS it, not ' +
    'unconditionally the first directory',
  async () => {
    const overrideDir = await Deno.makeTempDir({ dir: TMP_ROOT })
    const baseDir = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      // Override directory declares no root layout/not-found of its own.
      await touch(join(overrideDir, 'products', 'page.tsx'))
      await touch(join(baseDir, 'layout.tsx'))
      await touch(join(baseDir, 'not-found.tsx'))

      const { importModule, targetFor } = fakeImportModule()
      await loadRoutes([overrideDir, baseDir], { importModule })

      assertEquals(getRootLayout(), targetFor(join(baseDir, 'layout.tsx')))
      assertEquals(
        getNotFoundComponent(),
        targetFor(join(baseDir, 'not-found.tsx')),
      )
    } finally {
      await Deno.remove(overrideDir, { recursive: true })
      await Deno.remove(baseDir, { recursive: true })
    }
  },
)

Deno.test(
  "loadRoutes(routesDir[]): a page's nested ancestor chain never crosses into a sibling " +
    'routesDir entry — an overridden page with no local layout/error resolves to NEITHER, even ' +
    'though a sibling directory declares one for the same route',
  async () => {
    const overrideDir = await Deno.makeTempDir({ dir: TMP_ROOT })
    const baseDir = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      await touch(join(baseDir, 'layout.tsx'))
      await touch(join(baseDir, 'products', 'error.tsx'))
      await touch(join(baseDir, 'products', 'page.tsx'))
      // Override provides ONLY the page — no layout, no error.
      await touch(join(overrideDir, 'products', 'page.tsx'))

      const { importModule, targetFor } = fakeImportModule()
      await loadRoutes([overrideDir, baseDir], { importModule })

      const overriddenProducts = targetFor(
        join(overrideDir, 'products', 'page.tsx'),
      )
      assert(overriddenProducts)
      const tree = getPageTree(overriddenProducts as never)
      assert(tree)
      // Root layout.tsx WAS discovered (base app's own, since override never declared one), but
      // the PAGE's own composition chain must still show no layout/error for its segments — proof
      // that "root singleton" and "per-page nested chain" are two independent resolutions, and the
      // page's own chain was never patched with the base app's products/error.tsx.
      assertEquals(getRootLayout(), targetFor(join(baseDir, 'layout.tsx')))
      for (const segment of tree.segments) {
        assertEquals(segment.layout, undefined)
        assertEquals(segment.error, undefined)
      }
    } finally {
      await Deno.remove(overrideDir, { recursive: true })
      await Deno.remove(baseDir, { recursive: true })
    }
  },
)

Deno.test({
  name: 'loadRoutes(a single string): behaves exactly as before array support existed',
  fn: async () => {
    const routesDir = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      await touch(join(routesDir, 'layout.tsx'))
      await touch(join(routesDir, 'page.tsx'))

      const { importModule, targetFor } = fakeImportModule()
      await loadRoutes(routesDir, { importModule })

      assertEquals(getRootLayout(), targetFor(join(routesDir, 'layout.tsx')))
      assert(getPageTree(targetFor(join(routesDir, 'page.tsx')) as never))
    } finally {
      await Deno.remove(routesDir, { recursive: true })
    }
  },
})
