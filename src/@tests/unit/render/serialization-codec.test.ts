import { assert, assertEquals, assertInstanceOf, assertThrows } from '@std/assert'
import { decodeFromWire, encodeForWire } from 'modules/render/serialization-codec.ts'

/**
 * The codec's own contract, independent of either renderer or either delivery channel.
 *
 * The property that matters most is the LAST group: a payload that never went through
 * `encodeForWire` must come back out of `decodeFromWire` untouched. That is what lets an app with
 * the codec disabled keep byte-identical wire output while the client still calls the decoder
 * unconditionally.
 *
 * @module
 */

/** Round-trips through real JSON, exactly as the wire does — never object-to-object. */
function roundTrip(value: unknown): unknown {
  return decodeFromWire(JSON.parse(JSON.stringify(encodeForWire(value))))
}

Deno.test('codec: a Date survives as a real Date, not an ISO string', () => {
  const when = new Date('2026-08-17T10:00:00.000Z')
  const out = roundTrip({ when }) as { when: Date }

  assertInstanceOf(out.when, Date)
  assertEquals(out.when.getTime(), when.getTime())
})

Deno.test('codec: a Map survives with all its entries — the case that silently lost data', () => {
  const source = new Map<string, number>([['a', 1], ['b', 2]])
  const out = roundTrip({ source }) as { source: Map<string, number> }

  assertInstanceOf(out.source, Map)
  assertEquals(out.source.size, 2)
  assertEquals(out.source.get('a'), 1)
  assertEquals(out.source.get('b'), 2)
})

Deno.test('codec: a Set survives with all its members', () => {
  const tags = new Set(['x', 'y', 'z'])
  const out = roundTrip({ tags }) as { tags: Set<string> }

  assertInstanceOf(out.tags, Set)
  assertEquals([...out.tags], ['x', 'y', 'z'])
})

Deno.test(
  'codec: Map KEYS are encoded too, not just values — a Map keyed by Date round-trips whole',
  () => {
    const key = new Date('2026-01-02T03:04:05.000Z')
    const out = roundTrip(new Map([[key, { nested: new Set([1, 2]) }]])) as Map<
      Date,
      { nested: Set<number> }
    >

    assertInstanceOf(out, Map)
    const [[outKey, outValue]] = [...out]
    assertInstanceOf(outKey, Date)
    assertEquals(outKey.getTime(), key.getTime())
    assertInstanceOf(outValue.nested, Set)
    assertEquals([...outValue.nested], [1, 2])
  },
)

Deno.test('codec: claimed types nested arbitrarily deep inside arrays and objects', () => {
  const out = roundTrip({
    level: [{ deeper: { when: new Date(0), items: new Set([new Date(1000)]) } }],
  }) as { level: [{ deeper: { when: Date; items: Set<Date> } }] }

  assertInstanceOf(out.level[0].deeper.when, Date)
  const [onlyItem] = [...out.level[0].deeper.items]
  assertInstanceOf(onlyItem, Date)
  assertEquals(onlyItem.getTime(), 1000)
})

Deno.test(
  'codec: user data owning a `$z` key is escaped and comes back unchanged — real data can never ' +
    'be mistaken for a sentinel',
  () => {
    const out = roundTrip({ payload: { $z: 'd', v: 'not actually a date' } }) as {
      payload: Record<string, unknown>
    }

    assertEquals(out.payload, { $z: 'd', v: 'not actually a date' })
    assert(!(out.payload instanceof Date))
  },
)

Deno.test('codec: plain JSON values are unaffected by the round trip', () => {
  const value = { s: 'x', n: 1.5, b: true, nil: null, arr: [1, 'two', false], obj: { deep: [] } }
  assertEquals(roundTrip(value), value)
})

Deno.test(
  'codec: the documented lossy/failing values keep their documented behaviour — the codec adds ' +
    'types, it never turns a failure into a success',
  () => {
    // `undefined` and functions: dropped as properties, nulled as array elements — unchanged.
    const out = roundTrip({
      gone: undefined,
      fn: () => {},
      arr: [1, undefined, 3],
    }) as Record<string, unknown>
    assert(!('gone' in out))
    assert(!('fn' in out))
    assertEquals(out.arr, [1, null, 3])

    // BigInt still throws, from `JSON.stringify`, exactly as before.
    assertThrows(() => JSON.stringify(encodeForWire({ big: 1n })), TypeError)
  },
)

Deno.test(
  'codec: a circular reference throws during encoding, with a message naming the cause — the ' +
    'existing catch sites depend on this being a throw, not a stack overflow',
  () => {
    const circular: Record<string, unknown> = { name: 'root' }
    circular.self = circular

    const error = assertThrows(() => encodeForWire(circular), TypeError)
    assert(/circular/i.test((error as Error).message), (error as Error).message)
  },
)

Deno.test(
  'codec: a circular reference that is merely REPEATED, not cyclic, is fine — the same object ' +
    'appearing twice side by side must not be mistaken for a cycle',
  () => {
    const shared = { id: 1 }
    const out = roundTrip({ a: shared, b: shared }) as { a: unknown; b: unknown }
    assertEquals(out.a, { id: 1 })
    assertEquals(out.b, { id: 1 })
  },
)

Deno.test(
  'decodeFromWire: a payload that never went through the codec is returned untouched — this is ' +
    'what makes the disabled path free and keeps old payloads readable',
  () => {
    const plain = { user: { name: 'Ana' }, when: '2026-08-17T10:00:00.000Z' }
    assertEquals(decodeFromWire(plain), plain)
    // Including values that merely resemble the envelope.
    assertEquals(decodeFromWire({ $zv: 'not-a-number', d: 1 }), { $zv: 'not-a-number', d: 1 })
    assertEquals(decodeFromWire(null), null)
    assertEquals(decodeFromWire('a string'), 'a string')
    assertEquals(decodeFromWire([1, 2]), [1, 2])
  },
)

Deno.test('encodeForWire: output carries the version envelope', () => {
  const encoded = encodeForWire({ ok: true }) as Record<string, unknown>
  assertEquals(encoded.$zv, 1)
  assertEquals(encoded.d, { ok: true })
})
