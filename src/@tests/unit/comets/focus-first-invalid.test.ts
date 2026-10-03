import { assert, assertEquals, assertFalse } from '@std/assert'
import { installTimerMock, resetDom } from './dom-test-setup.ts'
import {
  attachFocusFirstInvalid,
  findFirstInvalidControl,
} from 'modules/comets/focus-first-invalid.ts'
import { attachManagedForm } from 'modules/comets/managed-form.ts'
import {
  DRAFT_RESTORE_TIMEOUT_MS,
  reportDraftValueRestored,
} from 'modules/comets/draft-restoring.ts'

// deno-lint-ignore no-explicit-any
const globals = globalThis as any

type Field = {
  name: string
  invalid?: boolean
  disabled?: boolean
  type?: string
  autofocus?: boolean
}

type Built = {
  form: HTMLFormElement
  field: (name: string) => HTMLInputElement
  scrolls: Array<{ name: string; options: Record<string, unknown> }>
}

/** A `<form>` of inputs; each `scrollIntoView` call is recorded, with the field it was called on. */
function build(id: string, fields: Field[]): Built {
  resetDom()
  const scrolls: Built['scrolls'] = []
  const form = globals.document.createElement('form')
  form.id = id
  for (const spec of fields) {
    const input = globals.document.createElement('input')
    input.name = spec.name
    if (spec.type) input.type = spec.type
    if (spec.invalid) input.setAttribute('aria-invalid', 'true')
    if (spec.disabled) input.disabled = true
    if (spec.autofocus) input.setAttribute('autofocus', '')
    input.scrollIntoView = (options: Record<string, unknown>) =>
      scrolls.push({ name: spec.name, options })
    form.appendChild(input)
  }
  globals.document.body.appendChild(form)
  return {
    form,
    field: (name) => form.elements.namedItem(name) as HTMLInputElement,
    scrolls,
  }
}

/** Identity, not deep equality: a failing `assertEquals` on two DOM elements walks both trees to print
 * a diff, which never finishes in a real document. */
function assertSame(actual: Element | null, expected: Element | null): void {
  assert(
    actual === expected,
    `expected ${(expected as HTMLInputElement | null)?.name ?? expected}, ` +
      `got ${(actual as HTMLInputElement | null)?.name ?? actual}`,
  )
}

function focusedName(): string | undefined {
  return (globals.document.activeElement as HTMLInputElement | null)?.name || undefined
}

/** Attaches, then lets the single scheduled run happen (no `requestAnimationFrame` in this DOM, so
 * the primitive falls back to a zero-delay timer the mock fires). */
function attachAndRun(options: Parameters<typeof attachFocusFirstInvalid>[0]) {
  const timers = installTimerMock()
  try {
    const detach = attachFocusFirstInvalid(options)
    timers.advance(0)
    return detach
  } finally {
    timers.restore()
  }
}

Deno.test('findFirstInvalidControl: nothing is marked invalid, so there is nothing to find', () => {
  const { form } = build('f0', [{ name: 'a' }, { name: 'b' }])
  assertSame(findFirstInvalidControl(form), null)
})

Deno.test('findFirstInvalidControl: the first marked control in document order, not the first by name', () => {
  const { form, field } = build('f1', [
    { name: 'a' },
    { name: 'z', invalid: true },
    { name: 'b', invalid: true },
  ])
  assertSame(findFirstInvalidControl(form), field('z'))
})

Deno.test('findFirstInvalidControl: only the exact value "true" counts as invalid', () => {
  const { form, field } = build('f2', [{ name: 'a' }, { name: 'b' }, { name: 'c', invalid: true }])
  field('a').setAttribute('aria-invalid', 'false')
  field('b').setAttribute('aria-invalid', 'grammar')
  assertSame(findFirstInvalidControl(form), field('c'))
})

