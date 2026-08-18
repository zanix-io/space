import { assertEquals } from '@std/assert'
import { createElement as reactCreateElement } from 'react'
import { createElement as preactCreateElement } from 'preact'
import { SpacePageController } from 'modules/router/mod.ts'
import { setPageTree } from 'modules/router/page-tree-registry.ts'
import { mockPageContext } from 'modules/testing/mod.ts'
import { setPwaConfig } from 'modules/pwa/mod.ts'
import { setCssManifest } from 'modules/render/css-manifest.ts'
import { extractDocumentSemantics } from 'modules/render/document-semantics.ts'
import type { DocumentSemantics } from 'modules/render/document-model.ts'
import { comparableSemantics, withoutPwaContribution } from '../../support/document-parity.ts'
import type { HeadDescriptor } from 'modules/router/head-descriptor.ts'
import { renderPageResponse as renderReact } from 'modules/router/render-page-react.tsx'
import { renderPageResponse as renderPreact } from 'modules/router/render-page-preact.ts'

console.error = () => {}

// ================================================================================================
// The cross-renderer contract, asserted rather than described.
//
// `@zanix/space` validates the semantic contract of the document, independently of the renderer
// that serializes it. React and Preact are implementations of the same contract; PWA is an
// orthogonal capability of the document and of its installation artifacts — not a third renderer.
// The real matrix is therefore renderer × pwa, four combinations, and every one of them is run
// below against ONE shared fixture.
//
// Nothing here compares HTML strings. `react-dom/server` and `preact-render-to-string` legitimately
// differ on attribute order, void-element closing and whitespace; none of that carries meaning.
// What is compared is `DocumentSemantics` (`render/document-semantics.ts`).
// ================================================================================================

const ORIGIN = 'https://example.com'
const PATH = '/en/products/widget'

/** The single head declaration both renderers are driven from — the fixture's whole point is that
 * this is shared, so any divergence in the output is a divergence in the renderers, not the input. */
const PAGE_HEAD: HeadDescriptor = {
  title: 'Widget — Example',
  meta: [
    { name: 'description', content: 'A widget worth having.' },
    { name: 'robots', content: 'index, follow, max-snippet:-1' },
    { property: 'og:title', content: 'Widget' },
    { property: 'og:type', content: 'product' },
    { property: 'og:url', content: `${ORIGIN}${PATH}` },
    { property: 'og:image', content: `${ORIGIN}/img/widget.png` },
  ],
  link: [
    // The page's OWN canonical. The layout below declares a DIFFERENT one; exactly one must survive,
    // and it must be this one. That is `resolveHead`'s singleton rule doing the work — never a
    // serializer patching it up afterwards.
    { rel: 'canonical', href: `${ORIGIN}${PATH}` },
    // A full hreflang set, including the pair that shares an `href`: the default language's own
    // entry and `x-default`. Those two are deliberately kept distinct by `resolveHead`, and they are
    // the exact pair that used to collide under one duplicate React key.
    { rel: 'alternate', href: `${ORIGIN}/en/products/widget`, hreflang: 'en' },
    { rel: 'alternate', href: `${ORIGIN}/es/products/widget`, hreflang: 'es' },
    { rel: 'alternate', href: `${ORIGIN}/de/products/widget`, hreflang: 'de' },
    { rel: 'alternate', href: `${ORIGIN}/en/products/widget`, hreflang: 'x-default' },
  ],
}

/** A layout-level head, declaring a canonical the page must override and a meta the page does not
 * declare (so it survives). Mirrors a real app: layouts carry site-wide defaults. */
const LAYOUT_HEAD: HeadDescriptor = {
  title: 'Example Store',
  meta: [{ name: 'author', content: 'Example Inc.' }],
  link: [{ rel: 'canonical', href: `${ORIGIN}/products` }],
}

// --- the same view, once per renderer ------------------------------------------------------------

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

