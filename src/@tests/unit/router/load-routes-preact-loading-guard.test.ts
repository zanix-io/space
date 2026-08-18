import { assert, assertEquals, assertRejects } from '@std/assert'
import { join } from '@std/path'
import { getTemporaryFolder } from '@zanix/helpers'
import { loadRoutes } from 'modules/router/mod.ts'
import { setActiveRenderer } from 'modules/router/active-renderer.ts'

console.error = () => {}

const TMP_ROOT = getTemporaryFolder(import.meta.url)

/** Restores the module-level active-renderer flag after each test in this file — `active-renderer.ts`
 * is a real singleton shared with every other test in this suite; leaving it on `'preact'` would
 * silently break unrelated React-renderer tests that run afterward in the same process. */
function withRenderer<T>(
  renderer: 'react' | 'preact',
  run: () => Promise<T>,
): Promise<T> {
  setActiveRenderer(renderer)
  return run().finally(() => setActiveRenderer('react'))
}

async function buildRoutesWithLoading(routesDir: string): Promise<void> {
  await Deno.mkdir(join(routesDir, 'products'), { recursive: true })
  await Deno.writeTextFile(
    join(routesDir, 'products', 'page.tsx'),
    'export default null\n',
  )
  await Deno.writeTextFile(
    join(routesDir, 'products', 'loading.tsx'),
    'export default null\n',
  )
}

function fakeImportModule() {
  function View() {
    return null
  }
  class Page {}
  // `resolvePendingPage`/`@Page()` machinery isn't exercised here — the guard this test cares
  // about runs BEFORE that step (see `load-routes.ts`'s own doc for exactly where), so a plain
  // stand-in default export is enough for both `page.tsx` and `loading.tsx`.
  return (filePath: string) => {
    if (filePath.endsWith('loading.tsx')) {
      return Promise.resolve({ default: View })
    }
    return Promise.resolve({ default: Page })
  }
}

Deno.test(
  'loadRoutes: renderer=preact rejects a route with loading.tsx, before any request could reach it',
  async () => {
    const routesDir = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      await buildRoutesWithLoading(routesDir)

      await withRenderer('preact', async () => {
        const error = await assertRejects(
          () => loadRoutes(routesDir, { importModule: fakeImportModule() }),
          Error,
        )
        assert(
          (error as Error).message.includes(
            'loading.tsx is not supported under --renderer=preact',
          ),
          (error as Error).message,
        )
        assert(
          (error as Error).message.includes('products'),
          (error as Error).message,
        )
        assert(
          (error as Error).message.includes('loading.tsx'),
          (error as Error).message,
        )
      })
    } finally {
      await Deno.remove(routesDir, { recursive: true })
    }
  },
)

Deno.test(
  'loadRoutes: the guard fires BEFORE loading.tsx is ever imported, Etapa 4 hardening (real bug ' +
    'found: an earlier version checked AFTER importing, so a loading.tsx with its own unrelated ' +
    "import error surfaced that raw error instead of this guard's own clear message)",
  async () => {
    const routesDir = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      await buildRoutesWithLoading(routesDir)

      // A loading.tsx that would ALSO fail to import for a totally unrelated reason (a missing
      // dependency, a real syntax error, ...) — simulated here by having `importModule` reject
      // specifically for loading.tsx's own path. If the guard ever regresses back to checking
      // AFTER the import, this importer's own rejection reaches the caller instead of the guard's
      // clear message — this test fails the moment that happens.
      const importModule = (filePath: string) => {
        if (filePath.endsWith('loading.tsx')) {
          return Promise.reject(
            new Error('Cannot find module "some-missing-dependency"'),
          )
        }
        return Promise.resolve({ default: class Page {} })
      }

      await withRenderer('preact', async () => {
        const error = await assertRejects(
          () => loadRoutes(routesDir, { importModule }),
          Error,
        )
        assert(
          (error as Error).message.includes(
            'loading.tsx is not supported under --renderer=preact',
          ),
          `expected the guard's own clear message, got: ${(error as Error).message}`,
        )
        assert(
          !(error as Error).message.includes('some-missing-dependency'),
          'the unrelated import error must never surface instead of the guard',
        )
      })
    } finally {
      await Deno.remove(routesDir, { recursive: true })
    }
  },
)

Deno.test(
  'loadRoutes: renderer=react (default) never rejects the same route tree — zero regression',
  async () => {
    const routesDir = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      await buildRoutesWithLoading(routesDir)

      // No `withRenderer` wrapper — this is the framework's own default, unchanged.
      await loadRoutes(routesDir, { importModule: fakeImportModule() })
      assertEquals(true, true) // reaching here at all is the assertion — no throw happened
    } finally {
      await Deno.remove(routesDir, { recursive: true })
    }
  },
)
