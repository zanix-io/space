import { assert, assertEquals } from '@std/assert'
import { createElement as reactCreateElement } from 'react'
import { createElement as preactCreateElement } from 'preact'
import { SpacePageController } from 'modules/router/mod.ts'
import { setPageTree } from 'modules/router/page-tree-registry.ts'
import { setPwaConfig } from 'modules/pwa/mod.ts'
import { setPageRenderer } from 'modules/router/page-renderer-registry.ts'
import { renderPageResponse as renderPageReact } from 'modules/router/render-page-react.tsx'
import { extractDocumentSemantics } from 'modules/render/document-semantics.ts'
import { runRenderProbe } from 'modules/bundler/render-probe.ts'
import type { DiscoveredPage } from 'modules/bundler/discover-pages.ts'
import type { DocumentSemantics } from 'modules/render/document-model.ts'
import { comparableSemantics, withoutPwaContribution } from '../../support/document-parity.ts'

console.error = () => {}

// ================================================================================================
// THE RENDER PROBE.
//
// Two things are under test, and they are separate:
//
// 1. The probe measures the FINAL DOCUMENT, never a renderer's internals, and reports ordinary
//    document diagnostics rather than inventing failures of its own.
// 2. It obtains the renderer through the page-renderer registry — the one `defineSpaceApp({
//    renderer })` populates — and nothing else. It never asks which renderer is active, never reads
//    a config file, never inspects imports or sources. Switching the registry is the ONLY thing
//    these tests do to change renderer, because it is the only thing that decides it.
// ================================================================================================

const HEAD = {
  title: 'Widget — Example',
  meta: [
    { name: 'description', content: 'A widget worth having.' },
    { name: 'robots', content: 'index, follow' },
    { property: 'og:title', content: 'Widget' },
    { property: 'og:type', content: 'product' },
    { property: 'og:url', content: 'https://example.test/widget' },
    { property: 'og:image', content: 'https://example.test/widget.png' },
  ],
  link: [
    { rel: 'canonical', href: 'https://example.test/widget' },
    { rel: 'alternate', href: 'https://example.test/en/widget', hreflang: 'en' },
    { rel: 'alternate', href: 'https://example.test/es/widget', hreflang: 'es' },
    { rel: 'alternate', href: 'https://example.test/en/widget', hreflang: 'x-default' },
  ],
}

function ReactView() {
  return reactCreateElement(
    'main',
    null,
    reactCreateElement('h1', null, 'Widget'),
    reactCreateElement('p', null, 'A widget worth having.'),
  )
}
function PreactView() {
  return preactCreateElement(
    'main',
    null,
    preactCreateElement('h1', null, 'Widget'),
    preactCreateElement('p', null, 'A widget worth having.'),
  )
}

class ReactProbePage extends SpacePageController {
  public override component = ReactView
  public static override head = HEAD
}
class PreactProbePage extends SpacePageController {
  public override component = PreactView
  public static override head = HEAD
}

function discovered(overrides: Partial<DiscoveredPage> = {}): DiscoveredPage {
  return {
    filePath: 'routes/widget/page.tsx',
    routePath: 'widget',
    styles: [],
    head: { title: HEAD.title, meta: HEAD.meta, link: HEAD.link },
    headIsDynamic: false,
    hasUnconditionalRedirect: false,
    layoutHeads: [],
    ...overrides,
  }
}

/**
 * Runs the probe under one renderer. The ONLY thing that differs between renderers here is which
 * renderer is registered — exactly the mechanism `defineSpaceApp({ renderer })` uses. No file is
 * read, no import inspected, no source scanned.
 */
async function probeWith(
  renderer: 'react' | 'preact',
  options: { pwa?: boolean; pages?: DiscoveredPage[] } = {},
) {
  if (renderer === 'preact') {
    const { renderPageResponse } = await import('modules/router/render-page-preact.ts')
    setPageRenderer(renderPageResponse)
  } else {
    setPageRenderer(renderPageReact)
  }
  setPwaConfig(
    options.pwa ? { name: 'Example', icon: '/icon.png', themeColor: '#0af' } : undefined,
  )

  const Page = renderer === 'react' ? ReactProbePage : PreactProbePage
  const View = renderer === 'react' ? ReactView : PreactView
  const pages = options.pages ?? [discovered()]
  for (const page of pages) setPageTree(Page, { filePath: page.filePath, segments: [] })

  try {
    const { getPageRenderer } = await import('modules/router/page-renderer-registry.ts')
    return await runRenderProbe({
      pages,
      loadPage: () => Promise.resolve({ Target: Page as never, Component: View }),
      // Read from the registry at the CALL SITE — the registry stays the single source of truth,
      // the probe simply does not import it. See `render-probe.ts`'s own doc for why that edge had
      // to go: it dragged `react-dom/server` into a build-tool entry point.
      renderPage: getPageRenderer(),
    })
  } finally {
    setPageRenderer(renderPageReact)
    setPwaConfig(undefined)
  }
}

