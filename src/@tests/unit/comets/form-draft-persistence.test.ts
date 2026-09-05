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
