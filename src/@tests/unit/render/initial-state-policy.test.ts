import { assert, assertEquals, assertStrictEquals, assertThrows } from '@std/assert'
import { InternalError } from '@zanix/errors'
import {
  applyStatePolicy,
  omitStateKeys,
  parseStateOption,
  pickStateKeys,
  resolveInitialState,
} from 'modules/render/initial-state-policy.ts'
import {
  getInitialStatePolicy,
  resetInitialStatePolicy,
  setInitialStatePolicy,
} from 'modules/render/serialization-registry.ts'
import type { InitialStateOption } from 'typings/manifest.ts'

/**
 * The rule behind `defineSpaceApp({ serialization: { state } })`: validating the option, storing
 * the policy and applying it to a page's data. Pure functions over plain values: the
 * renderer-level proof lives in `functional/render/initial-state-policy.test.tsx`.
 */

Deno.test('omitStateKeys: leaves the listed top-level keys out and keeps the rest in order', () => {
  const state = { lang: 'es', messages: { a: 1 }, wishlist: [1, 2], draft: { k: 'v' } }
  const result = omitStateKeys(state, ['messages'])
  assertEquals(result, { lang: 'es', wishlist: [1, 2], draft: { k: 'v' } })
  assertEquals(Object.keys(result as object), ['lang', 'wishlist', 'draft'])
})

Deno.test('omitStateKeys: never mutates the original, which keeps every key', () => {
  const messages = { a: 1 }
  const state = { lang: 'es', messages }
  const result = omitStateKeys(state, ['messages']) as Record<string, unknown>
  assert(result !== state)
  assertStrictEquals(state.messages, messages)
  assertEquals(Object.keys(state), ['lang', 'messages'])
  // The kept values are the same references: a shallow copy, not a deep one.
  const kept = { deep: true }
  const withKept = omitStateKeys({ kept, messages }, ['messages']) as { kept: unknown }
  assertStrictEquals(withKept.kept, kept)
})

Deno.test('omitStateKeys: a key the state does not have is ignored and the same value comes back', () => {
  const state = { lang: 'es' }
  assertStrictEquals(omitStateKeys(state, ['messages']), state)
})

Deno.test('omitStateKeys: no keys returns the same value, so the default changes nothing', () => {
  const state = { lang: 'es', messages: {} }
  assertStrictEquals(omitStateKeys(state, []), state)
  assertEquals(JSON.stringify(omitStateKeys(state, [])), JSON.stringify(state))
})

Deno.test('omitStateKeys: a nested key of the same name is kept', () => {
  const state = { messages: { a: 1 }, other: { messages: { b: 2 } } }
  assertEquals(omitStateKeys(state, ['messages']), { other: { messages: { b: 2 } } })
})

Deno.test('omitStateKeys: only a plain object has keys to leave out', () => {
  const array = [{ messages: 1 }]
  assertStrictEquals(omitStateKeys(array, ['messages']), array)
  const when = new Date(0)
  assertStrictEquals(omitStateKeys(when, ['messages']), when)
  const map = new Map([['messages', 1]])
  assertStrictEquals(omitStateKeys(map, ['messages']), map)
  class Box {
    public messages = 'kept'
  }
  const box = new Box()
  assertStrictEquals(omitStateKeys(box, ['messages']), box)
  assertStrictEquals(omitStateKeys('text', ['messages']), 'text')
  assertStrictEquals(omitStateKeys(42, ['messages']), 42)
  assertStrictEquals(omitStateKeys(null, ['messages']), null)
  assertStrictEquals(omitStateKeys(undefined, ['messages']), undefined)
})

Deno.test('omitStateKeys: an object with a null prototype is a plain object', () => {
  const state = Object.assign(Object.create(null), { lang: 'es', messages: {} })
  assertEquals(omitStateKeys(state, ['messages']), { lang: 'es' })
})

Deno.test('omitStateKeys: an inherited key is not an own key and is not omitted', () => {
  const state = Object.create({ messages: 'inherited' }) as Record<string, unknown>
  state.lang = 'es'
  // Not a plain object (its prototype is not `Object.prototype`), so it is returned as it came.
  assertStrictEquals(omitStateKeys(state, ['messages']), state)
})

Deno.test('omitStateKeys: several keys at once, and a key named __proto__ stays a data key', () => {
  assertEquals(omitStateKeys({ a: 1, b: 2, c: 3 }, ['a', 'c']), { b: 2 })
  const hostile = JSON.parse('{"__proto__": {"x": 1}, "messages": {}}')
  const result = omitStateKeys(hostile, ['messages']) as Record<string, unknown>
  assertEquals(Object.keys(result), ['__proto__'])
  assertStrictEquals(Object.getPrototypeOf(result), Object.prototype)
})

Deno.test('pickStateKeys: only the listed top-level keys pass, in the original key order', () => {
  const state = { lang: 'es', messages: { a: 1 }, wishlist: [1], draft: 'x' }
  const result = pickStateKeys(state, ['draft', 'lang'])
  assertEquals(result, { lang: 'es', draft: 'x' })
  assertEquals(Object.keys(result as object), ['lang', 'draft'])
  assertEquals(Object.keys(state), ['lang', 'messages', 'wishlist', 'draft'])
})

Deno.test('pickStateKeys: a listed key the state lacks is ignored and a nested key is not picked', () => {
  assertEquals(pickStateKeys({ a: 1 }, ['a', 'missing']), { a: 1 })
  assertEquals(pickStateKeys({ outer: { inner: 1 }, inner: 2 }, ['inner']), { inner: 2 })
})

