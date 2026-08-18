/**
 * An opt-in codec that lets `Date`, `Map` and `Set` survive the server → client boundary.
 *
 * Space's data channel is plain JSON in both directions (see `initial-state-global.ts` for the
 * full contract). That contract documents three values it cannot carry faithfully: a `Date`
 * arrives as an ISO string, and a `Map` or `Set` arrives as `{}` with **every entry silently
 * lost**. The first is a daily annoyance; the second is silent data loss. This module addresses
 * exactly those three and nothing else.
 *
 * ## What this deliberately is not
 *
 * Not a wire protocol, and not a step toward one. There is no plugin surface, no user-supplied
 * type registry, no support for `Promise`/function/element references, and no per-value schema.
 * Every future request to add a type (`BigInt`, `RegExp`, class instances) is a step toward the
 * general protocol this package's own architecture review explicitly ruled out — the three types
 * here are the scope, and the absence of an extension point is the design.
 *
 * ## Wire format
 *
 * A claimed value becomes a sentinel object; everything else is untouched:
 *
 * ```
 * Date  →  { "$z": "d", "v": "2026-08-17T10:00:00.000Z" }
 * Map   →  { "$z": "m", "v": [[key, value], ...] }
 * Set   →  { "$z": "s", "v": [ ... ] }
 * ```
 *
 * The whole payload is then wrapped once: `{ "$zv": 1, "d": <encoded> }`. A payload WITHOUT
 * `$zv` is plain JSON and is returned as-is by {@linkcode decodeFromWire} — which is what makes
 * old and new payloads interoperate in both directions, and what makes the disabled path
 * byte-identical to before this module existed.
 *
 * A plain object that genuinely carries its own `$z` key is escaped on the way out
 * (`{ "$z": "raw", "v": <original> }`) so real user data can never be mistaken for a sentinel.
 *
 * ## Failure behaviour is unchanged
 *
 * Circular references and `BigInt` still fail exactly as `initial-state-global.ts` documents.
 * `BigInt` is left alone here and throws later, in `JSON.stringify`, as it always did. A circular
 * reference is detected during encoding — it has to be, since walking one would otherwise recurse
 * until the stack ends — and throws a `TypeError` whose message names the cause, so every existing
 * catch site continues to behave the same way (`onError` + 500 for page state, a named
 * `InternalError` for a Comet's props).
 *
 * @module
 */

import { isExtendedSerializationEnabled } from './serialization-registry.ts'

/** Marks a sentinel object. Deliberately terse — it appears once per claimed value. */
const TAG = '$z'
/** Marks an encoded payload and carries the format version. */
const VERSION_KEY = '$zv'
/** Payload field holding the encoded value, alongside {@linkcode VERSION_KEY}. */
const DATA_KEY = 'd'
/** The only version that has ever existed. A decoder that meets a higher one leaves it alone. */
const VERSION = 1

const TAG_DATE = 'd'
const TAG_MAP = 'm'
const TAG_SET = 's'
/** Escapes a plain object that happens to own a `$z` key of its own. */
const TAG_RAW = 'raw'

/** The shape every sentinel takes on the wire. */
type Sentinel = { [TAG]: string; v: unknown }

/** The wrapper a codec-encoded payload always carries. */
type Envelope = { [VERSION_KEY]: number; [DATA_KEY]: unknown }

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Recursively rewrites `Date`/`Map`/`Set` into sentinels, leaving every other value untouched.
 *
 * @param value - Any value about to cross the boundary.
 * @param seen - Objects on the current path, for circular detection. Internal.
 * @returns The value with claimed types replaced by sentinels.
 * @throws {TypeError} On a circular reference — matching what `JSON.stringify` would have thrown
 * had it been reached first, so callers' existing error handling is unaffected.
 */