/** Re-renders through the probe and returns the semantics of the single probed route. */
async function semanticsFor(
  renderer: 'react' | 'preact',
  pwa: boolean,
): Promise<DocumentSemantics> {
  if (renderer === 'preact') {
    const { renderPageResponse } = await import('modules/router/render-page-preact.ts')
    setPageRenderer(renderPageResponse)
  } else {
    setPageRenderer(renderPageReact)
  }
  setPwaConfig(pwa ? { name: 'Example', icon: '/icon.png', themeColor: '#0af' } : undefined)
  const Page = renderer === 'react' ? ReactProbePage : PreactProbePage
  const View = renderer === 'react' ? ReactView : PreactView
  setPageTree(Page, { filePath: 'routes/widget/page.tsx', segments: [] })
  try {
    const { getPageRenderer } = await import('modules/router/page-renderer-registry.ts')
    const { mockPageContext } = await import('modules/testing/mock-page-context.ts')
    const response = await getPageRenderer()(
      Page as never,
      View,
      mockPageContext({ url: new URL('https://example.test/widget') }),
      undefined,
      false,
      undefined,
      undefined,
    )
    return extractDocumentSemantics(await response.text())
  } finally {
    setPageRenderer(renderPageReact)
    setPwaConfig(undefined)
  }
}

// --- the probe renders through the configured renderer -------------------------------------------

for (const renderer of ['react', 'preact'] as const) {
  for (const pwa of [false, true]) {
    const label = `${renderer}${pwa ? ' + PWA' : ''}`

    Deno.test(`render probe [${label}]: a well-formed route produces no diagnostics`, async () => {
      const result = await probeWith(renderer, { pwa })
      assertEquals(result.diagnostics, [])
      assertEquals(result.probed, ['widget'])
    })

    Deno.test(
      `render probe [${label}]: the document carries title, meta, canonical, hreflang, lang, ` +
        'viewport, charset, doctype and body text',
      async () => {
        const doc = await semanticsFor(renderer, pwa)

        assertEquals(doc.titles, ['Widget — Example'])
        assertEquals(doc.meta['name:description'], 'A widget worth having.')
        assertEquals(doc.meta['name:robots'], 'index, follow')
        assertEquals(doc.meta['property:og:image'], 'https://example.test/widget.png')
        assertEquals(
          doc.links.filter((link) => link.rel === 'canonical'),
          [{ rel: 'canonical', href: 'https://example.test/widget' }],
        )
        assertEquals(doc.links.filter((link) => link.rel === 'alternate').length, 3)
        assertEquals(doc.lang, 'en')
        assertEquals(doc.viewport, 'width=device-width, initial-scale=1')
        assertEquals(doc.hasMetaCharset, true)
        assertEquals(doc.isDocument, true)
        assertEquals(doc.hasTextContent, true)
        assertEquals(doc.h1Count, 1)
      },
    )

    Deno.test(
      `render probe [${label}]: the PWA contribution is present exactly when PWA is configured`,
      async () => {
        const doc = await semanticsFor(renderer, pwa)
        const manifests = doc.links.filter((link) => link.rel === 'manifest')
        assertEquals(manifests.length, pwa ? 1 : 0)
        assertEquals(doc.meta['name:theme-color'], pwa ? '#0af' : undefined)
      },
    )
  }
}

// --- parity ---------------------------------------------------------------------------------------

Deno.test(
  'render probe PARITY: React and Preact produce equivalent DocumentSemantics from the same page',
  async () => {
    assertEquals(
      comparableSemantics(await semanticsFor('preact', false)),
      comparableSemantics(await semanticsFor('react', false)),
    )
  },
)

Deno.test('render probe PARITY: the same holds with PWA enabled', async () => {
  assertEquals(
    comparableSemantics(await semanticsFor('preact', true)),
    comparableSemantics(await semanticsFor('react', true)),
  )
})

Deno.test(
  'render probe PARITY: enabling PWA changes only the PWA contribution — it does not alter the ' +
    'rules of parity or any other property of the document',
  async () => {
    // Sequential on purpose, not `Promise.all` — `semanticsFor` mutates process-wide registries
    // (`setPageRenderer`/`setPwaConfig`/`setPageTree`), so running renderers concurrently would
    // race on that shared state. Unrolled rather than a `for` loop so each `await` stays outside
    // loop syntax (see `no-await-in-loop`), matching the PARITY tests just above.
    const reactWithPwa = withoutPwaContribution(await semanticsFor('react', true))
    const reactWithoutPwa = withoutPwaContribution(await semanticsFor('react', false))
    assertEquals(reactWithPwa, reactWithoutPwa, 'react')

    const preactWithPwa = withoutPwaContribution(await semanticsFor('preact', true))
    const preactWithoutPwa = withoutPwaContribution(await semanticsFor('preact', false))
    assertEquals(preactWithPwa, preactWithoutPwa, 'preact')
  },
)

