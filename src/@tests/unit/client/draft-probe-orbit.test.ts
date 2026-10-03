import { assertEquals, assertNotEquals } from '@std/assert'
import { resetDom } from './dom-test-setup.ts'
import { reviveFragmentScripts } from 'modules/client/orbit.ts'
import { buildDraftProbeScript } from 'modules/comets/draft-probe.ts'

// The draft probe's inline script must run on both ways a form reaches the page: parsed as part of
// a full document, and arriving in an Orbit fragment, whose scripts only run because
// `reviveFragmentScripts` replaces them with fresh elements. This suite executes the real script
// text in happy-dom's own window (`enableJavaScriptEvaluation`), with the real
// `document.currentScript`, so what runs here is exactly what a browser runs; the browser-only
// facts (paint order, the CSP verdict) are checked by `deno task spike:draft-probe`.

const FRAGMENT_NONCE = 'fragment-nonce'

function probeHtml(formId: string, nonce: string): string {
  const source = buildDraftProbeScript({ formId, storageKeys: [formId] })
  return `<form id="${formId}"></form>` +
    `<script nonce="${nonce}" data-draft-probe="${formId}">${source}</script>`
}

function saveDraft(key: string, value: unknown): void {
  document.defaultView?.sessionStorage.setItem(`zn-space:${key}`, JSON.stringify(value))
}

function probe(formId: string): Element | null {
  return document.querySelector(`script[data-draft-probe="${formId}"]`)
}

Deno.test('draft probe (full load): a script created and connected marks the form it belongs to', async () => {
  resetDom()
  document.defaultView?.sessionStorage.clear()
  saveDraft('o1', { title: 'typed' })
  const script = document.createElement('script')
  script.setAttribute('data-draft-probe', 'o1')
  script.textContent = buildDraftProbeScript({ formId: 'o1', storageKeys: ['o1'] })

  document.body.appendChild(script)
  await Promise.resolve()

  assertEquals(probe('o1')?.getAttribute('data-draft-restoring'), 'o1')
})

Deno.test('draft probe (Orbit): a fragment brings the script, it runs once revived, and marks the form', async () => {
  resetDom()
  document.defaultView?.sessionStorage.clear()
  saveDraft('o2', { title: 'typed' })
  const template = document.createElement('template')
  template.innerHTML = probeHtml('o2', FRAGMENT_NONCE)

  reviveFragmentScripts(template.content, FRAGMENT_NONCE)
  document.body.appendChild(template.content)
  await Promise.resolve()

  assertEquals(probe('o2')?.getAttribute('data-draft-restoring'), 'o2')
  assertNotEquals(probe('o2')?.textContent, '')
})

Deno.test('draft probe (Orbit): a fragment on a clean form leaves no mark', async () => {
  resetDom()
  document.defaultView?.sessionStorage.clear()
  const template = document.createElement('template')
  template.innerHTML = probeHtml('o3', FRAGMENT_NONCE)

  reviveFragmentScripts(template.content, FRAGMENT_NONCE)
  document.body.appendChild(template.content)
  await Promise.resolve()

  assertEquals(probe('o3')?.hasAttribute('data-draft-restoring'), false)
})

Deno.test("draft probe (Orbit): a script whose nonce is not the fragment's own never runs", async () => {
  resetDom()
  document.defaultView?.sessionStorage.clear()
  saveDraft('o4', { title: 'typed' })
  const template = document.createElement('template')
  template.innerHTML = probeHtml('o4', 'someone-elses-nonce')

  reviveFragmentScripts(template.content, FRAGMENT_NONCE)
  document.body.appendChild(template.content)
  await Promise.resolve()

  assertEquals(probe('o4')?.hasAttribute('data-draft-restoring'), false)
})
