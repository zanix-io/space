import { assertEquals } from '@std/assert'
import { toValidatablePayload } from 'modules/router/action-validation.ts'

Deno.test(
  'toValidatablePayload: a FormData key seen once stays a plain string — every ordinary ' +
    'single-value field (displayName, birthDate, ...) resolves exactly as it did before',
  () => {
    const body = new FormData()
    body.set('displayName', 'Alex')
    body.set('birthDate', '1990-01-01')

    assertEquals(toValidatablePayload(body), {
      displayName: 'Alex',
      birthDate: '1990-01-01',
    })
  },
)

Deno.test(
  'toValidatablePayload: a FormData key repeated more than once (a real multi-checkbox ' +
    'submission, name="objectives" appended once per checked box) becomes a real array, in ' +
    'submission order — never silently collapsed to just the last value',
  () => {
    const body = new FormData()
    body.append('objectives', 'friendship')
    body.append('objectives', 'travel')
    body.append('objectives', 'mentorship')

    assertEquals(toValidatablePayload(body), {
      objectives: ['friendship', 'travel', 'mentorship'],
    })
  },
)

Deno.test(
  'toValidatablePayload: repeated and single-value fields on the SAME submission are each ' +
    'resolved independently — the array coercion for one field never leaks onto another',
  () => {
    const body = new FormData()
    body.set('displayName', 'Alex')
    body.append('objectives', 'friendship')
    body.append('objectives', 'travel')

    assertEquals(toValidatablePayload(body), {
      displayName: 'Alex',
      objectives: ['friendship', 'travel'],
    })
  },
)

Deno.test(
  'toValidatablePayload: a File entry is skipped, exactly as before — multipart/form-data has ' +
    'no parsed body at this layer, real file uploads are outside what RTO validation covers here',
  () => {
    const body = new FormData()
    body.set('displayName', 'Alex')
    body.set('avatar', new File(['fake bytes'], 'avatar.png', { type: 'image/png' }))

    assertEquals(toValidatablePayload(body), { displayName: 'Alex' })
  },
)

Deno.test(
  'toValidatablePayload: a non-FormData object body (a real JSON action body) passes through ' +
    'untouched',
  () => {
    const body = { email: 'a@b.com', tags: ['x', 'y'] }

    assertEquals(toValidatablePayload(body), body)
  },
)

Deno.test('toValidatablePayload: a non-object body (undefined, null, a primitive) resolves to {}', () => {
  assertEquals(toValidatablePayload(undefined), {})
  assertEquals(toValidatablePayload(null), {})
  assertEquals(toValidatablePayload('a raw string body'), {})
})
