import { assertEquals } from '@std/assert'
import { createElement as reactCreateElement } from 'react'
import { createElement as preactCreateElement } from 'preact'
import { extractDocumentSemantics } from 'modules/render/document-semantics.ts'
import type { DocumentSemantics } from 'modules/render/document-model.ts'
import { comparableSemantics } from '../../support/document-parity.ts'
import type { HeadDescriptor } from 'modules/router/head-descriptor.ts'
import { setPwaConfig } from 'modules/pwa/mod.ts'
import { setCssManifest } from 'modules/render/css-manifest.ts'
import { DEFAULT_NOT_FOUND_HEAD } from 'modules/router/not-found-renderer-registry.ts'
import { renderNotFoundResponse as renderNotFoundReact } from 'modules/router/render-not-found-react.tsx'
import { renderNotFoundResponse as renderNotFoundPreact } from 'modules/router/render-not-found-preact.ts'

console.error = () => {}

// ================================================================================================
// A 404 is an ordinary document.
//
// This suite exists because it used not to be. `createNotFoundHandler` imported React's renderer
// directly and threw outright under `--renderer=preact`, so a Preact app had no not-found page at
// all — it fell through to `@zanix/server`'s own JSON error response, discovered on the first real
// 404 in production. It now builds a `DocumentModel` and dispatches through
// `not-found-renderer-registry.ts`, exactly as a page does.
//
// Nothing here asserts a not-found-specific rule about `<title>` or `<h1>`. What is asserted is
// that the same not-found view and the same head produce the same DOCUMENT SEMANTICS under either
// renderer — the identical bar every other document in this package is held to.
// ================================================================================================

function ReactNotFound() {
  return reactCreateElement('p', null, 'nothing here')
}
function PreactNotFound() {
  return preactCreateElement('p', null, 'nothing here')
}

function ReactRootLayout({ children }: { children: unknown }) {
  return reactCreateElement(
    'html',
    { lang: 'en' },
    reactCreateElement('head', null, reactCreateElement('meta', { charSet: 'utf-8' })),
    reactCreateElement('body', { 'data-testid': 'app-shell' }, children as never),
  )
}
function PreactRootLayout({ children }: { children: unknown }) {
  return preactCreateElement(
    'html',
    { lang: 'en' },
    preactCreateElement('head', null, preactCreateElement('meta', { charSet: 'utf-8' })),
    preactCreateElement('body', { 'data-testid': 'app-shell' }, children as never),
  )
}

type Scenario = {
  /** `undefined` exercises the default document shell. */
  withRootLayout: boolean
  head: HeadDescriptor | undefined
  pwa: boolean
}

async function renderNotFound(
  renderer: 'react' | 'preact',
  scenario: Scenario,
): Promise<DocumentSemantics> {
  setCssManifest({ global: ['/app.css'] })
  setPwaConfig(
    scenario.pwa ? { name: 'Example', icon: '/icon.png', themeColor: '#0af' } : undefined,
  )
  try {
    const render = renderer === 'react' ? renderNotFoundReact : renderNotFoundPreact
    const response = await render({
      NotFound: renderer === 'react' ? ReactNotFound : PreactNotFound,
      RootLayout: scenario.withRootLayout
        ? (renderer === 'react' ? ReactRootLayout : PreactRootLayout)
        : undefined,
      lang: 'default',
      head: scenario.head,
      fragmentOnly: false,
    })
    return extractDocumentSemantics(await response.text())
  } finally {
    setCssManifest(undefined)
    setPwaConfig(undefined)
  }
}

const SCENARIOS: Array<{ label: string; scenario: Scenario }> = [
  {
    label: 'default shell, default head',
    scenario: { withRootLayout: false, head: DEFAULT_NOT_FOUND_HEAD, pwa: false },
  },
  {
    label: 'default shell, default head, PWA',
    scenario: { withRootLayout: false, head: DEFAULT_NOT_FOUND_HEAD, pwa: true },
  },
  {
    label: 'custom root layout, default head',
    scenario: { withRootLayout: true, head: DEFAULT_NOT_FOUND_HEAD, pwa: false },
  },
  {
    label: 'custom root layout, default head, PWA',
    scenario: { withRootLayout: true, head: DEFAULT_NOT_FOUND_HEAD, pwa: true },
  },
  {
    label: "custom root layout, app's own not-found head",
    scenario: {
      withRootLayout: true,
      head: {
        title: 'Not found',
        meta: [
          { name: 'description', content: 'Esta página no existe.' },
          { name: 'robots', content: 'noindex' },
        ],
      },
      pwa: false,
    },
  },
]