function encode(value: unknown, seen: Set<object>): unknown {
  if (value === null || typeof value !== 'object') return value

  if (seen.has(value)) {
    throw new TypeError(
      'Converting circular structure to JSON — a circular reference cannot cross the ' +
        'server/client boundary (see the serialization contract in `initial-state-global.ts`).',
    )
  }
  seen.add(value)
  try {
    if (value instanceof Date) {
      return { [TAG]: TAG_DATE, v: value.toISOString() } satisfies Sentinel
    }
    if (value instanceof Map) {
      return {
        [TAG]: TAG_MAP,
        // Keys are encoded too — a `Map` keyed by `Date` is not exotic, and dropping key fidelity
        // while preserving value fidelity would be a worse contract than not supporting `Map` at all.
        v: [...value].map(([k, v]) => [encode(k, seen), encode(v, seen)]),
      } satisfies Sentinel
    }
    if (value instanceof Set) {
      return { [TAG]: TAG_SET, v: [...value].map((v) => encode(v, seen)) } satisfies Sentinel
    }
    if (Array.isArray(value)) return value.map((v) => encode(v, seen))

    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) out[k] = encode(v, seen)
    // Real user data owning a `$z` key would be indistinguishable from a sentinel on the way back,
    // so it is wrapped. Rare, and cheap when it never happens.
    return TAG in out ? { [TAG]: TAG_RAW, v: out } satisfies Sentinel : out
  } finally {
    seen.delete(value)
  }
}

/** Recursively revives sentinels produced by {@linkcode encode}. */
function decode(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(decode)

  const record = value as Record<string, unknown>
  const tag = record[TAG]
  if (typeof tag === 'string') {
    const inner = record.v
    if (tag === TAG_DATE) return new Date(inner as string)
    if (tag === TAG_MAP) {
      return new Map((inner as [unknown, unknown][]).map(([k, v]) => [decode(k), decode(v)]))
    }
    if (tag === TAG_SET) return new Set((inner as unknown[]).map(decode))
    if (tag === TAG_RAW) {
      // Unwrapped WITHOUT re-running the sentinel check on the result: the whole reason this
      // object was escaped is that it owns a `$z` key of its own, so decoding it again would
      // interpret that key as a sentinel — turning `{ $z: 'd', v: 'hello' }` into a `Date`. Its
      // property VALUES still decode normally, since a claimed type can sit inside it.
      const escaped = inner as Record<string, unknown>
      const revived: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(escaped)) revived[k] = decode(v)
      return revived
    }
  }

  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(record)) out[k] = decode(v)
  return out
}

/**
 * Prepares a value for `JSON.stringify` when the codec is enabled.
 *
 * Callers must only reach this when the app opted in — see `serialization-registry.ts`. With the
 * codec disabled the value is stringified directly, exactly as before, which is what keeps the
 * default path byte-identical.
 *
 * @param value - The value about to be serialized.
 * @returns An envelope carrying the encoded value and the format version.
 * @throws {TypeError} On a circular reference, matching `JSON.stringify`'s own failure.
 */
export function encodeForWire(value: unknown): Envelope {
  return { [VERSION_KEY]: VERSION, [DATA_KEY]: encode(value, new Set()) }
}

/**
 * Reverses {@linkcode encodeForWire}, and passes through anything that is not an envelope.
 *
 * This is the one function the client always calls, whether or not the app enabled the codec —
 * a plain payload has no `$zv` and is returned untouched, so the disabled path costs a single
 * property check.
 *
 * @param value - Whatever came off the wire.
 * @returns The decoded value, or `value` itself when it is not a codec envelope.
 */
export function decodeFromWire(value: unknown): unknown {
  if (!isPlainRecord(value)) return value
  if (value[VERSION_KEY] !== VERSION) return value
  return decode(value[DATA_KEY])
}

/**
 * Serializes a value for the wire, applying the codec only if the app opted in.
 *
 * The single place that consults the registry, so the three write sites (a Comet's props and each
 * renderer's `initialState`) cannot drift apart on when encoding happens.
 *
 * @param value - The value to serialize.
 * @returns The JSON string to embed.
 * @throws {TypeError} Whatever `JSON.stringify` would throw — circular references, `BigInt` — with
 * the failure contract unchanged from before the codec existed.
 */
export function stringifyForWire(value: unknown): string {
  return JSON.stringify(isExtendedSerializationEnabled() ? encodeForWire(value) : value)
}

/**
 * Parses and decodes a `data-comet-props` attribute.
 *
 * The single place the three client read sites share — both hydrate modules and
 * `comet-persistence.ts`'s `reuseRetainedComets`. A retained Comet updated across an Orbit swap has
 * to decode identically to a freshly hydrated one, and one shared function is what guarantees it.
 *
 * @param raw - The attribute value, or `null` when absent.
 * @returns The decoded props.
 */
export function parseCometProps(raw: string | null): Record<string, unknown> {
  return decodeFromWire(JSON.parse(raw || '{}')) as Record<string, unknown>
}
