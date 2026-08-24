import { assertEquals, assertStrictEquals } from '@std/assert'
import { getActionFieldError, getActionFieldValue } from 'modules/router/action-fields.ts'

type CheckoutBody = { email: string; billing: { zip: string } }

Deno.test(
  'getActionFieldError: a leaf field returns the first constraint of the first entry — the ' +
    'real array shape errorValidationFormatting produces, not an object with .constraints on it',
  () => {
    const fieldErrors = {
      email: [{ constraints: ["'email' must be a valid email address."], value: 'nope' }],
    }

    assertEquals(
      getActionFieldError<CheckoutBody>(fieldErrors, 'email'),
      "'email' must be a valid email address.",
    )
  },
)

Deno.test(
  'getActionFieldError: a nested-RTO field reads .message from the { message, properties } shape',
  () => {
    const fieldErrors = {
      billing: { message: "'zip' is required.", properties: { zip: [{ constraints: ['x'] }] } },
    }

    assertEquals(getActionFieldError<CheckoutBody>(fieldErrors, 'billing'), "'zip' is required.")
  },
)

Deno.test('getActionFieldError: a field with no failure returns undefined', () => {
  const fieldErrors = { email: [{ constraints: ['bad'] }] }

  assertStrictEquals(getActionFieldError<CheckoutBody>(fieldErrors, 'billing'), undefined)
})

Deno.test(
  'getActionFieldError: undefined fieldErrors (every GET, and any successful action) returns ' +
    'undefined, never throws',
  () => {
    assertStrictEquals(getActionFieldError<CheckoutBody>(undefined, 'email'), undefined)
  },
)

Deno.test(
  'getActionFieldError: an entry shaped like neither known form fails soft to undefined, never throws',
  () => {
    const fieldErrors = { email: 'not a real validator shape' }

    // deno-lint-ignore no-explicit-any
    assertStrictEquals(getActionFieldError<CheckoutBody>(fieldErrors as any, 'email'), undefined)
  },
)

Deno.test(
  'getActionFieldError: multiple constraints on the same leaf field — only the FIRST is returned; ' +
    "the rest stay reachable directly off fieldErrors[key], per this function's own documented scope",
  () => {
    const fieldErrors = {
      email: [{ constraints: ['first message', 'second message'] }],
    }

    assertEquals(getActionFieldError<CheckoutBody>(fieldErrors, 'email'), 'first message')
  },
)

Deno.test('getActionFieldValue: returns the resubmitted value for the field', () => {
  const submitted = { email: 'ana@example.com' }

  assertEquals(getActionFieldValue<CheckoutBody>(submitted, 'email'), 'ana@example.com')
})

Deno.test(
  'getActionFieldValue: a field absent from what was submitted returns the fallback, defaulting ' +
    "to '' rather than undefined — an input's value must never flip undefined-to-string across renders",
  () => {
    assertEquals(getActionFieldValue<CheckoutBody>({}, 'email'), '')
  },
)

Deno.test('getActionFieldValue: an explicit fallback wins over the default empty string', () => {
  assertEquals(
    getActionFieldValue<CheckoutBody>({}, 'email', 'placeholder@example.com'),
    'placeholder@example.com',
  )
})

Deno.test(
  'getActionFieldValue: undefined submitted (every GET, and any successful action) returns the ' +
    'fallback, never throws',
  () => {
    assertEquals(getActionFieldValue<CheckoutBody>(undefined, 'email'), '')
  },
)

Deno.test(
  'getActionFieldValue: an empty string that was genuinely submitted is returned as-is, not ' +
    'replaced by the fallback — "" is a real, present value here, not an absence',
  () => {
    assertEquals(getActionFieldValue<CheckoutBody>({ email: '' }, 'email', 'fallback'), '')
  },
)