Deno.test('pickStateKeys: an empty list leaves an empty object and a non-object comes back as it was', () => {
  assertEquals(pickStateKeys({ a: 1 }, []), {})
  const array = [1, 2]
  assertStrictEquals(pickStateKeys(array, ['0']), array)
  const when = new Date(0)
  assertStrictEquals(pickStateKeys(when, ['a']), when)
  assertStrictEquals(pickStateKeys('text', ['a']), 'text')
  assertStrictEquals(pickStateKeys(undefined, ['a']), undefined)
})

Deno.test('applyStatePolicy: every mode', () => {
  const state = { lang: 'es', messages: { a: 1 } }
  assertStrictEquals(applyStatePolicy(state, { mode: 'all' }), state)
  assertStrictEquals(applyStatePolicy(state, { mode: 'none' }), undefined)
  assertEquals(applyStatePolicy(state, { mode: 'omit', keys: ['messages'] }), { lang: 'es' })
  assertEquals(applyStatePolicy(state, { mode: 'pick', keys: ['messages'] }), {
    messages: { a: 1 },
  })
})

Deno.test("parseStateOption: undefined and 'none' are the default, 'all' lets everything cross", () => {
  assertEquals(parseStateOption(undefined), { mode: 'none' })
  assertEquals(parseStateOption('none'), { mode: 'none' })
  assertEquals(parseStateOption('all'), { mode: 'all' })
})

Deno.test('parseStateOption: omit and pick keep their keys, as a copy', () => {
  const keys = ['messages']
  const omit = parseStateOption({ omit: keys })
  assertEquals(omit, { mode: 'omit', keys: ['messages'] })
  keys.push('wishlist')
  assertEquals(omit, { mode: 'omit', keys: ['messages'] })
  assertEquals(parseStateOption({ pick: ['lang', 'user'] }), {
    mode: 'pick',
    keys: ['lang', 'user'],
  })
  assertEquals(parseStateOption({ pick: [] }), { mode: 'pick', keys: [] })
})

Deno.test('parseStateOption: omit together with pick throws a message that says what to do', () => {
  const error = assertThrows(
    () => parseStateOption({ omit: ['a'], pick: ['b'] } as never),
    InternalError,
  )
  assert(error.message.includes("cannot combine 'omit' and 'pick'"), error.message)
  assert(error.message.includes('not both'), error.message)
})

Deno.test('parseStateOption: every other invalid value throws and names what it received', () => {
  const invalid: [unknown, string][] = [
    ['everything', "'everything'"],
    [true, 'boolean'],
    [42, 'number'],
    [null, 'null'],
    [['omit'], 'an array'],
  ]
  for (const [value, received] of invalid) {
    const error = assertThrows(
      () => parseStateOption(value as InitialStateOption),
      InternalError,
    )
    assert(error.message.includes(received), `${received}: ${error.message}`)
    assert(error.message.includes("'none' (the default)"), error.message)
  }
})

Deno.test('parseStateOption: an object with neither list, or with a key it does not know, throws', () => {
  const neither = assertThrows(() => parseStateOption({} as never), InternalError)
  assert(neither.message.includes("neither 'omit' nor 'pick'"), neither.message)
  const typo = assertThrows(() => parseStateOption({ omitt: ['a'] } as never), InternalError)
  assert(typo.message.includes("'omitt'"), typo.message)
  const extra = assertThrows(
    () => parseStateOption({ pick: ['a'], also: 1 } as never),
    InternalError,
  )
  assert(extra.message.includes("'also'"), extra.message)
})

Deno.test('parseStateOption: a list that is not an array of strings throws', () => {
  for (const bad of ['messages', [1], [null], {}]) {
    const error = assertThrows(() => parseStateOption({ omit: bad } as never), InternalError)
    assert(error.message.includes("'omit' must be an array of strings"), error.message)
  }
  const pick = assertThrows(() => parseStateOption({ pick: 'lang' } as never), InternalError)
  assert(pick.message.includes("'pick' must be an array of strings"), pick.message)
})

Deno.test('registry: the policy defaults to none, is set by the app and is reset', () => {
  try {
    assertEquals(getInitialStatePolicy(), { mode: 'none' })
    setInitialStatePolicy({ mode: 'all' })
    assertEquals(getInitialStatePolicy(), { mode: 'all' })
    setInitialStatePolicy(undefined)
    assertEquals(getInitialStatePolicy(), { mode: 'none' })
    setInitialStatePolicy({ mode: 'omit', keys: ['messages'] })
    resetInitialStatePolicy()
    assertEquals(getInitialStatePolicy(), { mode: 'none' })
  } finally {
    resetInitialStatePolicy()
  }
})

Deno.test('resolveInitialState: nothing crosses by default, and the configured policy applies', () => {
  try {
    const state = { lang: 'es', messages: { a: 1 } }
    assertStrictEquals(resolveInitialState(state), undefined)
    setInitialStatePolicy({ mode: 'all' })
    assertStrictEquals(resolveInitialState(state), state)
    setInitialStatePolicy({ mode: 'omit', keys: ['messages'] })
    assertEquals(resolveInitialState(state), { lang: 'es' })
    setInitialStatePolicy({ mode: 'pick', keys: ['lang'] })
    assertEquals(resolveInitialState(state), { lang: 'es' })
    assertStrictEquals(resolveInitialState(undefined), undefined)
  } finally {
    resetInitialStatePolicy()
  }
})