// --- coverage boundaries ---------------------------------------------------------------------------

Deno.test(
  'render probe: a route with dynamic segments is SKIPPED and reported — rendering it would need ' +
    'data a build cannot invent, and partial coverage must be stated rather than implied',
  async () => {
    const result = await probeWith('react', {
      pages: [discovered({ routePath: 'products/:id' })],
    })
    assertEquals(result.probed, [])
    assert(
      result.skipped.some((entry) => entry.includes('products/:id')),
      result.skipped.join('\n'),
    )
    assert(result.skipped.some((entry) => entry.includes('dynamic segments')))
  },
)

Deno.test(
  'render probe: a component that THROWS still yields DOCUMENT diagnostics, not an invented probe ' +
    "error. The renderer's own contract is that it always resolves — a thrown component becomes an " +
    'empty 500 — so what the probe sees is a response that is not a document, and it says exactly ' +
    'that through DOC003 rather than through a failure mode of its own',
  async () => {
    const { getPageRenderer } = await import('modules/router/page-renderer-registry.ts')
    const result = await runRenderProbe({
      pages: [discovered()],
      loadPage: () =>
        Promise.resolve({
          Target: ReactProbePage as never,
          Component: () => {
            throw new Error('component exploded')
          },
        }),
      renderPage: getPageRenderer(),
    })
    assertEquals(result.probed, ['widget'])
    assertEquals(result.diagnostics.map((d) => d.code), ['DOC003'])
    assertEquals(result.skipped, [])
  },
)

Deno.test(
  'render probe: a route whose page cannot be loaded is skipped and reported — the one path where ' +
    'the probe has nothing to measure at all',
  async () => {
    const { getPageRenderer } = await import('modules/router/page-renderer-registry.ts')
    const result = await runRenderProbe({
      pages: [discovered()],
      loadPage: () => Promise.resolve(undefined),
      renderPage: getPageRenderer(),
    })
    assertEquals(result.probed, [])
    assertEquals(result.diagnostics, [])
    assert(result.skipped.some((entry) => entry.includes('could not be loaded')))
  },
)

Deno.test(
  'render probe: a BROKEN document produces ordinary document diagnostics, so the reader learns ' +
    'what is wrong with the document rather than that "the probe failed"',
  async () => {
    // A component rendering a bare fragment: no html, no body, no doctype.
    const { getPageRenderer } = await import('modules/router/page-renderer-registry.ts')
    const result = await runRenderProbe({
      pages: [discovered({ head: { title: undefined, meta: [], link: [] } })],
      loadPage: () =>
        Promise.resolve({
          Target: ReactProbePage as never,
          Component: () => reactCreateElement('p', null, 'orphan'),
        }),
      renderPage: getPageRenderer(),
    })
    const codes = result.diagnostics.map((diagnostic) => diagnostic.code)
    assert(codes.length > 0, 'expected real diagnostics')
    // Every one is a catalogued document rule, none invented by the probe.
    for (const code of codes) assert(/^(DOC|A11Y|SEO|FW|PWA|SOC)\d+$/.test(code), code)
  },
)

// --- no heuristic renderer detection -----------------------------------------------------------------

Deno.test(
  'render probe: never DETECTS a renderer — it reads no file, inspects no import and scans no ' +
    'source; the renderer is either injected or read from the registry the application populated',
  async () => {
    const source = await Deno.readTextFile('src/modules/bundler/render-probe.ts')
    const code = source.split('\n').filter((line) =>
      !line.trimStart().startsWith('*') &&
      !line.trimStart().startsWith('//')
    ).join('\n')

    // No filesystem access, no config reading, no source inspection, and — the one that matters
    // most — no `getActiveRenderer()`: nothing here may branch on which renderer is active. What
    // the probe renders with is decided elsewhere, never derived here.
    for (const forbidden of ['readTextFile', 'deno.json', 'readDir', 'getActiveRenderer']) {
      assert(!code.includes(forbidden), `render-probe must not reference '${forbidden}'`)
    }

    // `getPageRenderer` IS referenced now, and deliberately: `renderPage` is optional, and omitting
    // it means "whatever renderer this application installed". That reference used to be forbidden
    // for a concrete reason — importing the registry once dragged `react-dom/server` into
    // `@zanix/space/vite`, a build-tool entry point. The entry-point split removed the registry's
    // eager React default, so it now reaches no renderer at all; `renderer-agnostic-layer.test.ts`
    // asserts that `/vite` still has zero value edges to either renderer, which is what makes this
    // reference safe rather than merely convenient.
    assert(code.includes('getPageRenderer'))
    assert(code.includes('renderPage'))
  },
)