Deno.test('findFirstInvalidControl: skips a disabled control, a hidden one and a hidden input for the next', () => {
  const { form, field } = build('f3', [
    { name: 'off', invalid: true, disabled: true },
    { name: 'secret', invalid: true, type: 'hidden' },
    { name: 'tucked', invalid: true },
    { name: 'next', invalid: true },
  ])
  field('tucked').setAttribute('hidden', '')
  assertSame(findFirstInvalidControl(form), field('next'))
})

Deno.test('findFirstInvalidControl: skips a control inside a hidden or inert container', () => {
  const { form, field } = build('f4', [
    { name: 'inside', invalid: true },
    { name: 'inert', invalid: true },
    { name: 'ok', invalid: true },
  ])
  const hiddenBox = globals.document.createElement('div')
  hiddenBox.setAttribute('hidden', '')
  hiddenBox.appendChild(field('inside'))
  const inertBox = globals.document.createElement('div')
  inertBox.setAttribute('inert', '')
  inertBox.appendChild(field('inert'))
  form.prepend(hiddenBox, inertBox)
  assertSame(findFirstInvalidControl(form), field('ok'))
})

Deno.test('findFirstInvalidControl: honors checkVisibility when the engine has it (display: none, content hidden by CSS)', () => {
  const { form, field } = build('f5', [{ name: 'css', invalid: true }, {
    name: 'ok',
    invalid: true,
  }]) // deno-lint-ignore no-explicit-any
  ;(field('css') as any).checkVisibility = () => false
  assertSame(findFirstInvalidControl(form), field('ok'))
})

Deno.test('findFirstInvalidControl: a container marked invalid hands the focus to its first usable control', () => {
  const { form } = build('f6', [])
  const group = globals.document.createElement('div')
  group.setAttribute('role', 'radiogroup')
  group.setAttribute('aria-invalid', 'true')
  const gone = globals.document.createElement('input')
  gone.type = 'radio'
  gone.name = 'plan'
  gone.disabled = true
  const first = globals.document.createElement('input')
  first.type = 'radio'
  first.name = 'plan'
  group.append(gone, first)
  form.appendChild(group)
  assertSame(findFirstInvalidControl(form), first)
})

Deno.test('findFirstInvalidControl: a container with nothing focusable inside is skipped', () => {
  const { form, field } = build('f7', [{ name: 'real', invalid: true }])
  const empty = globals.document.createElement('div')
  empty.setAttribute('aria-invalid', 'true')
  form.prepend(empty)
  assertSame(findFirstInvalidControl(form), field('real'))
})

Deno.test('attachFocusFirstInvalid: focuses the first invalid control and scrolls it to the centre', () => {
  const { field, scrolls } = build('a1', [
    { name: 'a' },
    { name: 'b', invalid: true },
    { name: 'c', invalid: true },
  ])
  const detach = attachAndRun({ formId: 'a1' })

  assertEquals(focusedName(), 'b')
  assertEquals(scrolls, [{
    name: 'b',
    options: { block: 'center', inline: 'nearest', behavior: 'smooth' },
  }])
  assertFalse(globals.document.activeElement === field('c'))
  detach()
})

Deno.test('attachFocusFirstInvalid: a visit with no invalid control does nothing at all', () => {
  const { scrolls } = build('a2', [{ name: 'a' }, { name: 'b' }])
  const detach = attachAndRun({ formId: 'a2' })
  assertEquals(focusedName(), undefined)
  assertEquals(scrolls, [])
  detach()
})

Deno.test('attachFocusFirstInvalid: the scroll is instant when the visitor prefers reduced motion', () => {
  const { scrolls } = build('a3', [{ name: 'a', invalid: true }])
  globals.matchMedia = (query: string) => ({ matches: query.includes('prefers-reduced-motion') })
  try {
    const detach = attachAndRun({ formId: 'a3' })
    assertEquals(scrolls[0].options.behavior, 'instant')
    detach()
  } finally {
    delete globals.matchMedia
  }
})

