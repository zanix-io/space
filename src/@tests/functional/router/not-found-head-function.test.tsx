// Installs a renderer, exactly as a real app does: `@zanix/space` itself ships none, so a
// test that renders must import the entry point it is testing against.
import '../../../../mod-react.ts'
import { assert, assertEquals } from '@std/assert'
import { join } from '@std/path'
import logger from '@zanix/logger'
import { getTemporaryFolder } from '@zanix/helpers'
import { renderNotFoundResponse } from 'modules/router/not-found-handler.ts'
import { setNotFoundHead } from 'modules/router/app-shell-registry.ts'
import { setActiveRenderer } from 'modules/router/active-renderer.ts'
import { setPageRenderer } from 'modules/router/page-renderer-registry.ts'
import { setNotFoundRenderer } from 'modules/router/not-found-renderer-registry.ts'
import { renderPageResponse as renderPageReact } from 'modules/router/render-page-react.tsx'
import { renderNotFoundResponse as renderNotFoundReact } from 'modules/router/render-not-found-react.tsx'
import { resetMessagesDir, setMessagesDir } from 'modules/i18n/messages-registry.ts'
import { resetMessagesCache } from 'modules/i18n/load-messages.ts'
import type { NotFoundHead } from 'typings/page.ts'

console.error = () => {}

// `not-found.tsx`'s `head` export as a function of `{ lang, messages }`, evaluated by
// `renderNotFoundResponse` — the one function every 404 path (the `onError` handler and a
// `loader`-thrown `NOT_FOUND`) goes through — under both renderers, for the full document and the
// Orbit fragment.

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
  setNotFoundHead(undefined)
  resetMessagesDir()
  resetMessagesCache()
}

/** Replaces `logger.error` with a spy for the duration of `run`. */
async function withLoggedErrors(run: () => Promise<void>): Promise<unknown[][]> {
  const calls: unknown[][] = []
  const original = logger.error
  logger.error = ((...args: unknown[]) => {
    calls.push(args)
  }) as typeof logger.error
  try {
    await run()
  } finally {
    logger.error = original
  }
  return calls
}

for (const renderer of ['react', 'preact'] as const) {
  Deno.test(`not-found head [${renderer}]: a static object head is used unchanged`, async () => {
    await activate(renderer)
    try {
      setNotFoundHead({ title: 'Static title' })
      const html = await (await renderNotFoundResponse(false, 'es')).text()
      assert(html.includes('<title>Static title</title>'), html)
    } finally {
      restore()
    }
  })

  Deno.test(
    `not-found head [${renderer}]: a function head receives lang and messages, in the full ` +
      'document and in the Orbit fragment',
    async () => {
      await activate(renderer)
      const messagesDir = await Deno.makeTempDir({ dir: getTemporaryFolder(import.meta.url) })
      try {
        await Deno.mkdir(join(messagesDir, 'es'), { recursive: true })
        await Deno.writeTextFile(
          join(messagesDir, 'es', 'index.json'),
          JSON.stringify({ 'not-found/heading': 'Página no encontrada' }),
        )
        setMessagesDir(messagesDir)
        const received: unknown[] = []
        const head: NotFoundHead = ({ lang, messages }) => {
          received.push(lang)
          return { title: `${lang}: ${messages?.['not-found/heading']}` }
        }
        setNotFoundHead(head)

        const full = await (await renderNotFoundResponse(false, 'es')).text()
        assert(full.includes('<title>es: Página no encontrada</title>'), full)
        const fragment = await renderNotFoundResponse(true, 'es')
        assertEquals(fragment.status, 404)
        const fragmentHtml = await fragment.text()
        assert(fragmentHtml.includes('<title>es: Página no encontrada</title>'), fragmentHtml)
        assert(!fragmentHtml.includes('<!DOCTYPE html>'), fragmentHtml)
        assertEquals(received, ['es', 'es'])
      } finally {
        restore()
        await Deno.remove(messagesDir, { recursive: true })
      }
    },
  )

  Deno.test(
    `not-found head [${renderer}]: a function head gets an undefined lang and messages for an ` +
      'app with no langPreHandler and no messagesDir',
    async () => {
      await activate(renderer)
      try {
        let props: unknown
        setNotFoundHead((received) => {
          props = received
          return { title: 'No lang' }
        })
        const html = await (await renderNotFoundResponse(false)).text()
        assert(html.includes('<title>No lang</title>'), html)
        assertEquals(props, { lang: undefined, messages: undefined })
      } finally {
        restore()
      }
    },
  )

  Deno.test(
    `not-found head [${renderer}]: a function head that throws still serves the 404 with the ` +
      'default head and logs the error',
    async () => {
      await activate(renderer)
      try {
        setNotFoundHead(() => {
          throw new Error('head boom')
        })
        let status = 0
        let html = ''
        const calls = await withLoggedErrors(async () => {
          const response = await renderNotFoundResponse(false, 'en')
          status = response.status
          html = await response.text()
        })
        assertEquals(status, 404)
        assert(html.includes('<title>Page not found</title>'), html)
        assertEquals(calls.length, 1)
        assert((calls[0][1] as Error).message === 'head boom')
      } finally {
        restore()
      }
    },
  )
}
