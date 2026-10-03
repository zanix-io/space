import { assert, assertEquals, assertFalse, assertStringIncludes } from '@std/assert'
import { installTimerMock, resetDom } from './dom-test-setup.ts'
import {
  buildDraftProbeScript,
  clearDraftProbe,
  DRAFT_RESTORE_TIMEOUT_MS,
  isDraftProbeMarked,
  probeDraft,
} from 'modules/comets/draft-probe.ts'

// deno-lint-ignore no-explicit-any
const globals = globalThis as any

/** A probe `<script>` on the page, and the script text a server would give it. */
function mountProbe(
  formId: string,
  options: { storageKeys?: string[]; storage?: 'session' | 'local' } = {},
): { probe: HTMLElement; run: () => void; source: string } {
  resetDom()
  const probe = globals.document.createElement('script')
  probe.setAttribute('data-draft-probe', formId)
  globals.document.body.appendChild(probe)
  const source = buildDraftProbeScript({
    formId,
    storageKeys: options.storageKeys ?? [formId],
    storage: options.storage,
  })
  // The same text an inline `<script>` runs, with `document.currentScript` pointing at the element.
  const run = () => new Function('document', source)({ currentScript: probe })
  return { probe, run, source }
}

const marked = (probe: HTMLElement) => probe.getAttribute('data-draft-restoring')

Deno.test('probe script: marks the form when its draft has content', () => {
  const { probe, run } = mountProbe('f1')
  globals.sessionStorage.setItem('zn-space:f1', JSON.stringify({ title: 'typed' }))

  run()

  assertEquals(marked(probe), 'f1')
})

Deno.test('probe script: leaves a clean form unmarked, whatever empty value is saved', () => {
  const { probe, run } = mountProbe('f2')

  run()
  assertEquals(marked(probe), null)

  for (const saved of [{ title: '' }, {}, '', null, [], false]) {
    globals.sessionStorage.setItem('zn-space:f2', JSON.stringify(saved))
    run()
    // An array and `false` are values that are set; the others are empty drafts.
    const expected = Array.isArray(saved) || saved === false ? 'f2' : null
    assertEquals(marked(probe), expected, JSON.stringify(saved))
    probe.removeAttribute('data-draft-restoring')
  }
})

Deno.test('probe script: a controlled value saved under its own key marks the form too', () => {
  const { probe, run } = mountProbe('f3', { storageKeys: ['f3', 'f3/picked'] })
  globals.sessionStorage.setItem('zn-space:f3/picked', JSON.stringify({ id: 'p1' }))

  run()

  assertEquals(marked(probe), 'f3')
})

Deno.test('probe script: reads only the storage the form persists to', () => {
  const session = mountProbe('f4')
  globals.localStorage.setItem('zn-space:f4', JSON.stringify({ title: 'in local' }))
  session.run()
  assertEquals(marked(session.probe), null)

  const local = mountProbe('f4', { storage: 'local' })
  globals.sessionStorage.setItem('zn-space:f4', JSON.stringify({ title: 'in session' }))
  local.run()
  assertEquals(marked(local.probe), null)
  globals.localStorage.setItem('zn-space:f4', JSON.stringify({ title: 'in local' }))
  local.run()
  assertEquals(marked(local.probe), 'f4')
})

Deno.test('probe script: a storage that throws, or a value that is not JSON, never throws or marks', () => {
  const { probe, run } = mountProbe('f5')
  globals.sessionStorage.setItem('zn-space:f5', '{not json')
  run()
  assertEquals(marked(probe), null)

  Object.defineProperty(globals, 'sessionStorage', {
    configurable: true,
    get: () => {
      throw new Error('storage disabled')
    },
  })
  try {
    run()
    assertEquals(marked(probe), null)
  } finally {
    // dom-test-setup defines live getters; put the real one back for the tests that follow.
    resetDomStorageGetters()
  }
})

Deno.test('probe script: removes its own mark after the restore timeout', () => {
  const timers = installTimerMock()
  try {
    const { probe, run } = mountProbe('f6')
    globals.sessionStorage.setItem('zn-space:f6', JSON.stringify({ title: 'typed' }))

    run()
    assertEquals(marked(probe), 'f6')
    timers.advance(DRAFT_RESTORE_TIMEOUT_MS - 1)
    assertEquals(marked(probe), 'f6')
    timers.advance(1)

    assertEquals(marked(probe), null)
  } finally {
    timers.restore()
  }
})

Deno.test('probe script: is the very function probeDraft, with no other criterion of its own', () => {
  const { probe, source } = mountProbe('f7')
  assertStringIncludes(source, probeDraft.toString().split('\n')[0])
  globals.sessionStorage.setItem('zn-space:f7', JSON.stringify({ title: 'typed' }))
  const direct = globals.document.createElement('script')

  probeDraft(direct, 'f7', ['f7'], 'session', 'zn-space:', 1000)

  assertEquals(direct.getAttribute('data-draft-restoring'), 'f7')
  assertEquals(probe.getAttribute('data-draft-restoring'), null)
})

Deno.test('probeDraft: a missing script element is not an error', () => {
  resetDom()
  globals.sessionStorage.setItem('zn-space:f8', JSON.stringify({ title: 'typed' }))
  probeDraft(null, 'f8', ['f8'], 'session', 'zn-space:', 1000)
})

Deno.test('buildDraftProbeScript: carries the form id and keys as data, never able to end the script', () => {
  const source = buildDraftProbeScript({
    formId: 'x</script><!--" ',
    storageKeys: ['a</script>'],
  })

  assertFalse(source.includes('</script'))
  assertFalse(source.includes('<!--'))
  assertFalse(source.includes(' '))
  const { probe } = mountProbe('x')
  globals.sessionStorage.setItem('zn-space:a</script>', JSON.stringify({ title: 't' }))
  new Function('document', source)({ currentScript: probe })
  assertEquals(marked(probe), 'x</script><!--" ')
})

Deno.test('buildDraftProbeScript: stays small enough to inline per form', () => {
  const bytes = new TextEncoder().encode(
    buildDraftProbeScript({ formId: 'gesture-personalize-form', storageKeys: ['gesture/p/1/2'] }),
  ).length
  assert(bytes < 900, `the probe script is ${bytes} bytes`)
})

Deno.test('isDraftProbeMarked / clearDraftProbe: find the probe of one form and drop only its mark', () => {
  resetDom()
  for (const id of ['a', 'b']) {
    const probe = globals.document.createElement('script')
    probe.setAttribute('data-draft-probe', id)
    probe.setAttribute('data-draft-restoring', id)
    globals.document.body.appendChild(probe)
  }
  assert(isDraftProbeMarked('a'))

  clearDraftProbe('a')

  assertFalse(isDraftProbeMarked('a'))
  assert(isDraftProbeMarked('b'))
  assertFalse(isDraftProbeMarked('missing'))
  clearDraftProbe('missing')
})

/** Restores the live storage getters `dom-test-setup.ts` installs, after a test replaced one. */
function resetDomStorageGetters(): void {
  const dom = globals.document.defaultView
  Object.defineProperty(globals, 'sessionStorage', {
    configurable: true,
    get: () => dom.sessionStorage,
  })
}
