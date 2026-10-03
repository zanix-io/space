import { InternalError } from '@zanix/errors'
import type { InitialStateOption } from 'typings/manifest.ts'
import { getInitialStatePolicy, type InitialStatePolicy } from './serialization-registry.ts'

/**
 * The rule that decides what a page hands to its own client in `self.__ZANIX_SPACE_STATE__`.
 *
 * A page's `loader` result is the props its component renders with on the server, and none of it
 * crosses to the client by default. `defineSpaceApp({ serialization: { state } })` lets all of it,
 * some keys or none cross, and this module is where the option is validated (`parseStateOption`)
 * and applied (`resolveInitialState`). The component's own props
 * are never affected: only the serialized copy changes, and the value the `loader` returned is
 * never mutated.
 *
 * @module
 */

const STATE_OPTION_HELP = "Use 'none' (the default), 'all', { pick: ['key', ...] } or " +
  "{ omit: ['key', ...] }."

/**
 * Validates `serialization.state` and turns it into the policy the renderers apply.
 *
 * @param option - The value an app passed as `serialization.state`; `undefined` means the default,
 * `'none'`.
 * @returns The policy to store.
 * @throws {InternalError} If the value is not one of the four forms, if `omit` and `pick` are
 * combined, if the object has neither or has a key it does not know, or if a list is not an array
 * of strings.
 */
export function parseStateOption(option: InitialStateOption | undefined): InitialStatePolicy {
  if (option === undefined || option === 'none') return { mode: 'none' }
  if (option === 'all') return { mode: 'all' }
  if (typeof option !== 'object' || option === null || Array.isArray(option)) {
    throw new InternalError(
      `serialization.state received ${
        describe(option)
      }, which is not a valid value. ${STATE_OPTION_HELP}`,
      { meta: { received: describe(option) } },
    )
  }
  const record = option as Record<string, unknown>
  const unknown = Object.keys(record).filter((key) => key !== 'omit' && key !== 'pick')
  if (unknown.length > 0) {
    throw new InternalError(
      `serialization.state has ${unknown.map((key) => `'${key}'`).join(', ')}, which ` +
        `${unknown.length === 1 ? 'is' : 'are'} not an option. ${STATE_OPTION_HELP}`,
      { meta: { unknown } },
    )
  }
  const hasOmit = record.omit !== undefined
  const hasPick = record.pick !== undefined
  if (hasOmit && hasPick) {
    throw new InternalError(
      "serialization.state cannot combine 'omit' and 'pick'. Use 'omit' to leave some top-level " +
        "keys out of the state, or 'pick' to let only some of them through, not both.",
      { meta: { combined: ['omit', 'pick'] } },
    )
  }
  if (!hasOmit && !hasPick) {
    throw new InternalError(
      `serialization.state is an object with neither 'omit' nor 'pick'. ${STATE_OPTION_HELP}`,
    )
  }
  const mode = hasOmit ? 'omit' : 'pick'
  const keys = record[mode]
  if (!Array.isArray(keys) || keys.some((key) => typeof key !== 'string')) {
    throw new InternalError(
      `serialization.state '${mode}' must be an array of strings, received ${describe(keys)}.`,
      { meta: { mode, received: describe(keys) } },
    )
  }
  return { mode, keys: [...(keys as string[])] }
}

/**
 * Leaves top-level keys out of a state.
 *
 * Only a plain object has top-level keys. An array, a class instance (`Date`, `Map`, ...), a
 * primitive and `undefined` come back as the same value, and so does a plain object that has none
 * of the keys: the serialized bytes of an untouched state do not change. Keys are matched at the
 * top level only; a nested key of the same name is kept.
 *
 * @param state - The page's resolved data.
 * @param keys - The top-level keys to leave out.
 * @returns `state` itself when nothing is left out, otherwise a shallow copy without those keys,
 * in the original key order.
 */
export function omitStateKeys(state: unknown, keys: readonly string[]): unknown {
  if (keys.length === 0 || !isPlainObject(state)) return state
  if (!keys.some((key) => Object.hasOwn(state, key))) return state
  return Object.fromEntries(Object.entries(state).filter(([key]) => !keys.includes(key)))
}

/**
 * Lets only the listed top-level keys of a state through.
 *
 * The same rules as {@linkcode omitStateKeys} apply to what counts as a state: only a plain
 * object is filtered, anything else comes back as the same value. A listed key the state does not
 * have is ignored, and an empty list leaves an empty object.
 *
 * @param state - The page's resolved data.
 * @param keys - The top-level keys allowed through.
 * @returns A shallow copy with only those keys, in the original key order, or `state` itself when
 * it is not a plain object.
 */
export function pickStateKeys(state: unknown, keys: readonly string[]): unknown {
  if (!isPlainObject(state)) return state
  return Object.fromEntries(Object.entries(state).filter(([key]) => keys.includes(key)))
}

/**
 * Applies a policy to a page's data.
 *
 * @param state - The page's resolved data.
 * @param policy - What crosses to the client.
 * @returns The value to serialize, or `undefined` for no state at all (`none`).
 */
export function applyStatePolicy(state: unknown, policy: InitialStatePolicy): unknown {
  switch (policy.mode) {
    case 'all':
      return state
    case 'none':
      return undefined
    case 'omit':
      return omitStateKeys(state, policy.keys)
    case 'pick':
      return pickStateKeys(state, policy.keys)
  }
}

/**
 * The state a page renderer serializes: the page's data under the policy the app configured. The
 * single call both renderers make, so they cannot drift apart on what crosses. `undefined` is the
 * documented "no state" value: the renderer emits no script and the client has no global.
 *
 * @param data - The page's resolved data.
 * @returns The value to put in `DocumentModel.initialState`.
 */
export function resolveInitialState(data: unknown): unknown {
  return applyStatePolicy(data, getInitialStatePolicy())
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function describe(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'an array'
  return typeof value === 'string' ? `'${value}'` : typeof value
}
