/**
 * Whether this app opted into the extended-types serialization codec.
 *
 * Its own module, with zero imports, for the same reason `initial-state-global.ts` has one: both
 * the server-only render path and the client-safe hydration path read this, and neither should
 * pull the other's module graph along.
 *
 * Off is the default and off means off — no envelope, no sentinels, not one extra byte, and
 * behaviour identical to before the codec existed. See `serialization-codec.ts` for what turning
 * it on actually changes.
 *
 * @module
 */

let extendedTypes = false

/**
 * Enables or disables the codec for the whole app. Called once by
 * `defineSpaceApp({ serialization: { extendedTypes } })` — never by app code directly, and never
 * per page or per Comet: a payload written by one half of an app and read by the other must agree
 * on the format, which a per-site flag could not guarantee.
 *
 * @param enabled - `true` to encode `Date`/`Map`/`Set`; anything else leaves the codec off.
 */
export function setExtendedSerialization(enabled: boolean | undefined): void {
  extendedTypes = enabled === true
}

/**
 * Whether the codec is enabled. Read at serialization time, not at module load — an app configures
 * it during startup, which happens after this module is first imported.
 *
 * @returns `true` when the app opted in.
 */
export function isExtendedSerializationEnabled(): boolean {
  return extendedTypes
}

/** Test-only — restores the default (off) between cases. Not exported from this package. */
export function resetExtendedSerialization(): void {
  extendedTypes = false
}
