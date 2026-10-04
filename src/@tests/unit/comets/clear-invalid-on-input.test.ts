import { assert, assertEquals, assertFalse } from '@std/assert'
import { resetDom } from './dom-test-setup.ts'
import { attachClearInvalidOnInput } from 'modules/comets/clear-invalid-on-input.ts'
import { attachManagedForm } from 'modules/comets/managed-form.ts'
import { namespacedStorageKey } from 'modules/comets/draft-storage.ts'
import { attachFormDraftPersistence } from 'modules/comets/form-draft-persistence.ts'

// deno-lint-ignore no-explicit-any
const globals = globalThis as any

type El = HTMLElement

/** Builds a form from an HTML string, the way the server renders it, and mounts it. */
function mount(id: string, html: string): HTMLFormElement {
  resetDom()
  const form = globals.document.createElement('form')
  form.id = id
  form.innerHTML = html
  globals.document.body.appendChild(form)
  return form
}

const $ = (form: Element, selector: string) => form.querySelector(selector) as El

function fire(el: Element, type: 'input' | 'change' | 'focus' | 'blur' | 'keydown'): void {
  el.dispatchEvent(new globals.Event(type, { bubbles: true }))
}

function assertCleared(form: Element, controlSelector: string, errorId: string): void {
  const control = $(form, controlSelector)
  assertFalse(control.hasAttribute('aria-invalid'))
  assertFalse((control.getAttribute('aria-describedby') ?? '').includes(errorId))
  assert($(form, `#${errorId}`).hasAttribute('hidden'))
}

function assertInvalid(form: Element, controlSelector: string, errorId: string): void {
  const control = $(form, controlSelector)
  assertEquals(control.getAttribute('aria-invalid'), 'true')
  assert((control.getAttribute('aria-describedby') ?? '').includes(errorId))
  assertFalse($(form, `#${errorId}`).hasAttribute('hidden'))
}

const ERR = (id: string) =>
  `<div id="${id}" role="alert" data-space-ui="alert">Completa este campo.</div>`

Deno.test('clearInvalidOnInput: a native input is cleared on input, hint kept in aria-describedby', () => {
  const form = mount(
    'c1',
    `<input name="a" aria-invalid="true" aria-describedby="a-hint a-error"><p id="a-hint">Hint</p>${
      ERR('a-error')
    }`,
  )
  const detach = attachClearInvalidOnInput({ formId: 'c1' })
  fire($(form, '[name=a]'), 'input')
  assertEquals($(form, '[name=a]').getAttribute('aria-describedby'), 'a-hint')
  assertFalse($(form, '[name=a]').hasAttribute('aria-invalid'))
  assert($(form, '#a-error').hasAttribute('hidden'))
  assertFalse($(form, '#a-hint').hasAttribute('hidden'))
  detach()
})

Deno.test('clearInvalidOnInput: aria-describedby is removed when the error was its only id', () => {
  const form = mount(
    'c2',
    `<textarea name="t" aria-invalid="true" aria-describedby="t-error"></textarea>${
      ERR('t-error')
    }`,
  )
  const detach = attachClearInvalidOnInput({ formId: 'c2' })
  fire($(form, 'textarea'), 'input')
  assertFalse($(form, 'textarea').hasAttribute('aria-describedby'))
  assertCleared(form, 'textarea', 't-error')
  detach()
})

Deno.test('clearInvalidOnInput: a native select and a checkbox clear on change', () => {
  const form = mount(
    'c3',
    `<select name="s" aria-invalid="true" aria-describedby="s-error"><option>x</option></select>${
      ERR('s-error')
    }
     <input type="checkbox" name="k" aria-invalid="true" aria-describedby="k-error">${
      ERR('k-error')
    }`,
  )
  const detach = attachClearInvalidOnInput({ formId: 'c3' })
  fire($(form, 'select'), 'change')
  fire($(form, '[name=k]'), 'change')
  assertCleared(form, 'select', 's-error')
  assertCleared(form, '[name=k]', 'k-error')
  detach()
})

Deno.test('clearInvalidOnInput: choosing a native radio clears every marked radio of its group', () => {
  const form = mount(
    'c4',
    `<input type="radio" name="p" value="1" aria-invalid="true" aria-describedby="p-error">
     <input type="radio" name="p" value="2" aria-invalid="true" aria-describedby="p-error">${
      ERR('p-error')
    }`,
  )
  const detach = attachClearInvalidOnInput({ formId: 'c4' })
  fire(form.querySelectorAll('input')[1], 'change')
  assertEquals(form.querySelectorAll('[aria-invalid]').length, 0)
  assert($(form, '#p-error').hasAttribute('hidden'))
  detach()
})

Deno.test('clearInvalidOnInput: a radiogroup root clears on a change fired from inside it', () => {
  const form = mount(
    'c5',
    `<div role="radiogroup" aria-invalid="true" aria-describedby="g-error"><button role="radio" aria-checked="false">A</button></div>${
      ERR('g-error')
    }`,
  )
  const detach = attachClearInvalidOnInput({ formId: 'c5' })
  fire($(form, 'button'), 'change')
  assertCleared(form, '[role=radiogroup]', 'g-error')
  detach()
})

