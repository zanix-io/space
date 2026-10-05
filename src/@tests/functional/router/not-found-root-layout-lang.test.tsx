// Installs a renderer, exactly as a real app does: `@zanix/space` itself ships none, so a
// test that renders must import the entry point it is testing against.
import '../../../../mod-react.ts'
import { assert } from '@std/assert'
import { renderNotFoundResponse } from 'modules/router/not-found-handler.ts'
import { setRootLayout } from 'modules/router/app-shell-registry.ts'
import { setActiveRenderer } from 'modules/router/active-renderer.ts'
import { setPageRenderer } from 'modules/router/page-renderer-registry.ts'
import { setNotFoundRenderer } from 'modules/router/not-found-renderer-registry.ts'
import { renderPageResponse as renderPageReact } from 'modules/router/render-page-react.tsx'
import { renderNotFoundResponse as renderNotFoundReact } from 'modules/router/render-not-found-react.tsx'

console.error = () => {}

// The root layout of a 404 receives the resolved language as `params.lang` (so `<html lang>` can
// match the content), and `params={}` when the app has no `langPreHandler`, under both renderers.

type Renderer = 'react' | 'preact'

async function activate(renderer: Renderer): Promise<void> {
  if (renderer === 'preact') {
    const { renderPageResponse } = await import('modules/router/render-page-preact.ts')
    const { renderNotFoundResponse } = await import('modules/router/render-not-found-preact.ts')
    setActiveRenderer('preact')
    setPageRenderer(renderPageResponse)
    setNotFoundRenderer(renderNotFoundResponse)
  }
}

function restore(): void {
  setActiveRenderer('react')
  setPageRenderer(renderPageReact)
  setNotFoundRenderer(renderNotFoundReact)
  setRootLayout(undefined)
}

// Plain JSX-free element factories would differ per renderer; a layout returning a string-typed
// structure through the renderer's own `createElement` keeps one definition for both.
async function layoutFor(renderer: Renderer): Promise<unknown> {
  const { createElement } = renderer === 'preact' ? await import('preact') : await import('react')
  return ({ params, children }: { params: Record<string, string>; children: unknown }) =>
    // deno-lint-ignore no-explicit-any
    (createElement as any)(
      'html',
      { lang: params.lang ?? 'none' },
      // deno-lint-ignore no-explicit-any
      (createElement as any)('body', null, children),
    )
}

for (const renderer of ['react', 'preact'] as const) {
  Deno.test(`not-found root layout [${renderer}]: receives params.lang when a lang is resolved`, async () => {
    await activate(renderer)
    try {
      setRootLayout(await layoutFor(renderer))
      const html = await (await renderNotFoundResponse(false, 'en')).text()
      assert(html.includes('<html lang="en"'), html)
    } finally {
      restore()
    }
  })

  Deno.test(`not-found root layout [${renderer}]: receives params={} without langPreHandler`, async () => {
    await activate(renderer)
    try {
      setRootLayout(await layoutFor(renderer))
      const html = await (await renderNotFoundResponse(false)).text()
      assert(html.includes('<html lang="none"'), html)
    } finally {
      restore()
    }
  })
}
