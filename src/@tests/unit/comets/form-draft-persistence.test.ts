import { assert, assertEquals, assertFalse } from '@std/assert'
import { installTimerMock, resetDom } from './dom-test-setup.ts'
import { CSRF_FORM_FIELD } from 'modules/middleware/csrf-form-field.ts'
import {
  attachFormDraftPersistence,
  DEFAULT_DRAFT_DEBOUNCE_MS,
  persistDraftValue,
  restoreDraftValue,
} from 'modules/comets/form-draft-persistence.ts'

// deno-lint-ignore no-explicit-any
const globals = globalThis as any

type FieldSpec = {
  name: string
  tag?: 'input' | 'textarea' | 'select'
  type?: string
  value?: string
  checked?: boolean
  attrs?: Record<string, string>
}

function buildForm(id: string, fields: FieldSpec[]): HTMLFormElement {
  const form = globals.document.createElement('form')
  form.id = id
  for (const field of fields) {
    const el = globals.document.createElement(field.tag ?? 'input')
    el.name = field.name
    if ((field.tag ?? 'input') === 'input') el.type = field.type ?? 'text'
    if (field.value !== undefined) el.value = field.value
    if (field.checked !== undefined) el.checked = field.checked
    for (const [attr, attrValue] of Object.entries(field.attrs ?? {})) {
      el.setAttribute(attr, attrValue)
    }
    form.appendChild(el)
  }
  globals.document.body.appendChild(form)
  return form
}

function fireInput(field: Element): void {
  field.dispatchEvent(new globals.Event('input', { bubbles: true }))
}

function fireSubmit(form: Element): void {
  form.dispatchEvent(new globals.Event('submit', { bubbles: true, cancelable: true }))
}

function setUp(): void {
  resetDom()
}

Deno.test(
  'attachFormDraftPersistence: restores a saved draft into the matching field on attach',
  () => {
    setUp()
    const form = buildForm('f1', [{ name: 'title', value: '' }])
    globals.sessionStorage.setItem('zn-space:f1', JSON.stringify({ title: 'saved value' }))

    const detach = attachFormDraftPersistence({
      formId: 'f1',
      storageKey: 'f1',
      hasServerValues: false,
    })

    assertEquals((form.elements.namedItem('title') as HTMLInputElement).value, 'saved value')
    detach()
  },
)

Deno.test(
  'attachFormDraftPersistence: hasServerValues=true skips restoring, a validation redisplay always wins',
  () => {
    setUp()
    const form = buildForm('f2', [{ name: 'title', value: 'from the server' }])
    globals.sessionStorage.setItem('zn-space:f2', JSON.stringify({ title: 'stale draft' }))

    const detach = attachFormDraftPersistence({
      formId: 'f2',
      storageKey: 'f2',
      hasServerValues: true,
    })

    assertEquals((form.elements.namedItem('title') as HTMLInputElement).value, 'from the server')
    detach()
  },
)

Deno.test(
  'attachFormDraftPersistence: saves the whole form, debounced, on input',
  () => {
    setUp()
    const timers = installTimerMock()
    const form = buildForm('f3', [{ name: 'title', value: '' }])
    const detach = attachFormDraftPersistence({
      formId: 'f3',
      storageKey: 'f3',
      hasServerValues: false,
      debounceMs: 300,
    })
    ;(form.elements.namedItem('title') as HTMLInputElement).value = 'typed value'
    fireInput(form.elements.namedItem('title') as Element)

    assertEquals(globals.sessionStorage.getItem('zn-space:f3'), null)
    timers.advance(299)
    assertEquals(globals.sessionStorage.getItem('zn-space:f3'), null)
    timers.advance(1)
    assertEquals(
      JSON.parse(globals.sessionStorage.getItem('zn-space:f3')),
      { title: 'typed value' },
    )

    detach()
    timers.restore()
  },
)

Deno.test(
  'attachFormDraftPersistence: uses DEFAULT_DRAFT_DEBOUNCE_MS when debounceMs is omitted',
  () => {
    setUp()
    const timers = installTimerMock()
    const form = buildForm('f4', [{ name: 'title', value: 'x' }])
    const detach = attachFormDraftPersistence({
      formId: 'f4',
      storageKey: 'f4',
      hasServerValues: false,
    })

    fireInput(form.elements.namedItem('title') as Element)
    timers.advance(DEFAULT_DRAFT_DEBOUNCE_MS - 1)
    assertEquals(globals.sessionStorage.getItem('zn-space:f4'), null)
    timers.advance(1)
    assert(globals.sessionStorage.getItem('zn-space:f4') !== null)

    detach()
    timers.restore()
  },
)