class ReactParityPage extends SpacePageController {
  public override component = ReactView
  public static override head = PAGE_HEAD
}

class PreactParityPage extends SpacePageController {
  public override component = PreactView
  public static override head = PAGE_HEAD
}

const PWA_CONFIG = { name: 'Example Store', icon: '/icon.png', themeColor: '#0af' }

async function renderWith(
  renderer: 'react' | 'preact',
  pwa: boolean,
): Promise<DocumentSemantics> {
  const Page = renderer === 'react' ? ReactParityPage : PreactParityPage
  // No root layout — the segment carries only a `head`, so each renderer's own DEFAULT document
  // shell provides `<html lang>`, the charset and the viewport. Comparing those two shells is part
  // of what this suite exists to check.
  setPageTree(Page, {
    filePath: `/fake/parity-${renderer}.tsx`,
    segments: [{ head: LAYOUT_HEAD }],
  })
  setCssManifest({ global: ['/app.css'] })
  setPwaConfig(pwa ? PWA_CONFIG : undefined)
  try {
    const pageCtx = mockPageContext({ url: new URL(`${ORIGIN}${PATH}`) })
    const render = renderer === 'react' ? renderReact : renderPreact
    // The view is passed explicitly, not read off the class: `component` is declared as a class
    // FIELD, so it exists only on an instance and `Page.prototype.component` is `undefined`.
    const View = renderer === 'react' ? ReactView : PreactView
    const response = await render(
      Page as never,
      View,
      pageCtx,
      undefined,
      false,
      undefined,
      undefined,
    )
    return extractDocumentSemantics(await response.text())
  } finally {
    setCssManifest(undefined)
    setPwaConfig(undefined)
  }
}

const COMBINATIONS = [
  { label: 'React', renderer: 'react' as const, pwa: false },
  { label: 'React + PWA', renderer: 'react' as const, pwa: true },
  { label: 'Preact', renderer: 'preact' as const, pwa: false },
  { label: 'Preact + PWA', renderer: 'preact' as const, pwa: true },
]

// ================================================================================================
// Per-combination assertions — every property of the contract, in every combination.
// ================================================================================================

