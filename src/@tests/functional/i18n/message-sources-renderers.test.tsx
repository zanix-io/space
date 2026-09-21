// Installs both renderers, exactly as a test that renders under each one must.
import '../../../../mod-react.ts'
import '../../../../mod-preact.ts'
import { assert, assertEquals } from '@std/assert'
import { join } from '@std/path'
import { createElement } from 'preact'
import { getTemporaryFolder } from '@zanix/helpers'
import { setDevClientEnabled } from 'modules/dev/dev-client-registry.ts'
import { loadMessages, resetMessagesCache } from 'modules/i18n/load-messages.ts'
import type { Messages } from 'modules/i18n/load-messages.ts'
import {
  resetMessagesDir,
  resetMessageSources,
  setMessagesDir,
  setMessageSources,
} from 'modules/i18n/messages-registry.ts'
import { setActiveRenderer } from 'modules/router/active-renderer.ts'
import { renderToResponse as renderToResponseReact } from 'modules/render/render-to-response.tsx'
import { renderToResponse as renderToResponsePreact } from 'modules/render/render-to-response-preact.ts'

/**
 * `loadMessages` returns plain data, so what a renderer does with it must not depend on which
 * renderer it is. This resolves one catalog from a directory plus a source and renders it through
 * both renderers, in dev mode (no cache) and outside it (cached), asserting the same strings
 * arrive: the app's own key wins, the source fills in the rest.
 *
 * @module
 */

console.error = () => {}

const heading = (messages: Messages) => String(messages['login/heading'])
const submit = (messages: Messages) => String(messages['login/submit'])

function reset() {
  resetMessagesDir()
  resetMessageSources()
  resetMessagesCache()
  setDevClientEnabled(false)
  setActiveRenderer('react')
}

for (const dev of [false, true]) {
  Deno.test(
    `messageSources render identically under react and preact (${dev ? 'dev' : 'prod'} mode)`,
    async () => {
      const dir = await Deno.makeTempDir({ dir: getTemporaryFolder(import.meta.url) })
      try {
        await Deno.mkdir(join(dir, 'en'), { recursive: true })
        await Deno.writeTextFile(
          join(dir, 'en', 'index.json'),
          JSON.stringify({ 'login/heading': 'Welcome back' }),
        )
        setMessagesDir(dir)
        setMessageSources([() => ({ 'login/heading': 'Sign in', 'login/submit': 'Continue' })])
        setDevClientEnabled(dev)

        const messages = await loadMessages({ lang: 'en' })
        assertEquals(messages, { 'login/heading': 'Welcome back', 'login/submit': 'Continue' })

        const reactHtml = await (await renderToResponseReact(
          <main>
            <h1>{heading(messages)}</h1>
            <button type='submit'>{submit(messages)}</button>
          </main>,
        )).text()

        setActiveRenderer('preact')
        const preactHtml = await (await renderToResponsePreact(
          createElement('main', null, [
            createElement('h1', null, heading(messages)),
            createElement('button', { type: 'submit' }, submit(messages)),
          ]),
        )).text()

        for (const html of [reactHtml, preactHtml]) {
          assert(html.includes('Welcome back</h1>'), html)
          assert(html.includes('Continue</button>'), html)
          assert(!html.includes('Sign in'), html)
        }
      } finally {
        reset()
        await Deno.remove(dir, { recursive: true })
      }
    },
  )
}