Deno.test(
  'attachFormDraftPersistence: clears the draft on submit, cancelling any pending debounced save',
  () => {
    setUp()
    const timers = installTimerMock()
    const form = buildForm('f5', [{ name: 'title', value: 'x' }])
    globals.sessionStorage.setItem('zn-space:f5', JSON.stringify({ title: 'old' }))
    const detach = attachFormDraftPersistence({
      formId: 'f5',
      storageKey: 'f5',
      hasServerValues: true,
    })

    fireInput(form.elements.namedItem('title') as Element)
    fireSubmit(form)
    timers.advance(DEFAULT_DRAFT_DEBOUNCE_MS)

    assertEquals(globals.sessionStorage.getItem('zn-space:f5'), null)

    detach()
    timers.restore()
  },
)

/** Submits a form carrying `typed` under `id`, then re-attaches to a fresh copy of the same form. */
function submitThenReattach(
  id: string,
  typed: string,
  next: { hasServerValues: boolean; returnedFromFailure?: boolean },
  attachOptions: { returnedFromFailure?: boolean } = { returnedFromFailure: false },
): HTMLInputElement {
  const form = buildForm(id, [{ name: 'title', value: typed }])
  const detach = attachFormDraftPersistence({
    formId: id,
    storageKey: id,
    hasServerValues: false,
    ...attachOptions,
  })
  fireSubmit(form)
  detach()
  resetDomKeepingStorage()

  const fresh = buildForm(id, [{ name: 'title', value: '' }])
  attachFormDraftPersistence({ formId: id, storageKey: id, ...next })
  return fresh.elements.namedItem('title') as HTMLInputElement
}

function resetDomKeepingStorage(): void {
  const saved = new Map<string, string>()
  for (let i = 0; i < globals.sessionStorage.length; i++) {
    const k = globals.sessionStorage.key(i)
    saved.set(k, globals.sessionStorage.getItem(k))
  }
  setUp()
  for (const [k, v] of saved) globals.sessionStorage.setItem(k, v)
}

Deno.test(
  'attachFormDraftPersistence: returnedFromFailure=true restores the form submitted just before',
  () => {
    setUp()
    const field = submitThenReattach('rf1', 'typed text', {
      hasServerValues: false,
      returnedFromFailure: true,
    })

    assertEquals(field.value, 'typed text')
    assertEquals(
      JSON.parse(globals.sessionStorage.getItem('zn-space:rf1')),
      { title: 'typed text' },
    )
    assertEquals(globals.sessionStorage.getItem('zn-space:rf1:submitted'), null)
  },
)

Deno.test(
  'attachFormDraftPersistence: returnedFromFailure=false discards the submitted form, a later visit stays empty',
  () => {
    setUp()
    const field = submitThenReattach('rf2', 'already sent', {
      hasServerValues: false,
      returnedFromFailure: false,
    })

    assertEquals(field.value, '')
    assertEquals(globals.sessionStorage.getItem('zn-space:rf2'), null)
    assertEquals(globals.sessionStorage.getItem('zn-space:rf2:submitted'), null)
  },
)

Deno.test(
  'attachFormDraftPersistence: a snapshot restored once is not restored by a second failure render without a new submit',
  () => {
    setUp()
    submitThenReattach('rf3', 'once', { hasServerValues: false, returnedFromFailure: true })
    globals.sessionStorage.removeItem('zn-space:rf3')
    resetDomKeepingStorage()

    const form = buildForm('rf3', [{ name: 'title', value: '' }])
    attachFormDraftPersistence({
      formId: 'rf3',
      storageKey: 'rf3',
      hasServerValues: false,
      returnedFromFailure: true,
    })

    assertEquals((form.elements.namedItem('title') as HTMLInputElement).value, '')
  },
)

Deno.test(
  'attachFormDraftPersistence: hasServerValues wins over returnedFromFailure',
  () => {
    setUp()
    const field = submitThenReattach('rf4', 'client text', {
      hasServerValues: true,
      returnedFromFailure: true,
    })

    assertEquals(field.value, '')
    assertEquals(globals.sessionStorage.getItem('zn-space:rf4:submitted'), null)
  },
)