for (const { label, renderer, pwa } of COMBINATIONS) {
  Deno.test(
    `document parity [${label}]: exactly one <title>, resolved page-over-layout`,
    async () => {
      const doc = await renderWith(renderer, pwa)
      assertEquals(doc.titles, ['Widget — Example'])
    },
  )

  Deno.test(
    `document parity [${label}]: description, robots and the full Open Graph set`,
    async () => {
      const doc = await renderWith(renderer, pwa)
      assertEquals(doc.meta['name:description'], 'A widget worth having.')
      assertEquals(doc.meta['name:robots'], 'index, follow, max-snippet:-1')
      assertEquals(doc.meta['property:og:title'], 'Widget')
      assertEquals(doc.meta['property:og:type'], 'product')
      assertEquals(doc.meta['property:og:url'], `${ORIGIN}${PATH}`)
      assertEquals(doc.meta['property:og:image'], `${ORIGIN}/img/widget.png`)
      // Declared only by the layout, never by the page — so it survives untouched.
      assertEquals(doc.meta['name:author'], 'Example Inc.')
    },
  )

  Deno.test(
    `document parity [${label}]: EXACTLY ONE canonical, and it is the page's — the layout declares ` +
      'a different href, and the singleton rule lives in resolveHead, not in a serializer patch',
    async () => {
      const doc = await renderWith(renderer, pwa)
      const canonicals = doc.links.filter((link) => link.rel === 'canonical')
      assertEquals(canonicals, [{ rel: 'canonical', href: `${ORIGIN}${PATH}` }])
    },
  )

  Deno.test(
    `document parity [${label}]: the complete hreflang set survives, x-default included — the ` +
      'pair sharing an href is kept distinct, which is 1.2 + 1.3 + 1.4 validated at once',
    async () => {
      const doc = await renderWith(renderer, pwa)
      const alternates = doc.links
        .filter((link) => link.rel === 'alternate')
        .map((link) => `${link.hreflang}|${link.href}`)
        .sort()
      assertEquals(alternates, [
        `de|${ORIGIN}/de/products/widget`,
        `en|${ORIGIN}/en/products/widget`,
        `es|${ORIGIN}/es/products/widget`,
        `x-default|${ORIGIN}/en/products/widget`,
      ])
    },
  )

  Deno.test(
    `document parity [${label}]: lang, charset, viewport and document structure`,
    async () => {
      const doc = await renderWith(renderer, pwa)
      assertEquals(doc.lang, 'en')
      assertEquals(doc.hasMetaCharset, true)
      assertEquals(doc.viewport, 'width=device-width, initial-scale=1')
      assertEquals(doc.isDocument, true)
    },
  )

  Deno.test(
    `document parity [${label}]: SSR emitted real, indexable text content`,
    async () => {
      const doc = await renderWith(renderer, pwa)
      assertEquals(doc.hasTextContent, true)
    },
  )

  Deno.test(
    `document parity [${label}]: the PWA contribution is present exactly when PWA is configured — ` +
      'orthogonal to the renderer, which is why there is no "PWA renderer" anywhere in this package',
    async () => {
      const doc = await renderWith(renderer, pwa)
      const manifests = doc.links.filter((link) => link.rel === 'manifest')
      if (pwa) {
        assertEquals(manifests, [{ rel: 'manifest', href: '/manifest.webmanifest' }])
        assertEquals(doc.meta['name:theme-color'], '#0af')
      } else {
        assertEquals(manifests, [])
        assertEquals(doc.meta['name:theme-color'], undefined)
      }
    },
  )
}

// ================================================================================================
// The actual parity assertions — same input, two renderers, identical semantics.
// ================================================================================================

Deno.test(
  'PARITY: React and Preact produce semantically identical documents from the same page, layout ' +
    'and resolved head — the divergence 1.1/1.2 existed to eliminate',
  async () => {
    const react = await renderWith('react', false)
    const preact = await renderWith('preact', false)
    assertEquals(comparableSemantics(preact), comparableSemantics(react))
  },
)

Deno.test(
  'PARITY: the same holds with PWA enabled — the manifest link and theme-color reach both ' +
    "renderers' documents identically",
  async () => {
    const react = await renderWith('react', true)
    const preact = await renderWith('preact', true)
    assertEquals(comparableSemantics(preact), comparableSemantics(react))
  },
)

Deno.test(
  'PARITY: enabling PWA changes ONLY the PWA contribution — everything else in the document is ' +
    'byte-for-byte the same semantics, in both renderers',
  async () => {
    for (const renderer of ['react', 'preact'] as const) {
      // Sequential on purpose: `renderWith` mutates process-wide registries (`setPwaConfig`,
      // `setCssManifest`) and restores them in its own `finally`, so two renders must never overlap.
      // deno-lint-ignore no-await-in-loop
      const withoutPwa = await renderWith(renderer, false)
      // deno-lint-ignore no-await-in-loop
      const withPwa = await renderWith(renderer, true)
      assertEquals(
        withoutPwaContribution(withPwa),
        withoutPwaContribution(withoutPwa),
        `renderer: ${renderer}`,
      )
    }
  },
)

Deno.test(
  'PARITY: h1 count agrees across renderers. Asserted as a PARITY signal only — @zanix/space does ' +
    'not require a document to have an h1 (A11Y006 is normative: false), and this assertion must ' +
    'never be read as making one part of the document contract',
  async () => {
    const react = await renderWith('react', false)
    const preact = await renderWith('preact', false)
    assertEquals(preact.h1Count, react.h1Count)
    assertEquals(react.h1Count, 1)
  },
)
