// Installs both renderers, exactly as a real app does with whichever it picks.
import '../../../../mod-react.ts'
import '../../../../mod-preact.ts'
import { assertEquals, assertFalse } from '@std/assert'
import { createElement as createElementReact } from 'react'
import { createElement as createElementPreact } from 'preact'
import { SpacePageController } from 'modules/router/mod.ts'
import { setPageTree } from 'modules/router/page-tree-registry.ts'
import { mockPageContext } from 'modules/testing/mod.ts'
import { setCssManifest } from 'modules/render/css-manifest.ts'
import { setDevClientEnabled } from 'modules/dev/dev-client-registry.ts'
import { setRootLayoutStyles } from 'modules/router/app-shell-registry.ts'
import { renderPageResponse as renderPageReact } from 'modules/router/render-page-react.tsx'
import { renderPageResponse as renderPagePreact } from 'modules/router/render-page-preact.ts'
import { renderNotFoundResponse as renderNotFoundReact } from 'modules/router/render-not-found-react.tsx'
import { renderNotFoundResponse as renderNotFoundPreact } from 'modules/router/render-not-found-preact.ts'
import { renderLoaderErrorResponse as renderLoaderErrorReact } from 'modules/router/render-loader-error-react.tsx'
import { renderLoaderErrorResponse as renderLoaderErrorPreact } from 'modules/router/render-loader-error-preact.ts'
import { DefaultErrorView as DefaultErrorViewReact } from 'modules/router/default-error-view.tsx'
import { DefaultErrorView as DefaultErrorViewPreact } from 'modules/router/default-error-view-preact.ts'
import { setActiveRenderer } from 'modules/router/active-renderer.ts'
import { extractStylesheetLinks } from 'modules/client/orbit.ts'
import { CSP_SIGNATURE_NONE } from 'modules/router/csp-signature.ts'

console.error = () => {}

const PAGE = '/fake/routes/area/leaf/page.tsx'
const ROOT_LAYOUT = '/fake/routes/layout.tsx'
const AREA_LAYOUT = '/fake/routes/area/layout.tsx'

class AreaPage extends SpacePageController {
  public override component = null
  public static override styles = ['./leaf.css']
}

function reset() {
  setCssManifest(undefined)
  setDevClientEnabled(false)
  setRootLayoutStyles(undefined)
  setActiveRenderer('react')
}

/** The hrefs of every `<link rel="stylesheet">` of a full document, in document order. */
function documentHrefs(html: string): string[] {
  return extractStylesheetLinks(html).refs.map((ref) => ref.href)
}

const renderers = [
  {
    name: 'react',
    renderPage: renderPageReact,
    renderNotFound: renderNotFoundReact,
    renderLoaderError: renderLoaderErrorReact,
    ErrorView: DefaultErrorViewReact,
    element: () => createElementReact('p', null, 'ok'),
  },
  {
    name: 'preact',
    renderPage: renderPagePreact,
    renderNotFound: renderNotFoundPreact,
    renderLoaderError: renderLoaderErrorPreact,
    ErrorView: DefaultErrorViewPreact,
    element: () => createElementPreact('p', null, 'ok'),
  },
] as const