Deno.test(
  'attachFormDraftPersistence: without returnedFromFailure nothing is kept after submit',
  () => {
    setUp()
    const form = buildForm('rf5', [{ name: 'title', value: 'secret-ish' }])
    const detach = attachFormDraftPersistence({
      formId: 'rf5',
      storageKey: 'rf5',
      hasServerValues: false,
    })
    fireSubmit(form)

    assertEquals(globals.sessionStorage.getItem('zn-space:rf5'), null)
    assertEquals(globals.sessionStorage.getItem('zn-space:rf5:submitted'), null)
    detach()
  },
)

Deno.test(
  'attachFormDraftPersistence: never reads or writes _csrf — hardcoded, not configurable',
  () => {
    setUp()
    const timers = installTimerMock()
    const form = buildForm('f6', [
      { name: 'title', value: 'x' },
      { name: CSRF_FORM_FIELD, value: 'real-token' },
    ])
    globals.sessionStorage.setItem(
      'zn-space:f6',
      JSON.stringify({ title: 'saved', [CSRF_FORM_FIELD]: 'stale-token' }),
    )
    const detach = attachFormDraftPersistence({
      formId: 'f6',
      storageKey: 'f6',
      hasServerValues: false,
    })

    // A stale CSRF token from the draft must never overwrite the real one already on the page.
    assertEquals(
      (form.elements.namedItem(CSRF_FORM_FIELD) as HTMLInputElement).value,
      'real-token',
    )

    fireInput(form.elements.namedItem('title') as Element)
    timers.advance(DEFAULT_DRAFT_DEBOUNCE_MS)
    const saved = JSON.parse(globals.sessionStorage.getItem('zn-space:f6'))
    assertFalse(CSRF_FORM_FIELD in saved)

    detach()
    timers.restore()
  },
)

Deno.test(
  'attachFormDraftPersistence: never reads or writes a type="password" or type="file" field',
  () => {
    setUp()
    const timers = installTimerMock()
    const form = buildForm('f7', [
      { name: 'title', value: 'x' },
      { name: 'secret', type: 'password', value: 'hunter2' },
      { name: 'upload', type: 'file' },
    ])
    globals.sessionStorage.setItem(
      'zn-space:f7',
      JSON.stringify({ title: 'saved', secret: 'stale-secret' }),
    )
    const detach = attachFormDraftPersistence({
      formId: 'f7',
      storageKey: 'f7',
      hasServerValues: false,
    })

    assertEquals((form.elements.namedItem('secret') as HTMLInputElement).value, 'hunter2')

    fireInput(form.elements.namedItem('title') as Element)
    timers.advance(DEFAULT_DRAFT_DEBOUNCE_MS)
    const saved = JSON.parse(globals.sessionStorage.getItem('zn-space:f7'))
    assertFalse('secret' in saved)
    assertFalse('upload' in saved)

    detach()
    timers.restore()
  },
)

Deno.test(
  'attachFormDraftPersistence: a field marked data-no-persist is excluded, restore and save alike',
  () => {
    setUp()
    const timers = installTimerMock()
    const form = buildForm('f8', [
      { name: 'title', value: 'x' },
      { name: 'apiKey', value: 'unset', attrs: { 'data-no-persist': '' } },
    ])
    globals.sessionStorage.setItem(
      'zn-space:f8',
      JSON.stringify({ title: 'saved', apiKey: 'stale-key' }),
    )
    const detach = attachFormDraftPersistence({
      formId: 'f8',
      storageKey: 'f8',
      hasServerValues: false,
    })

    assertEquals((form.elements.namedItem('apiKey') as HTMLInputElement).value, 'unset')

    fireInput(form.elements.namedItem('title') as Element)
    timers.advance(DEFAULT_DRAFT_DEBOUNCE_MS)
    const saved = JSON.parse(globals.sessionStorage.getItem('zn-space:f8'))
    assertFalse('apiKey' in saved)

    detach()
    timers.restore()
  },
)

