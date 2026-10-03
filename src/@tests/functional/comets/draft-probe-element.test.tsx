// Installs a renderer, exactly as a real app does: `@zanix/space` itself ships none, so a test
// that renders must import the entry point it is testing against.
import '../../../../mod-react.ts'
import '../../../../mod-preact.ts'
import { assert, assertEquals, assertFalse, assertStringIncludes } from '@std/assert'
import { createElement } from 'preact'
import { DraftProbe } from 'modules/comets/draft-probe-element.ts'
import { setActiveRenderer } from 'modules/router/active-renderer.ts'
import { renderToResponse as renderToResponseReact } from 'modules/render/render-to-response.tsx'
import { renderToResponse as renderToResponsePreact } from 'modules/render/render-to-response-preact.ts'

/**
 * `DraftProbe` is a plain server component, not a Comet: it renders one inline `<script>` that
 * carries the request's nonce and the form's id, under either renderer, and nothing at all when the
 * form's own comet renders the mark itself. Its nonce never goes through a Comet's props, which the
 * browser can read.
 *
 * @module
 */

console.error = () => {}

const DRAFT = { storageKey: 'triggers/new', hasServerValues: false }

type Props = Parameters<typeof DraftProbe>[0]

/** The HTML each renderer produces for the same probe. */
async function renderBoth(props: Props): Promise<{ react: string; preact: string }> {
  setActiveRenderer('react')
  const react = await (await renderToResponseReact(<DraftProbe {...props} />)).text()
  setActiveRenderer('preact')
  const preact = await (
    await renderToResponsePreact(createElement(DraftProbe as never, props))
  ).text()
  setActiveRenderer('react')
  return { react, preact }
}

Deno.test('DraftProbe (react and preact): renders one inline script with the nonce and the form id', async () => {
  const { react, preact } = await renderBoth({
    formId: 'new-trigger',
    draft: DRAFT,
    nonce: 'abc123',
  })

  for (const html of [react, preact]) {
    assertEquals(html.match(/<script/g)?.length, 1, html)
    assertStringIncludes(html, 'nonce="abc123"')
    assertStringIncludes(html, 'data-draft-probe="new-trigger"')
    assertStringIncludes(html, 'document.currentScript')
    assertStringIncludes(html, '"triggers/new"')
    assertStringIncludes(html, '"session"')
  }
})

Deno.test('DraftProbe (react and preact): the form keys include each controlled value, and the storage is the chosen one', async () => {
  const { react, preact } = await renderBoth({
    formId: 'new-trigger',
    draft: { ...DRAFT, storage: 'local', awaitValues: ['triggers/new/picked'] },
    nonce: 'n',
  })

  for (const html of [react, preact]) {
    assertStringIncludes(html, '["triggers/new","triggers/new/picked"]')
    assertStringIncludes(html, '"local"')
  }
})

Deno.test('DraftProbe (react and preact): no nonce attribute on a page with no nonce-based CSP', async () => {
  const { react, preact } = await renderBoth({ formId: 'new-trigger', draft: DRAFT })

  for (const html of [react, preact]) {
    assertStringIncludes(html, 'data-draft-probe="new-trigger"')
    assertFalse(html.includes('nonce'))
  }
})

Deno.test('DraftProbe (react and preact): renders nothing when the server already shows the values or restores after a failure', async () => {
  for (
    const draft of [
      { ...DRAFT, hasServerValues: true },
      { ...DRAFT, returnedFromFailure: true },
    ]
  ) {
    // deno-lint-ignore no-await-in-loop -- the active renderer is process-global, so one at a time.
    const { react, preact } = await renderBoth({ formId: 'new-trigger', draft, nonce: 'n' })
    for (const html of [react, preact]) assertFalse(html.includes('data-draft-probe'))
  }
  // `returnedFromFailure: false` is a form that opted in to recovery and was not sent back.
  const { react } = await renderBoth({
    formId: 'new-trigger',
    draft: { ...DRAFT, returnedFromFailure: false },
    nonce: 'n',
  })
  assert(react.includes('data-draft-probe'))
})

Deno.test('DraftProbe (react and preact): a form id that tries to end the script cannot', async () => {
  const { react, preact } = await renderBoth({
    formId: 'x</script><img src=x>',
    draft: { ...DRAFT, storageKey: 'k</script>' },
    nonce: 'n',
  })

  for (const html of [react, preact]) {
    assertEquals(html.match(/<\/script>/g)?.length, 1, html)
    assertFalse(html.includes('<img'))
  }
})