Deno.test('attachFocusFirstInvalid: an engine whose elements cannot scroll (no scrollIntoView) still focuses', () => {
  const { field } = build('a4', [{ name: 'a', invalid: true }]) // deno-lint-ignore no-explicit-any
  ;(field('a') as any).scrollIntoView = undefined
  const detach = attachAndRun({ formId: 'a4' })
  assertEquals(focusedName(), 'a')
  detach()
})

Deno.test('attachFocusFirstInvalid: never takes the focus from a field the visitor is already typing in', () => {
  const { field, scrolls } = build('a5', [{ name: 'typing' }, { name: 'bad', invalid: true }])
  field('typing').focus()
  const detach = attachAndRun({ formId: 'a5' })
  assertEquals(focusedName(), 'typing')
  assertEquals(scrolls, [])
  detach()
})

Deno.test('attachFocusFirstInvalid: a focused select, textarea or checkbox is not taken either', () => {
  for (const make of ['select', 'textarea', 'checkbox'] as const) {
    const { form } = build(`a6-${make}`, [{ name: 'bad', invalid: true }])
    const other = globals.document.createElement(make === 'checkbox' ? 'input' : make)
    if (make === 'checkbox') other.type = 'checkbox'
    other.name = 'other'
    form.prepend(other)
    other.focus()
    const detach = attachAndRun({ formId: `a6-${make}` })
    assertEquals(focusedName(), 'other', make)
    detach()
  }
})

Deno.test("attachFocusFirstInvalid: the page's own autofocus does not count as the visitor's choice", () => {
  const { field } = build('a7', [{ name: 'first', autofocus: true }, {
    name: 'bad',
    invalid: true,
  }])
  field('first').focus()
  const detach = attachAndRun({ formId: 'a7' })
  assertEquals(focusedName(), 'bad')
  detach()
})

Deno.test('attachFocusFirstInvalid: a focused button or link does not block the move', () => {
  const { form } = build('a8', [{ name: 'bad', invalid: true }])
  const button = globals.document.createElement('button')
  button.type = 'button'
  form.prepend(button)
  button.focus()
  const detach = attachAndRun({ formId: 'a8' })
  assertEquals(focusedName(), 'bad')
  detach()
})

Deno.test('attachFocusFirstInvalid: a control that already has the focus is left alone, with no scroll', () => {
  const { field, scrolls } = build('a9', [{ name: 'bad', invalid: true }])
  field('bad').focus()
  const detach = attachAndRun({ formId: 'a9' })
  assertEquals(focusedName(), 'bad')
  assertEquals(scrolls, [])
  detach()
})

Deno.test('attachFocusFirstInvalid: runs once per attach, however the DOM changes afterwards', () => {
  const { field, scrolls } = build('b1', [{ name: 'a', invalid: true }, { name: 'b' }])
  const timers = installTimerMock()
  try {
    const detach = attachFocusFirstInvalid({ formId: 'b1' })
    timers.advance(0)
    field('b').setAttribute('aria-invalid', 'true')
    field('b').focus()
    timers.advance(1000)
    assertEquals(focusedName(), 'b')
    assertEquals(scrolls.length, 1)
    detach()
  } finally {
    timers.restore()
  }
})

Deno.test('attachFocusFirstInvalid: detaching before the scheduled run cancels it', () => {
  build('b2', [{ name: 'a', invalid: true }])
  const timers = installTimerMock()
  try {
    const detach = attachFocusFirstInvalid({ formId: 'b2' })
    detach()
    timers.advance(1000)
    assertEquals(focusedName(), undefined)
  } finally {
    timers.restore()
  }
})

Deno.test('attachFocusFirstInvalid: uses requestAnimationFrame when the engine has it, and cancels the frame on detach', () => {
  build('b3', [{ name: 'a', invalid: true }])
  const frames = new Map<number, () => void>()
  let next = 1
  globals.requestAnimationFrame = (run: () => void) => {
    frames.set(next, run)
    return next++
  }
  globals.cancelAnimationFrame = (id: number) => frames.delete(id)
  try {
    const detach = attachFocusFirstInvalid({ formId: 'b3' })
    assertEquals(frames.size, 1)
    assertEquals(focusedName(), undefined)
    detach()
    assertEquals(frames.size, 0)

    const again = attachFocusFirstInvalid({ formId: 'b3' })
    for (const run of [...frames.values()]) run()
    assertEquals(focusedName(), 'a')
    again()
  } finally {
    delete globals.requestAnimationFrame
    delete globals.cancelAnimationFrame
  }
})