Deno.test(
  'attachFormDraftPersistence: excludeFields excludes a field owned by a different persistence unit',
  () => {
    setUp()
    const timers = installTimerMock()
    const form = buildForm('f9', [
      { name: 'title', value: 'x' },
      { name: 'controlled', value: 'owned-elsewhere' },
    ])
    const detach = attachFormDraftPersistence({
      formId: 'f9',
      storageKey: 'f9',
      hasServerValues: false,
      excludeFields: ['controlled'],
    })

    fireInput(form.elements.namedItem('title') as Element)
    timers.advance(DEFAULT_DRAFT_DEBOUNCE_MS)
    const saved = JSON.parse(globals.sessionStorage.getItem('zn-space:f9'))
    assertFalse('controlled' in saved)

    detach()
    timers.restore()
  },
)

Deno.test(
  'attachFormDraftPersistence: restoring a text field dispatches a real, bubbling input event — ' +
    'what a React/Preact-controlled wrapper around it needs to sync its own tracked state',
  () => {
    setUp()
    const form = buildForm('f9a', [{ name: 'title', value: '' }])
    globals.sessionStorage.setItem('zn-space:f9a', JSON.stringify({ title: 'restored' }))
    const events: string[] = []
    ;(form.elements.namedItem('title') as Element).addEventListener(
      'input',
      (event: Event) => events.push(`${event.type}:${event.bubbles}`),
    )

    const detach = attachFormDraftPersistence({
      formId: 'f9a',
      storageKey: 'f9a',
      hasServerValues: false,
    })

    assertEquals(events, ['input:true'])
    detach()
  },
)

Deno.test(
  'attachFormDraftPersistence: restoring a checkbox dispatches a real, bubbling change event',
  () => {
    setUp()
    const form = buildForm('f9b', [
      { name: 'agree', type: 'checkbox', value: 'yes', checked: false },
    ])
    globals.sessionStorage.setItem('zn-space:f9b', JSON.stringify({ agree: 'yes' }))
    const events: string[] = []
    ;(form.elements.namedItem('agree') as Element).addEventListener(
      'change',
      (event: Event) => events.push(`${event.type}:${event.bubbles}`),
    )

    const detach = attachFormDraftPersistence({
      formId: 'f9b',
      storageKey: 'f9b',
      hasServerValues: false,
    })

    assertEquals(events, ['change:true'])
    detach()
  },
)

Deno.test(
  'attachFormDraftPersistence: restoring a field already at the saved value dispatches nothing',
  () => {
    setUp()
    const form = buildForm('f9c', [{ name: 'title', value: 'already this' }])
    globals.sessionStorage.setItem('zn-space:f9c', JSON.stringify({ title: 'already this' }))
    let fired = false
    ;(form.elements.namedItem('title') as Element).addEventListener('input', () => fired = true)

    const detach = attachFormDraftPersistence({
      formId: 'f9c',
      storageKey: 'f9c',
      hasServerValues: false,
    })

    assertFalse(fired)
    detach()
  },
)

Deno.test(
  'attachFormDraftPersistence: restores a checked checkbox by matching its own value',
  () => {
    setUp()
    const form = buildForm('f10', [
      { name: 'agree', type: 'checkbox', value: 'yes', checked: false },
    ])
    globals.sessionStorage.setItem('zn-space:f10', JSON.stringify({ agree: 'yes' }))

    const detach = attachFormDraftPersistence({
      formId: 'f10',
      storageKey: 'f10',
      hasServerValues: false,
    })

    assert((form.elements.namedItem('agree') as HTMLInputElement).checked)
    detach()
  },
)

Deno.test(
  'attachFormDraftPersistence: storage="local" writes to localStorage, never sessionStorage',
  () => {
    setUp()
    const timers = installTimerMock()
    const form = buildForm('f11', [{ name: 'title', value: 'x' }])
    const detach = attachFormDraftPersistence({
      formId: 'f11',
      storageKey: 'f11',
      hasServerValues: false,
      storage: 'local',
    })

    fireInput(form.elements.namedItem('title') as Element)
    timers.advance(DEFAULT_DRAFT_DEBOUNCE_MS)

    assertEquals(globals.sessionStorage.getItem('zn-space:f11'), null)
    assert(globals.localStorage.getItem('zn-space:f11') !== null)

    detach()
    timers.restore()
  },
)

Deno.test(
  'attachFormDraftPersistence: a formId matching nothing on the page is a safe no-op',
  () => {
    setUp()
    const detach = attachFormDraftPersistence({
      formId: 'does-not-exist',
      storageKey: 'ghost',
      hasServerValues: false,
    })
    detach() // must not throw
  },
)