for (const renderer of renderers) {
  const render = (fragmentOnly: boolean) =>
    renderer.renderPage(
      AreaPage,
      renderer.element,
      mockPageContext(),
      undefined,
      fragmentOnly,
      undefined,
      undefined,
      CSP_SIGNATURE_NONE,
    ).then((response) => response.text())

  const install = (manifest = true) => {
    setActiveRenderer(renderer.name)
    setPageTree(AreaPage, {
      filePath: PAGE,
      segments: [
        { layoutFilePath: ROOT_LAYOUT },
        { layoutFilePath: AREA_LAYOUT },
        {},
      ],
    })
    if (manifest) {
      setCssManifest({
        global: ['/assets/global.css'],
        layouts: {
          [ROOT_LAYOUT]: ['/assets/root-layout.css'],
          [AREA_LAYOUT]: ['/assets/area-layout.css'],
        },
        pages: { [PAGE]: ['/assets/leaf.css'] },
      })
    }
  }

  Deno.test(
    `render layout styles (${renderer.name}): a full document links global, then each layout from ` +
      'the root to the nearest, then the page — the cascade order',
    async () => {
      install()
      try {
        assertEquals(documentHrefs(await render(false)), [
          '/assets/global.css',
          '/assets/root-layout.css',
          '/assets/area-layout.css',
          '/assets/leaf.css',
        ])
      } finally {
        reset()
      }
    },
  )

  Deno.test(
    `render layout styles (${renderer.name}): an Orbit fragment carries the layouts and the page, ` +
      'never global, in the same order',
    async () => {
      install()
      try {
        const html = await render(true)
        assertFalse(html.includes('global.css'), html)
        assertEquals(extractStylesheetLinks(html).refs.map((ref) => ref.href), [
          '/assets/root-layout.css',
          '/assets/area-layout.css',
          '/assets/leaf.css',
        ])
      } finally {
        reset()
      }
    },
  )

  Deno.test(
    `render layout styles (${renderer.name}): a stylesheet two scopes both list links once, at its ` +
      'first position',
    async () => {
      install(false)
      setCssManifest({
        global: ['/assets/shared.css'],
        layouts: {
          [ROOT_LAYOUT]: ['/assets/shared.css', '/assets/root-layout.css'],
          [AREA_LAYOUT]: ['/assets/root-layout.css'],
        },
        pages: { [PAGE]: ['/assets/shared.css', '/assets/leaf.css'] },
      })
      try {
        assertEquals(documentHrefs(await render(false)), [
          '/assets/shared.css',
          '/assets/root-layout.css',
          '/assets/leaf.css',
        ])
        assertEquals(extractStylesheetLinks(await render(true)).refs.map((ref) => ref.href), [
          '/assets/shared.css',
          '/assets/root-layout.css',
          '/assets/leaf.css',
        ])
      } finally {
        reset()
      }
    },
  )

  Deno.test(
    `render layout styles (${renderer.name}): without layout styles the document is what it was — ` +
      'global, then the page',
    async () => {
      install(false)
      setCssManifest({
        global: ['/assets/global.css'],
        pages: { [PAGE]: ['/assets/leaf.css'] },
      })
      try {
        assertEquals(documentHrefs(await render(false)), [
          '/assets/global.css',
          '/assets/leaf.css',
        ])
      } finally {
        reset()
      }
    },
  )

  Deno.test(
    `render layout styles (${renderer.name}, dev): each layout's live styles resolve relative to ` +
      'its own file, as ?direct hrefs, in the same order',
    async () => {
      setDevClientEnabled(true)
      setActiveRenderer(renderer.name)
      setPageTree(AreaPage, {
        filePath: 'src/routes/area/leaf/page.tsx',
        segments: [
          { layoutFilePath: 'src/routes/layout.tsx', styles: ['./root.css'] },
          { layoutFilePath: 'src/routes/area/layout.tsx', styles: ['./area.css'] },
          {},
        ],
      })
      try {
        const hrefs = documentHrefs(await render(false))
        assertEquals(hrefs.slice(-3), [
          '/src/routes/root.css?direct',
          '/src/routes/area/area.css?direct',
          '/src/routes/area/leaf/leaf.css?direct',
        ])
      } finally {
        reset()
      }
    },
  )

  Deno.test(
    `render layout styles (${renderer.name}): the not-found page and a failed loader's document ` +
      'link the root layout styles after global',
    async () => {
      setActiveRenderer(renderer.name)
      setCssManifest({
        global: ['/assets/global.css'],
        layouts: { [ROOT_LAYOUT]: ['/assets/root-layout.css'] },
      })
      setRootLayoutStyles({ layoutFilePath: ROOT_LAYOUT })
      try {
        const notFound = await renderer.renderNotFound({
          NotFound: () => null,
          RootLayout: undefined,
          head: undefined,
          fragmentOnly: false,
          lang: undefined,
        }).then((response) => response.text())
        assertEquals(documentHrefs(notFound), ['/assets/global.css', '/assets/root-layout.css'])

        const failed = await renderer.renderLoaderError({
          ErrorFallback: renderer.ErrorView,
          RootLayout: undefined,
          error: new Error('boom'),
          formattedError: {},
          params: {},
          fragmentOnly: false,
        }).then((response) => response.text())
        assertEquals(documentHrefs(failed), ['/assets/global.css', '/assets/root-layout.css'])
      } finally {
        reset()
      }
    },
  )
}
