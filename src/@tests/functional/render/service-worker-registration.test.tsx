import { assert, assertEquals } from '@std/assert'
import { createElement as reactCreateElement } from 'react'
import { createElement as preactCreateElement } from 'preact'
import { SpacePageController } from 'modules/router/mod.ts'
import { setPageTree } from 'modules/router/page-tree-registry.ts'
import { mockPageContext } from 'modules/testing/mod.ts'
import { setPwaBuildOutput, setPwaConfig } from 'modules/pwa/pwa-registry.ts'
import { setDevClientEnabled } from 'modules/dev/dev-client-registry.ts'
import type { PwaConfig } from 'typings/pwa.ts'
import { renderPageResponse as renderReact } from 'modules/router/render-page-react.tsx'
import { renderPageResponse as renderPreact } from 'modules/router/render-page-preact.ts'
import { CSP_SIGNATURE_NONE } from 'modules/router/csp-signature.ts'

console.error = () => {}

// The service worker's registration script is emitted by each renderer's own serializer, from the
// same `resolvePwaHead()` contribution. `document-parity.test.tsx` compares `DocumentSemantics`,
// which does not include that script, so this suite asserts it directly: for every renderer × mode
// combination, the page registers `/sw.js` exactly when a worker exists to serve.

const REGISTER_SW = 'navigator.serviceWorker.register("/sw.js")'

const BASE: PwaConfig = { name: 'Example Store', icon: '/icon.png' }

function ReactView() {
  return reactCreateElement('main', null, 'page')
}

function PreactView() {
  return preactCreateElement('main', null, 'page')
}

class ReactPage extends SpacePageController {
  public override component = ReactView
}

class PreactPage extends SpacePageController {
  public override component = PreactView
}

type Mode = {
  label: string
  pwa: PwaConfig
  /** The client build output directory, or `undefined` when there is none. */
  buildOutput?: string
  dev: boolean
  /** Whether the page must register the service worker. */
  registers: boolean
}

const MODES: Mode[] = [
  { label: 'dev, push', pwa: { ...BASE, push: {} }, dev: true, registers: true },
  {
    label: 'dev, script',
    pwa: { ...BASE, serviceWorkerScript: './sw.js' },
    dev: true,
    registers: true,
  },
  { label: 'dev, plain pwa', pwa: BASE, dev: true, registers: false },
  { label: 'prod without build, push', pwa: { ...BASE, push: {} }, dev: false, registers: true },
  { label: 'prod without build, plain pwa', pwa: BASE, dev: false, registers: false },
  {
    label: 'prod built, push',
    pwa: { ...BASE, push: {} },
    buildOutput: '/dist',
    dev: false,
    registers: true,
  },
  { label: 'prod built, plain pwa', pwa: BASE, buildOutput: '/dist', dev: false, registers: true },
]

async function render(renderer: 'react' | 'preact', mode: Mode): Promise<string> {
  const Page = renderer === 'react' ? ReactPage : PreactPage
  setPageTree(Page, { filePath: `/fake/sw-${renderer}.tsx`, segments: [] })
  setPwaConfig(mode.pwa)
  setPwaBuildOutput(mode.buildOutput)
  setDevClientEnabled(mode.dev)
  try {
    const pageCtx = mockPageContext({ url: new URL('https://example.com/en/page') })
    const draw = renderer === 'react' ? renderReact : renderPreact
    const View = renderer === 'react' ? ReactView : PreactView
    const response = await draw(
      Page as never,
      View,
      pageCtx,
      undefined,
      false,
      undefined,
      undefined,
      CSP_SIGNATURE_NONE,
    )
    return await response.text()
  } finally {
    setPwaConfig(undefined)
    setPwaBuildOutput(undefined)
    setDevClientEnabled(false)
  }
}

for (const mode of MODES) {
  for (const renderer of ['react', 'preact'] as const) {
    Deno.test(
      `service worker registration [${renderer}, ${mode.label}]: ` +
        `${mode.registers ? 'registers' : 'does not register'} /sw.js`,
      async () => {
        const html = await render(renderer, mode)

        assertEquals(html.includes(REGISTER_SW), mode.registers, html)
        // Every PWA page links the manifest, whatever the worker situation.
        assert(html.includes('rel="manifest"'), html)
      },
    )
  }
}