Deno.test(
  'attachFormDraftPersistence: cleanup stops future saves from reaching storage',
  () => {
    setUp()
    const timers = installTimerMock()
    const form = buildForm('f12', [{ name: 'title', value: 'x' }])
    const detach = attachFormDraftPersistence({
      formId: 'f12',
      storageKey: 'f12',
      hasServerValues: false,
    })

    fireInput(form.elements.namedItem('title') as Element)
    detach()
    timers.advance(DEFAULT_DRAFT_DEBOUNCE_MS)

    assertEquals(globals.sessionStorage.getItem('zn-space:f12'), null)
    timers.restore()
  },
)

Deno.test(
  'restoreDraftValue: calls onRestore with a previously persisted value',
  () => {
    setUp()
    const timers = installTimerMock()
    let restored: unknown
    persistDraftValue({ webhook: 'https://example.com' }, { storageKey: 'v1' })
    timers.advance(DEFAULT_DRAFT_DEBOUNCE_MS)

    restoreDraftValue((value) => restored = value, { storageKey: 'v1', hasServerValues: false })

    assertEquals(restored, { webhook: 'https://example.com' })
    timers.restore()
  },
)

Deno.test(
  'restoreDraftValue: hasServerValues=true never calls onRestore',
  () => {
    setUp()
    const timers = installTimerMock()
    let called = false
    persistDraftValue({ webhook: 'https://example.com' }, { storageKey: 'v2' })
    timers.advance(DEFAULT_DRAFT_DEBOUNCE_MS)

    restoreDraftValue(() => called = true, { storageKey: 'v2', hasServerValues: true })

    assertFalse(called)
    timers.restore()
  },
)

Deno.test(
  'restoreDraftValue: nothing persisted yet never calls onRestore',
  () => {
    setUp()
    let called = false
    restoreDraftValue(() => called = true, { storageKey: 'never-written', hasServerValues: false })
    assertFalse(called)
  },
)

Deno.test(
  'persistDraftValue: debounces the write — nothing lands before debounceMs elapses',
  () => {
    setUp()
    const timers = installTimerMock()
    persistDraftValue('typed', { storageKey: 'v3', debounceMs: 200 })

    timers.advance(199)
    assertEquals(globals.sessionStorage.getItem('zn-space:v3'), null)
    timers.advance(1)
    assertEquals(JSON.parse(globals.sessionStorage.getItem('zn-space:v3')), 'typed')

    timers.restore()
  },
)

Deno.test(
  "persistDraftValue: the returned cleanup cancels a still-pending write — this is the debounce's own reset mechanism",
  () => {
    setUp()
    const timers = installTimerMock()
    const cancelFirst = persistDraftValue('first', { storageKey: 'v4' })
    cancelFirst()
    persistDraftValue('second', { storageKey: 'v4' })
    timers.advance(DEFAULT_DRAFT_DEBOUNCE_MS)

    assertEquals(JSON.parse(globals.sessionStorage.getItem('zn-space:v4')), 'second')

    timers.restore()
  },
)

// -- A controlled value that belongs to a form (`formId`) follows the form's own lifecycle ----------

const VALUE_KEY = 'zn-space:picked'
const SUBMITTED_VALUE_KEY = `${VALUE_KEY}:submitted`

function readValue(key: string): unknown {
  const raw = globals.sessionStorage.getItem(key)
  return raw === null ? undefined : JSON.parse(raw)
}

Deno.test(
  'persistDraftValue: without a formId a submit never touches the saved value',
  () => {
    setUp()
    const timers = installTimerMock()
    const form = buildForm('cv-none', [{ name: 'title', value: '' }])
    const stop = persistDraftValue('kept', { storageKey: 'picked' })
    timers.advance(DEFAULT_DRAFT_DEBOUNCE_MS)

    fireSubmit(form)

    assertEquals(readValue(VALUE_KEY), 'kept')
    assertEquals(readValue(SUBMITTED_VALUE_KEY), undefined)
    stop()
    timers.restore()
  },
)

