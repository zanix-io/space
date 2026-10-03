/**
 * What this app opted into for the serialized initial state: the extended-types codec and the
 * policy that decides which of a page's data crosses to the client.
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

/**
 * What crosses to the client in `self.__ZANIX_SPACE_STATE__`, as the registry stores it:
 * nothing at all (`none`, the default), everything the page's `loader` returned (`all`), every top-level key but
 * the listed ones (`omit`), or only the listed ones (`pick`). Built from `serialization.state` by
 * `parseStateOption`, which also validates it.
 */
export type InitialStatePolicy =
  | { readonly mode: 'all' }
  | { readonly mode: 'none' }
  | { readonly mode: 'omit'; readonly keys: readonly string[] }
  | { readonly mode: 'pick'; readonly keys: readonly string[] }

const DEFAULT_POLICY: InitialStatePolicy = { mode: 'none' }

let initialStatePolicy: InitialStatePolicy = DEFAULT_POLICY

/**
 * Sets what the page renderers serialize into the initial state. Called once by
 * `defineSpaceApp({ serialization: { state } })` — never by app code directly, and never per page:
 * the state a page hands to its own client has to follow one rule across the app.
 *
 * @param policy - The parsed policy. `undefined` restores the default (`none`).
 */
export function setInitialStatePolicy(policy: InitialStatePolicy | undefined): void {
  initialStatePolicy = policy ?? DEFAULT_POLICY
}

/**
 * The app's initial-state policy. Read at render time, not at module load: an app configures it
 * during startup, after this module is first imported.
 *
 * @returns The policy; `{ mode: 'none' }` when the app did not set one.
 */
export function getInitialStatePolicy(): InitialStatePolicy {
  return initialStatePolicy
}

/** Test-only — restores the default (`none`) between cases. Not exported from this package. */
export function resetInitialStatePolicy(): void {
  initialStatePolicy = DEFAULT_POLICY
}
