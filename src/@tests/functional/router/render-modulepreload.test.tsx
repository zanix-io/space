// Installs both renderers, exactly as a real app does with whichever it picks.
import '../../../../mod-react.ts'
import '../../../../mod-preact.ts'
import { assert, assertEquals, assertFalse } from '@std/assert'
import { createElement as createElementReact } from 'react'
import { createElement as createElementPreact } from 'preact'
import { SpacePageController } from 'modules/router/mod.ts'
import { setPageTree } from 'modules/router/page-tree-registry.ts'
import { mockPageContext } from 'modules/testing/mod.ts'
import { setCssManifest } from 'modules/render/css-manifest.ts'
import { setDevClientEnabled } from 'modules/dev/dev-client-registry.ts'
import { renderPageResponse as renderPageReact } from 'modules/router/render-page-react.tsx'
import { renderPageResponse as renderPagePreact } from 'modules/router/render-page-preact.ts'
import { defineComet } from 'modules/comets/define-comet.ts'
import { setCometManifest } from 'modules/comets/comet-manifest.ts'
import { CLIENT_ENTRY_VIRTUAL_ID, setClientEntryManifest } from 'modules/render/client-entry.ts'
import {
  setModulePreloadEnabled,
  setModulePreloadManifest,
} from 'modules/render/modulepreload-manifest.ts'
import { setActiveRenderer } from 'modules/router/active-renderer.ts'
import { CSP_SIGNATURE_NONE } from 'modules/router/csp-signature.ts'

console.error = () => {}

const PAGE = '/fake/routes/preload/page.tsx'
const WIDGET_SOURCE = `file://${Deno.cwd()}/comets/preload-widget.tsx`
const OTHER_SOURCE = `file://${Deno.cwd()}/comets/preload-other.tsx`
const keyOf = (source: string) => new URL(source).pathname

const ENTRY = '/assets/entry-EEE.js'
const WIDGET = '/assets/widget-AAA.js'
const OTHER = '/assets/other-BBB.js'
const SHARED = '/assets/shared-CCC.js'
const RUNTIME = '/assets/runtime-DDD.js'

/** What `modulePreloadPlugin` writes for the fake build: `SHARED` is imported by both comets and
 * `RUNTIME` by the entry and by the widget. */
const PRELOADS = {
  [ENTRY]: [RUNTIME],
  [WIDGET]: [SHARED, RUNTIME],
  [OTHER]: [SHARED],
}

class PreloadPage extends SpacePageController {
  public override component = null
}

function reset() {
  setCssManifest(undefined)
  setDevClientEnabled(false)
  setCometManifest(undefined)
  setClientEntryManifest(undefined)
  setModulePreloadManifest(undefined)
  setModulePreloadEnabled(true)
}

function installBuild() {
  setPageTree(PreloadPage, { filePath: PAGE, segments: [] })
  setCssManifest({
    global: ['/assets/global.css'],
    comets: { [keyOf(WIDGET_SOURCE)]: ['/assets/widget.css'] },
  })
  setCometManifest({ [keyOf(WIDGET_SOURCE)]: WIDGET, [keyOf(OTHER_SOURCE)]: OTHER })
  setClientEntryManifest({ [CLIENT_ENTRY_VIRTUAL_ID]: ENTRY })
  setModulePreloadManifest(PRELOADS)
}

/** Every `<link rel="modulepreload">` href, in document order. */
function preloadHrefs(html: string): string[] {
  return [...html.matchAll(/<link\s[^>]*?rel="modulepreload"[^>]*?>/g)].flatMap((link) => {
    const href = /href="([^"]*)"/.exec(link[0])?.[1]
    return href === undefined ? [] : [href]
  })
}

/** The index of the first tag in `html` matching `pattern`. */
const indexOfTag = (html: string, pattern: RegExp) => html.search(pattern)

function Widget() {
  return null
}
function Other() {
  return null
}

const renderers = [
  { name: 'react', renderPage: renderPageReact, h: createElementReact },
  { name: 'preact', renderPage: renderPagePreact, h: createElementPreact },
] as const