Deno.test(
  'persistDraftValue: with a formId a submit clears the saved value and cancels the pending write',
  () => {
    setUp()
    const timers = installTimerMock()
    const form = buildForm('cv-clear', [{ name: 'title', value: '' }])
    const stop = persistDraftValue('typed', { storageKey: 'picked', formId: 'cv-clear' })
    timers.advance(DEFAULT_DRAFT_DEBOUNCE_MS)
    assertEquals(readValue(VALUE_KEY), 'typed')

    fireSubmit(form)
    timers.advance(DEFAULT_DRAFT_DEBOUNCE_MS)

    assertEquals(readValue(VALUE_KEY), undefined)
    assertEquals(readValue(SUBMITTED_VALUE_KEY), undefined)
    stop()
    timers.restore()
  },
)

Deno.test(
  'persistDraftValue: with returnedFromFailure set, a submit keeps the value as it stood, even one not yet written',
  () => {
    setUp()
    const timers = installTimerMock()
    const form = buildForm('cv-keep', [{ name: 'title', value: '' }])
    const stop = persistDraftValue('latest', {
      storageKey: 'picked',
      formId: 'cv-keep',
      returnedFromFailure: false,
    })

    // The debounce has not fired: the submit itself carries the value.
    fireSubmit(form)

    assertEquals(readValue(VALUE_KEY), undefined)
    assertEquals(readValue(SUBMITTED_VALUE_KEY), 'latest')
    stop()
    timers.restore()
  },
)

Deno.test(
  'restoreDraftValue: returnedFromFailure=true restores the value submitted just before, once',
  () => {
    setUp()
    const timers = installTimerMock()
    const form = buildForm('cv-failed', [{ name: 'title', value: '' }])
    persistDraftValue({ id: 'p1' }, {
      storageKey: 'picked',
      formId: 'cv-failed',
      returnedFromFailure: false,
    })
    fireSubmit(form)
    const restored: unknown[] = []
    const options = { storageKey: 'picked', formId: 'cv-failed', hasServerValues: false }

    restoreDraftValue((value) => restored.push(value), { ...options, returnedFromFailure: true })
    // What was restored is the live draft now, like any other: dropping it leaves nothing for a
    // second failure render to restore, because the snapshot itself is gone.
    globals.sessionStorage.removeItem(VALUE_KEY)
    restoreDraftValue((value) => restored.push(value), { ...options, returnedFromFailure: true })

    assertEquals(restored, [{ id: 'p1' }])
    timers.restore()
  },
)

Deno.test(
  'restoreDraftValue: returnedFromFailure=false discards the submitted value, a later visit stays empty',
  () => {
    setUp()
    const timers = installTimerMock()
    const form = buildForm('cv-clean', [{ name: 'title', value: '' }])
    persistDraftValue('sent', {
      storageKey: 'picked',
      formId: 'cv-clean',
      returnedFromFailure: false,
    })
    fireSubmit(form)
    const restored: unknown[] = []
    const options = { storageKey: 'picked', formId: 'cv-clean', hasServerValues: false }

    restoreDraftValue((value) => restored.push(value), { ...options, returnedFromFailure: false })
    restoreDraftValue((value) => restored.push(value), { ...options, returnedFromFailure: true })

    assertEquals(restored, [])
    assertEquals(readValue(SUBMITTED_VALUE_KEY), undefined)
    timers.restore()
  },
)

Deno.test(
  'restoreDraftValue: a value saved but never submitted restores when the visitor comes back',
  () => {
    setUp()
    const timers = installTimerMock()
    buildForm('cv-back', [{ name: 'title', value: '' }])
    persistDraftValue('half-done', { storageKey: 'picked', formId: 'cv-back' })
    timers.advance(DEFAULT_DRAFT_DEBOUNCE_MS)
    const restored: unknown[] = []

    restoreDraftValue((value) => restored.push(value), {
      storageKey: 'picked',
      formId: 'cv-back',
      hasServerValues: false,
      returnedFromFailure: false,
    })

    assertEquals(restored, ['half-done'])
    timers.restore()
  },
)

Deno.test(
  'restoreDraftValue: hasServerValues wins over returnedFromFailure and still discards the snapshot',
  () => {
    setUp()
    const timers = installTimerMock()
    const form = buildForm('cv-server', [{ name: 'title', value: '' }])
    persistDraftValue('sent', {
      storageKey: 'picked',
      formId: 'cv-server',
      returnedFromFailure: false,
    })
    fireSubmit(form)
    const restored: unknown[] = []

    restoreDraftValue((value) => restored.push(value), {
      storageKey: 'picked',
      formId: 'cv-server',
      hasServerValues: true,
      returnedFromFailure: true,
    })

    assertEquals(restored, [])
    assertEquals(readValue(SUBMITTED_VALUE_KEY), undefined)
    timers.restore()
  },
)