Deno.test('clearInvalidOnInput: a combobox trigger (button or input) clears on its own change event', () => {
  const form = mount(
    'c6',
    `<button id="sel" aria-invalid="true" aria-describedby="sel-error">Pick</button><input type="hidden" name="sel">${
      ERR('sel-error')
    }<input role="combobox" id="cb" aria-invalid="true" aria-describedby="cb-error">${
      ERR('cb-error')
    }`,
  )
  const detach = attachClearInvalidOnInput({ formId: 'c6' })
  fire($(form, '#sel'), 'change')
  assertCleared(form, '#sel', 'sel-error')
  assertInvalid(form, '#cb', 'cb-error')
  fire($(form, '#cb'), 'input')
  assertCleared(form, '#cb', 'cb-error')
  detach()
})

Deno.test('clearInvalidOnInput: the error of another field and the form banner are kept', () => {
  const form = mount(
    'c7',
    `<div id="banner" role="alert">Revisa el formulario.</div>
     <input name="a" aria-invalid="true" aria-describedby="a-error">${ERR('a-error')}
     <input name="b" aria-invalid="true" aria-describedby="b-error">${ERR('b-error')}`,
  )
  const detach = attachClearInvalidOnInput({ formId: 'c7' })
  fire($(form, '[name=a]'), 'input')
  assertCleared(form, '[name=a]', 'a-error')
  assertInvalid(form, '[name=b]', 'b-error')
  assertFalse($(form, '#banner').hasAttribute('hidden'))
  detach()
})

Deno.test('clearInvalidOnInput: focus, blur and a key press that changes nothing clear nothing', () => {
  const form = mount(
    'c8',
    `<input name="a" aria-invalid="true" aria-describedby="a-error">${ERR('a-error')}`,
  )
  const detach = attachClearInvalidOnInput({ formId: 'c8' })
  for (const type of ['focus', 'blur', 'keydown'] as const) fire($(form, 'input'), type)
  assertInvalid(form, '[name=a]', 'a-error')
  detach()
})

Deno.test('clearInvalidOnInput: an edit of a valid control does nothing, and clearing twice is idempotent', () => {
  const form = mount(
    'c9',
    `<input name="ok"><input name="a" aria-invalid="true" aria-describedby="a-hint a-error"><p id="a-hint"></p>${
      ERR('a-error')
    }`,
  )
  const detach = attachClearInvalidOnInput({ formId: 'c9' })
  fire($(form, '[name=ok]'), 'input')
  assertInvalid(form, '[name=a]', 'a-error')
  fire($(form, '[name=a]'), 'input')
  fire($(form, '[name=a]'), 'input')
  assertEquals($(form, '[name=a]').getAttribute('aria-describedby'), 'a-hint')
  detach()
})

Deno.test('clearInvalidOnInput: a form with no errors, or a missing form, is a safe no-op', () => {
  const form = mount('c10', '<input name="a">')
  const detach = attachClearInvalidOnInput({ formId: 'c10' })
  fire($(form, 'input'), 'input')
  detach()
  attachClearInvalidOnInput({ formId: 'missing' })()
})

Deno.test('clearInvalidOnInput: detaching stops clearing', () => {
  const form = mount(
    'c11',
    `<input name="a" aria-invalid="true" aria-describedby="a-error">${ERR('a-error')}`,
  )
  attachClearInvalidOnInput({ formId: 'c11' })()
  fire($(form, 'input'), 'input')
  assertInvalid(form, '[name=a]', 'a-error')
})

Deno.test('clearInvalidOnInput: a draft restore does not clear the error, the visitor edit does', () => {
  const form = mount(
    'c12',
    `<input name="a" aria-invalid="true" aria-describedby="a-error">${ERR('a-error')}`,
  )
  globals.sessionStorage.setItem(namespacedStorageKey('c12'), JSON.stringify({ a: 'saved' }))
  const detachClear = attachClearInvalidOnInput({ formId: 'c12' })
  const detachDraft = attachFormDraftPersistence({
    formId: 'c12',
    storageKey: 'c12',
    hasServerValues: false,
  })
  assertEquals(($(form, '[name=a]') as HTMLInputElement).value, 'saved')
  assertInvalid(form, '[name=a]', 'a-error')
  fire($(form, '[name=a]'), 'input')
  assertCleared(form, '[name=a]', 'a-error')
  detachDraft()
  detachClear()
})

Deno.test('attachManagedForm: clearInvalidOnInput enables the behavior; off by default', () => {
  const html = `<input name="a" aria-invalid="true" aria-describedby="a-error">${ERR('a-error')}`
  const off = mount('c13', html)
  const detachOff = attachManagedForm({ formId: 'c13', focusFirstInvalid: true })
  fire($(off, 'input'), 'input')
  assertInvalid(off, '[name=a]', 'a-error')
  detachOff()

  const on = mount('c14', html)
  const detachOn = attachManagedForm({
    formId: 'c14',
    clearInvalidOnInput: true,
    submitGuard: true,
  })
  fire($(on, 'input'), 'input')
  assertCleared(on, '[name=a]', 'a-error')
  detachOn()
})