for (const renderer of renderers) {
  const render = async (
    options: { comets?: boolean; fragment?: boolean; nonce?: string } = {},
  ) => {
    const { comets = true, fragment = false, nonce } = options
    setActiveRenderer(renderer.name)
    // deno-lint-ignore no-explicit-any
    const h = renderer.h as any
    const WidgetComet = defineComet(Widget, WIDGET_SOURCE)
    const OtherComet = defineComet(Other, OTHER_SOURCE)
    const Body = comets
      ? () => h('main', null, h(WidgetComet, {}), h(OtherComet, {}), h(WidgetComet, {}))
      : () => h('main', null, 'no comets')
    // deno-lint-ignore no-explicit-any
    const response = await (renderer.renderPage as any)(
      PreloadPage,
      Body,
      mockPageContext(nonce ? { cspNonce: nonce } : undefined),
      undefined,
      fragment,
      nonce,
      undefined,
      CSP_SIGNATURE_NONE,
    )
    return await response.text() as string
  }

  Deno.test(
    `modulepreload (${renderer.name}): the entry and the comets come with what they import, each ` +
      'URL once, after the page stylesheet',
    async () => {
      reset()
      installBuild()
      try {
        const html = await render()
        const hrefs = preloadHrefs(html)
        for (const url of [ENTRY, RUNTIME, WIDGET, SHARED, OTHER]) {
          assert(hrefs.includes(url), `${url} missing from ${JSON.stringify(hrefs)}`)
        }
        // The widget renders twice and two chunks import SHARED: each is still linked once.
        assertEquals(new Set(hrefs).size, hrefs.length, JSON.stringify(hrefs))
        // The page stylesheet comes before every preload: a preload must never delay the CSS.
        const firstPreload = indexOfTag(html, /<link[^>]*rel="modulepreload"/)
        const globalCss = html.indexOf('href="/assets/global.css"')
        assert(globalCss >= 0 && firstPreload >= 0, html)
        assert(globalCss < firstPreload, `a modulepreload precedes the page stylesheet:\n${html}`)
        // React hoists every stylesheet into `<head>` and every preload after them. Preact has no
        // hoisting: a comet's own stylesheet renders where the comet does, which is documented.
        if (renderer.name === 'react') {
          assert(html.lastIndexOf('rel="stylesheet"') < firstPreload, html)
          assert(html.includes('href="/assets/widget.css"'), html)
        }
      } finally {
        reset()
      }
    },
  )

  Deno.test(
    `modulepreload (${renderer.name}): a page with no comet emits no preload of its own`,
    async () => {
      reset()
      installBuild()
      try {
        const hrefs = preloadHrefs(await render({ comets: false }))
        // React preloads its own bootstrap script at low priority; nothing else may appear.
        for (const url of [RUNTIME, WIDGET, SHARED, OTHER]) assertFalse(hrefs.includes(url), url)
        assertFalse(
          hrefs.length > 1 || (hrefs.length === 1 && hrefs[0] !== ENTRY),
          JSON.stringify(hrefs),
        )
        if (renderer.name === 'preact') assertEquals(hrefs, [])
      } finally {
        reset()
      }
    },
  )

  Deno.test(
    `modulepreload (${renderer.name}): nothing with the option off, no manifest, or none of the ` +
      "chunk's dependencies listed",
    async () => {
      reset()
      installBuild()
      try {
        setModulePreloadEnabled(false)
        const off = preloadHrefs(await render())
        for (const url of [RUNTIME, WIDGET, SHARED, OTHER]) assertFalse(off.includes(url), url)

        setModulePreloadEnabled(true)
        setModulePreloadManifest(undefined)
        const none = preloadHrefs(await render())
        for (const url of [RUNTIME, WIDGET, SHARED, OTHER]) assertFalse(none.includes(url), url)

        // An empty manifest still preloads the chunks themselves, but none of their imports.
        setModulePreloadManifest({})
        const bare = preloadHrefs(await render())
        assert(bare.includes(WIDGET) && bare.includes(OTHER), JSON.stringify(bare))
        assertFalse(bare.includes(SHARED) || bare.includes(RUNTIME), JSON.stringify(bare))
      } finally {
        reset()
      }
    },
  )

  Deno.test(
    `modulepreload (${renderer.name}): an Orbit fragment carries the comets' preloads, once each, ` +
      'and no stylesheet or head',
    async () => {
      reset()
      installBuild()
      try {
        const html = await render({ fragment: true })
        const hrefs = preloadHrefs(html)
        for (const url of [WIDGET, SHARED, OTHER]) assert(hrefs.includes(url), url)
        assertEquals(new Set(hrefs).size, hrefs.length, JSON.stringify(hrefs))
        assertFalse(html.includes('<head'), html)
      } finally {
        reset()
      }
    },
  )
}

Deno.test(
  'modulepreload (preact): the response drops a repeated link whichever comet asked first',
  async () => {
    reset()
    installBuild()
    try {
      setActiveRenderer('preact')
      const counts = new Map<string, number>()
      for (
        const href of preloadHrefs(
          await (async () => {
            // deno-lint-ignore no-explicit-any
            const h = createElementPreact as any
            const W = defineComet(Widget, WIDGET_SOURCE)
            const O = defineComet(Other, OTHER_SOURCE)
            // deno-lint-ignore no-explicit-any
            const response = await (renderPagePreact as any)(
              PreloadPage,
              () => h('main', null, h(O, {}), h(W, {}), h(O, {})),
              mockPageContext(),
              undefined,
              false,
              undefined,
              undefined,
              CSP_SIGNATURE_NONE,
            )
            return await response.text()
          })(),
        )
      ) counts.set(href, (counts.get(href) ?? 0) + 1)
      assertEquals([...counts.values()].every((n) => n === 1), true, JSON.stringify([...counts]))
    } finally {
      reset()
    }
  },
)