Deno.test(
  'restoreDraftValue: without returnedFromFailure at the submit, nothing is kept for the next render',
  () => {
    setUp()
    const timers = installTimerMock()
    const form = buildForm('cv-optout', [{ name: 'title', value: '' }])
    persistDraftValue('sent', { storageKey: 'picked', formId: 'cv-optout' })
    fireSubmit(form)
    const restored: unknown[] = []

    restoreDraftValue((value) => restored.push(value), {
      storageKey: 'picked',
      formId: 'cv-optout',
      hasServerValues: false,
      returnedFromFailure: true,
    })

    assertEquals(restored, [])
    timers.restore()
  },
)

Deno.test(
  'restoreDraftValue: a value that is falsy is still a value to recover',
  () => {
    setUp()
    const timers = installTimerMock()
    const form = buildForm('cv-falsy', [{ name: 'title', value: '' }])
    persistDraftValue(0, {
      storageKey: 'picked',
      formId: 'cv-falsy',
      returnedFromFailure: false,
    })
    fireSubmit(form)
    const restored: unknown[] = []

    restoreDraftValue((value) => restored.push(value), {
      storageKey: 'picked',
      formId: 'cv-falsy',
      hasServerValues: false,
      returnedFromFailure: true,
    })

    assertEquals(restored, [0])
    timers.restore()
  },
)

Deno.test(
  'persistDraftValue/restoreDraftValue: storage="local" keeps the submitted value in localStorage only',
  () => {
    setUp()
    const timers = installTimerMock()
    const form = buildForm('cv-local', [{ name: 'title', value: '' }])
    persistDraftValue('sent', {
      storageKey: 'picked',
      formId: 'cv-local',
      returnedFromFailure: false,
      storage: 'local',
    })
    fireSubmit(form)

    assertEquals(globals.sessionStorage.getItem(SUBMITTED_VALUE_KEY), null)
    assertEquals(JSON.parse(globals.localStorage.getItem(SUBMITTED_VALUE_KEY)), 'sent')
    const restored: unknown[] = []
    restoreDraftValue((value) => restored.push(value), {
      storageKey: 'picked',
      formId: 'cv-local',
      hasServerValues: false,
      returnedFromFailure: true,
      storage: 'local',
    })
    assertEquals(restored, ['sent'])
    timers.restore()
  },
)

Deno.test(
  'persistDraftValue: the returned cleanup detaches the form listener',
  () => {
    setUp()
    const timers = installTimerMock()
    const form = buildForm('cv-detach', [{ name: 'title', value: '' }])
    const stop = persistDraftValue('typed', { storageKey: 'picked', formId: 'cv-detach' })
    timers.advance(DEFAULT_DRAFT_DEBOUNCE_MS)
    stop()

    fireSubmit(form)

    // Detached: the submit no longer clears what was already saved.
    assertEquals(readValue(VALUE_KEY), 'typed')
    timers.restore()
  },
)

Deno.test(
  'persistDraftValue: a formId matching nothing on the page is a safe no-op for the form lifecycle',
  () => {
    setUp()
    const timers = installTimerMock()
    const stop = persistDraftValue('typed', { storageKey: 'picked', formId: 'no-such-form' })
    timers.advance(DEFAULT_DRAFT_DEBOUNCE_MS)

    assertEquals(readValue(VALUE_KEY), 'typed')
    stop()
    timers.restore()
  },
)

Deno.test(
  'restoreDraftValue: reports the value as restored to the form, with or without something to restore',
  async () => {
    setUp()
    const { awaitDraftValues, forgetDraftValues } = await import(
      'modules/comets/draft-restoring.ts'
    )
    let settled = 0
    const stop = awaitDraftValues('cv-report', ['picked', 'other'], () => settled++)

    restoreDraftValue(() => {}, {
      storageKey: 'picked',
      formId: 'cv-report',
      hasServerValues: false,
    })
    assertEquals(settled, 0)
    restoreDraftValue(() => {}, { storageKey: 'other', formId: 'cv-report', hasServerValues: true })

    assertEquals(settled, 1)
    stop()
    forgetDraftValues('cv-report')
  },
)