Deno.test('attachFocusFirstInvalid: an id that is not a form, or no document, is a safe no-op', () => {
  build('b4', [{ name: 'a', invalid: true }])
  const div = globals.document.createElement('div')
  div.id = 'not-a-form'
  globals.document.body.appendChild(div)
  attachFocusFirstInvalid({ formId: 'not-a-form' })()
  attachFocusFirstInvalid({ formId: 'missing' })()

  const real = globals.document
  globals.document = undefined
  try {
    attachFocusFirstInvalid({ formId: 'b4' })()
  } finally {
    globals.document = real
  }
  assertEquals(focusedName(), undefined)
})

Deno.test('attachFocusFirstInvalid: focusing does not mark the form as changed (no input or change event)', () => {
  const { form } = build('b5', [{ name: 'a', invalid: true }])
  const seen: string[] = []
  for (const type of ['input', 'change', 'submit']) {
    form.addEventListener(type, () => seen.push(type))
  }
  const detach = attachAndRun({ formId: 'b5' })
  assertEquals(focusedName(), 'a')
  assertEquals(seen, [])
  detach()
})

Deno.test('attachFocusFirstInvalid with a draft: a render that restores nothing focuses at once', () => {
  build('d1', [{ name: 'a', invalid: true }])
  const detach = attachAndRun({
    formId: 'd1',
    draft: { hasServerValues: true, returnedFromFailure: true },
  })
  assertEquals(focusedName(), 'a')
  detach()
})

Deno.test('attachFocusFirstInvalid with a draft: waits for each controlled value to restore, then focuses', () => {
  build('d2', [{ name: 'a', invalid: true }])
  const timers = installTimerMock()
  try {
    const detach = attachFocusFirstInvalid({
      formId: 'd2',
      draft: { hasServerValues: false, returnedFromFailure: true, awaitValues: ['d2/picked'] },
    })
    timers.advance(100)
    assertEquals(focusedName(), undefined)

    reportDraftValueRestored('d2', 'd2/picked')
    timers.advance(0)
    assertEquals(focusedName(), 'a')
    detach()
  } finally {
    timers.restore()
  }
})

Deno.test('attachFocusFirstInvalid with a draft: a Comet that never reports does not hold the focus back past the restore timeout', () => {
  build('d3', [{ name: 'a', invalid: true }])
  const timers = installTimerMock()
  try {
    const detach = attachFocusFirstInvalid({
      formId: 'd3',
      draft: { hasServerValues: false, returnedFromFailure: true, awaitValues: ['d3/never'] },
    })
    timers.advance(DRAFT_RESTORE_TIMEOUT_MS - 1)
    assertEquals(focusedName(), undefined)
    timers.advance(1)
    timers.advance(0)
    assertEquals(focusedName(), 'a')
    detach()
  } finally {
    timers.restore()
  }
})

Deno.test("attachFocusFirstInvalid with a draft: a form the page's probe marked as restoring also waits", () => {
  build('d4', [{ name: 'a', invalid: true }])
  const probe = globals.document.createElement('script')
  probe.setAttribute('data-draft-probe', 'd4')
  probe.setAttribute('data-draft-restoring', 'd4')
  globals.document.body.appendChild(probe)
  const timers = installTimerMock()
  try {
    const detach = attachFocusFirstInvalid({
      formId: 'd4',
      draft: { hasServerValues: false, awaitValues: ['d4/picked'] },
    })
    timers.advance(100)
    assertEquals(focusedName(), undefined)

    reportDraftValueRestored('d4', 'd4/picked')
    timers.advance(0)
    assertEquals(focusedName(), 'a')
    assertEquals(probe.getAttribute('data-draft-restoring'), null)
    detach()
  } finally {
    timers.restore()
  }
})

