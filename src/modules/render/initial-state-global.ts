/**
 * The `<script>` global name that carries a server render's initial state to the client — a
 * single, predictable name instead of scattering several `window.__X__` globals across the
 * codebase. Its own file, with zero imports, so both the server-only
 * {@linkcode renderToResponse} and the client-safe {@linkcode readInitialState} can depend on it
 * without either one pulling the other's module graph along.
 *
 * ## The server → client serialization contract
 *
 * This is the one data channel that crosses the server/client boundary in Space — both
 * `renderToResponse`'s own `initialState` option (this file's own constant) and a Comet's own
 * props (`data-comet-props`, `marker.ts`) use the IDENTICAL mechanism: plain `JSON.stringify()`
 * server-side, plain `JSON.parse()` client-side. Deliberately not a richer format — no
 * tree/element serialization, no support for Promises/functions/Server-Action-style references —
 * matching this project's own Phase 0 conclusion that nothing in Space's real usage has ever
 * needed more than flat, JSON-safe data, and that inventing a richer wire format ahead of an
 * actual demonstrated need is exactly the premature protocol design that conclusion ruled out.
 *
 * **One narrow, opt-in exception exists, and it is worth being precise about why.** Formalizing
 * this contract keeps it this shape; it is not a step toward a richer one, with one amendment:
 * `defineSpaceApp({ serialization: { extendedTypes: true } })` makes `Date`, `Map` and `Set`
 * round-trip as real instances (see `serialization-codec.ts`). Those three were chosen because
 * this contract already documents them as its own failures — a `Date` silently degrading to a
 * string, and a `Map`/`Set` silently losing EVERY entry — not because a richer protocol became
 * desirable. The codec has no extension point, no plugin surface and no user-supplied type
 * registry, precisely so that it cannot become the general format this contract rules out.
 * **With the option off, which is the default, every word below is exactly true and the bytes on
 * the wire are unchanged.**
 *
 * **Supported values** — anything `JSON.stringify`/`JSON.parse` round-trip losslessly: `string`,
 * finite `number`, `boolean`, `null`, and plain arrays/objects of the same, nested arbitrarily
 * deep. This is the entire supported surface; every value below is either a defined (if lossy)
 * degradation or a defined failure — never silently "supported" in a way this contract doesn't
 * name explicitly.
 *
 * **Exact behavior for every value `JSON.stringify` cannot represent faithfully:**
 * - `undefined` as an object property value — the property is omitted entirely from the
 *   serialized output. As an array element, it becomes `null` instead. (A top-level
 *   `initialState: undefined` is a different, deliberate case — "no state at all," no script
 *   rendered — not this rule.)
 * - A function, anywhere in the value — same treatment as `undefined`: omitted as a property,
 *   `null` as an array element.
 * - `Date` — serializes via its own `toJSON()` to a plain ISO 8601 string. The client gets that
 *   string back, never a real `Date` instance — neither `readInitialState()` nor a Comet's own
 *   prop-parsing revives one. (Opt into `serialization.extendedTypes` and it round-trips as a real
 *   `Date`.)
 * - `Map` — has no own enumerable properties and no `toJSON`, so it serializes to `{}` — every
 *   entry is silently lost. Convert to a plain object, or a `[[key, value], ...]` array, before it
 *   needs to cross this boundary — or opt into `serialization.extendedTypes`, which carries it
 *   whole, keys included.
 * - `Set` — same shape as `Map`, for the same reason: no own enumerable properties and no
 *   `toJSON`, so it ALSO serializes to `{}` (`JSON.stringify` only ever produces array output for
 *   a real `Array`, never for another iterable that merely resembles one), every member lost.
 *   Convert to a plain array first — or opt into
 *   `serialization.extendedTypes`, which carries it whole.
 * - A circular reference — `JSON.stringify` itself throws. This is a genuine serialization
 *   FAILURE, not a lossy degradation, and it's the one case this contract required a real code
 *   fix for: `renderToResponse` (React, `render-to-response.tsx`) and `renderToResponse` (Preact,
 *   `render-to-response-preact.ts`) both catch it explicitly and resolve exactly the same way a
 *   render error already does — `onError` (if given) receives the real error, and the function
 *   resolves with a `500` — matching each function's own pre-existing, documented "always
 *   resolves, never throws" contract instead of escaping past it. A Comet's own props hitting the
 *   same case (`defineComet`) instead throws a clear, Space-authored `InternalError` naming the
 *   offending Comet — props are evaluated as part of a normal render pass, where an uncaught throw
 *   is already the correct, pre-existing way errors propagate there, so this stays consistent with
 *   that instead of introducing a second, Comet-specific graceful-failure path.
 * - `BigInt` — also throws (`JSON.stringify` has no representation for it at all). Handled
 *   identically to a circular reference — both are simply "`JSON.stringify` threw" from this
 *   contract's own point of view; nothing here special-cases one over the other.
 * - Anything else `JSON.stringify` doesn't handle natively (a `Symbol`, a class instance whose
 *   only real state lives in non-enumerable fields, ...) falls into one of the two buckets above:
 *   either silently dropped/nulled the same way `undefined`/a function is, or thrown the same way
 *   a circular reference is. There is no third behavior anywhere in this contract.
 *
 * @module
 */
export const INITIAL_STATE_GLOBAL = '__ZANIX_SPACE_STATE__'