for (const { label, scenario } of SCENARIOS) {
  Deno.test(
    `not-found parity [${label}]: React and Preact produce the same document semantics`,
    async () => {
      const react = await renderNotFound('react', scenario)
      const preact = await renderNotFound('preact', scenario)
      assertEquals(comparableSemantics(preact), comparableSemantics(react))
    },
  )
}

for (const renderer of ['react', 'preact'] as const) {
  Deno.test(
    `not-found [${renderer}]: the response is a real, complete document — not a bare fragment and ` +
      "not @zanix/server's JSON fallback",
    async () => {
      const doc = await renderNotFound(renderer, {
        withRootLayout: false,
        head: DEFAULT_NOT_FOUND_HEAD,
        pwa: false,
      })
      assertEquals(doc.isDocument, true)
      assertEquals(doc.lang, 'en')
      assertEquals(doc.hasMetaCharset, true)
      assertEquals(doc.hasTextContent, true)
    },
  )

  Deno.test(
    `not-found [${renderer}]: the title comes from the document model, so a CUSTOM root layout that ` +
      'cooperates in no way still gets it — the case that used to lose it entirely under Preact',
    async () => {
      const doc = await renderNotFound(renderer, {
        withRootLayout: true,
        head: DEFAULT_NOT_FOUND_HEAD,
        pwa: false,
      })
      assertEquals(doc.titles, ['Page not found'])
    },
  )

  Deno.test(
    `not-found [${renderer}]: an app's own not-found head fully replaces the default — the same ` +
      'resolution path a page head takes, with no not-found-specific mechanism',
    async () => {
      const doc = await renderNotFound(renderer, {
        withRootLayout: true,
        head: { title: 'Not found', meta: [{ name: 'robots', content: 'noindex' }] },
        pwa: false,
      })
      assertEquals(doc.titles, ['Not found'])
      assertEquals(doc.meta['name:robots'], 'noindex')
    },
  )

  Deno.test(
    `not-found [${renderer}]: with no head at all the document simply has no title — there is no ` +
      'fallback rule forcing one onto a 404, because a 404 is not special',
    async () => {
      const doc = await renderNotFound(renderer, {
        withRootLayout: true,
        head: undefined,
        pwa: false,
      })
      assertEquals(doc.titles, [])
      // Still a complete document in every other respect.
      assertEquals(doc.isDocument, true)
    },
  )

  Deno.test(
    `not-found [${renderer}]: the PWA contribution reaches the 404 document too, exactly as it ` +
      'reaches a page',
    async () => {
      const doc = await renderNotFound(renderer, {
        withRootLayout: false,
        head: DEFAULT_NOT_FOUND_HEAD,
        pwa: true,
      })
      assertEquals(
        doc.links.filter((link) => link.rel === 'manifest'),
        [{ rel: 'manifest', href: '/manifest.webmanifest' }],
      )
      assertEquals(doc.meta['name:theme-color'], '#0af')
    },
  )
}

Deno.test(
  'not-found: the built-in default views carry NO <title> of their own — it comes from ' +
    'DEFAULT_NOT_FOUND_HEAD through the document model. React used to render one in JSX and got ' +
    'away with it only because of hoisting, which Preact has no equivalent of, so the same ' +
    'built-in view produced two different documents',
  async () => {
    const { DefaultNotFoundView: ReactDefault } = await import(
      'modules/router/default-not-found-view.tsx'
    )
    const { DefaultNotFoundView: PreactDefault } = await import(
      'modules/router/default-not-found-view-preact.ts'
    )
    const cases = [
      ['react', ReactDefault, renderNotFoundReact],
      ['preact', PreactDefault, renderNotFoundPreact],
    ] as const
    const docs = await Promise.all(
      cases.map(async ([renderer, View, render]) => {
        const response = await render({
          NotFound: View,
          RootLayout: undefined,
          lang: 'default',
          head: undefined,
          fragmentOnly: false,
        })
        return { renderer, doc: extractDocumentSemantics(await response.text()) }
      }),
    )
    for (const { renderer, doc } of docs) {
      assertEquals(doc.titles, [], `renderer: ${renderer}`)
      assertEquals(doc.h1Count, 1, `renderer: ${renderer}`)
    }
  },
)