Deno.test('attachFocusFirstInvalid with a draft: detaching while it waits means the focus never moves', () => {
  build('d5', [{ name: 'a', invalid: true }])
  const timers = installTimerMock()
  try {
    const detach = attachFocusFirstInvalid({
      formId: 'd5',
      draft: { hasServerValues: false, returnedFromFailure: true, awaitValues: ['d5/picked'] },
    })
    detach()
    reportDraftValueRestored('d5', 'd5/picked')
    timers.advance(DRAFT_RESTORE_TIMEOUT_MS + 10)
    assertEquals(focusedName(), undefined)
  } finally {
    timers.restore()
  }
})

Deno.test('attachManagedForm: without focusFirstInvalid the focus is left alone, even with an invalid control', () => {
  build('m1', [{ name: 'a', invalid: true }])
  const timers = installTimerMock()
  try {
    const detach = attachManagedForm({ formId: 'm1' })
    timers.advance(1000)
    assertEquals(focusedName(), undefined)
    detach()
  } finally {
    timers.restore()
  }
})

Deno.test('attachManagedForm: focusFirstInvalid focuses the first invalid control', () => {
  build('m2', [{ name: 'a' }, { name: 'b', invalid: true }])
  const timers = installTimerMock()
  try {
    const detach = attachManagedForm({ formId: 'm2', focusFirstInvalid: true })
    timers.advance(0)
    assertEquals(focusedName(), 'b')
    detach()
  } finally {
    timers.restore()
  }
})

Deno.test("attachManagedForm: the focus lands after the draft restored the form's own fields, on the restored value", () => {
  const { field } = build('m3', [{ name: 'title', invalid: true }])
  globals.sessionStorage.setItem('zn-space:m3:submitted', JSON.stringify({ title: 'typed' }))
  let valueAtFocus: string | undefined
  field('title').addEventListener('focus', () => valueAtFocus = field('title').value)
  const timers = installTimerMock()
  try {
    const detach = attachManagedForm({
      formId: 'm3',
      draft: { storageKey: 'm3', hasServerValues: false, returnedFromFailure: true },
      focusFirstInvalid: true,
    })
    timers.advance(0)
    assertEquals(focusedName(), 'title')
    assertEquals(valueAtFocus, 'typed')
    detach()
  } finally {
    timers.restore()
  }
})

Deno.test('attachManagedForm: with unsavedChanges the form is not dirty after the focus moved, so no unload prompt', () => {
  const { form } = build('m4', [{ name: 'a', invalid: true }])
  const previousAdd = globals.addEventListener
  let beforeUnload: ((event: Event) => void) | undefined
  globals.addEventListener = (type: string, listener: (event: Event) => void) => {
    if (type === 'beforeunload') beforeUnload = listener
  }
  const timers = installTimerMock()
  try {
    const detach = attachManagedForm({
      formId: 'm4',
      unsavedChanges: true,
      focusFirstInvalid: true,
    })
    timers.advance(0)
    assertEquals(focusedName(), 'a')
    assert(beforeUnload, 'the unsaved-changes guard attached')
    let prevented = false
    beforeUnload({ preventDefault: () => prevented = true } as unknown as Event)
    assertFalse(prevented)
    assert(form.isConnected)
    detach()
  } finally {
    timers.restore()
    globals.addEventListener = previousAdd
  }
})

Deno.test('attachManagedForm: detach removes the pending focus run', () => {
  build('m5', [{ name: 'a', invalid: true }])
  const timers = installTimerMock()
  try {
    const detach = attachManagedForm({ formId: 'm5', focusFirstInvalid: true })
    detach()
    timers.advance(1000)
    assertEquals(focusedName(), undefined)
  } finally {
    timers.restore()
  }
})
