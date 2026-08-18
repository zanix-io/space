import type { ValidationConfig } from './engine.ts'

/**
 * Where `defineSpaceApp({ validation })` puts a project's validation configuration, and where the
 * build reads it back.
 *
 * The same eager-registry pattern `globalCss`/`assetsDir`/`renderer` already use, for the same
 * reason: `zanix space build` imports the app's `space.app.ts` to learn what it declared, and never
 * calls `activateApps()`. A value only readable from inside `setup()` would be invisible to it.
 *
 * @module
 */

let validationConfig: ValidationConfig | false | undefined

/**
 * Set once by `defineSpaceApp({ validation })`. `false` disables document validation for this
 * project entirely.
 */
export function setValidationConfig(config: ValidationConfig | false | undefined): void {
  validationConfig = config
}

/** Read by the build. `undefined` when the app never configured validation, which means "run with
 * the framework's own defaults" — a different thing from `false`, which means "do not run". */
export function getValidationConfig(): ValidationConfig | false | undefined {
  return validationConfig
}

/** Test-only reset. */
export function resetValidationConfig(): void {
  validationConfig = undefined
}
