import { assert, assertEquals } from '@std/assert'
import { join } from '@std/path'
import { getTemporaryFolder } from '@zanix/helpers'
import { validateBuild } from 'modules/bundler/validate-build.ts'
import type { DiscoveredPage } from 'modules/bundler/discover-pages.ts'

// ================================================================================================
// The seam between discovery and validation.
//
// This module assembles inputs and performs no checking of its own — the tests below therefore
// assert wiring and honesty about gaps, not rule behaviour (which `unit/validation/` owns).
// ================================================================================================

function page(overrides: Partial<DiscoveredPage> = {}): DiscoveredPage {
  return {
    filePath: 'routes/products/page.tsx',
    routePath: 'products',
    styles: [],
    head: { title: 'Widget', meta: [{ name: 'description', content: 'A widget.' }], link: [] },
    headIsDynamic: false,
    hasUnconditionalRedirect: false,
    layoutHeads: [],
    ...overrides,
  }
}

async function withTempRoutes(run: (routesDir: string) => Promise<void>): Promise<void> {
  const root = await Deno.makeTempDir({ dir: getTemporaryFolder(import.meta.url) })
  try {
    await Deno.mkdir(join(root, 'routes'), { recursive: true })
    await run(join(root, 'routes'))
  } finally {
    await Deno.remove(root, { recursive: true })
  }
}

Deno.test('validateBuild: a well-formed project produces no diagnostics', async () => {
  await withTempRoutes(async (routesDir) => {
    const result = await validateBuild({ pages: [page()], routesDir })
    assertEquals(result.diagnostics, [])
  })
})

Deno.test(
  'validateBuild: an absent sitemap is REPORTED as a skipped check — a validator that silently ' +
    'skips work reads exactly like one that found nothing wrong',
  async () => {
    await withTempRoutes(async (routesDir) => {
      const result = await validateBuild({ pages: [page()], routesDir })
      assert(
        result.skipped.some((entry) => entry.includes('Sitemap cross-checks')),
        result.skipped.join('\n'),
      )
    })
  },
)

Deno.test(
  'validateBuild: routes with a dynamic head are named in the skip report, so partial coverage is ' +
    'visible rather than implied',
  async () => {
    await withTempRoutes(async (routesDir) => {
      const result = await validateBuild({
        pages: [page({ routePath: 'products/:id', headIsDynamic: true })],
        routesDir,
      })
      assert(
        result.skipped.some((entry) => entry.includes('products/:id')),
        result.skipped.join('\n'),
      )
    })
  },
)

Deno.test('validateBuild: a real root layout on disk is read and checked', async () => {
  await withTempRoutes(async (routesDir) => {
    await Deno.writeTextFile(
      join(routesDir, 'layout.tsx'),
      'export default (p) => <div>{p.children}</div>\n',
    )
    const result = await validateBuild({ pages: [page()], routesDir })
    assert(result.diagnostics.some((d) => d.code === 'FW006'))
  })
})

Deno.test(
  'validateBuild: [lang] routes are detected from the route tree, enabling the hardcoded-lang check',
  async () => {
    await withTempRoutes(async (routesDir) => {
      await Deno.writeTextFile(
        join(routesDir, 'layout.tsx'),
        "export default (p) => <html lang='en'><body>{p.children}</body></html>\n",
      )
      const withLang = await validateBuild({
        pages: [page({ routePath: ':lang/products' })],
        routesDir,
      })
      assert(withLang.diagnostics.some((d) => d.code === 'FW005'))

      const withoutLang = await validateBuild({ pages: [page()], routesDir })
      assertEquals(withoutLang.diagnostics.some((d) => d.code === 'FW005'), false)
    })
  },
)

Deno.test(
  'validateBuild: project config reaches the engine — strict promotes warnings',
  async () => {
    await withTempRoutes(async (routesDir) => {
      const pages = [page({ head: { title: undefined, meta: [], link: [] } })]
      const lenient = await validateBuild({ pages, routesDir })
      assertEquals(lenient.diagnostics.find((d) => d.code === 'DOC001')?.severity, 'warning')

      const strict = await validateBuild({ pages, routesDir, config: { strict: true } })
      const doc001 = strict.diagnostics.find((d) => d.code === 'DOC001')
      assertEquals(doc001?.severity, 'error')
      assertEquals(doc001?.resolution.strictPromoted, true)
    })
  },
)

Deno.test(
  'validateBuild: an unconditionally-redirecting page is exempt end to end — INFERRED during ' +
    'discovery, with nothing for the author to declare',
  async () => {
    await withTempRoutes(async (routesDir) => {
      const result = await validateBuild({
        pages: [page({
          hasUnconditionalRedirect: true,
          head: { title: undefined, meta: [], link: [] },
        })],
        routesDir,
      })
      assertEquals(result.diagnostics, [])
    })
  },
)

Deno.test(
  'validateBuild: a project route exemption is the other way out, and it is POLICY — declared once ' +
    'for the project rather than page by page',
  async () => {
    await withTempRoutes(async (routesDir) => {
      const pages = [page({
        routePath: 'internal/hooks',
        head: { title: undefined, meta: [], link: [] },
      })]
      const withoutExemption = await validateBuild({ pages, routesDir })
      assert(withoutExemption.diagnostics.some((d) => d.code === 'DOC001'))

      const withExemption = await validateBuild({
        pages,
        routesDir,
        config: { exempt: ['internal/**'] },
      })
      assertEquals(withExemption.diagnostics, [])
    })
  },
)
