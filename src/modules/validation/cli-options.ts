/**
 * Maps CLI flags onto a {@linkcode ValidationConfig}.
 *
 * A pure translation and nothing else. Every decision a flag expresses already has a home in the
 * config model, so this file contains no policy of its own: it never decides a severity, never
 * filters a rule, never knows a rule code. If a flag needed behaviour the config cannot express,
 * that would be a gap in the config, not something to paper over here.
 *
 * The same mapping serves `zanix space build` and `zanix space dev`, deliberately. Two commands
 * interpreting the same flag differently is exactly the kind of implicit semantics that makes a
 * validator untrustworthy — the only difference between them is which PHASES they run, which is the
 * commands' own business and not encoded in these flags beyond `--validation=render`.
 *
 * @module
 */
import type { DiagnosticCategory } from './diagnostic.ts'
import type { ValidationConfig } from './engine.ts'

/** The flags, as a command parser hands them over. */
export type ValidationFlags = {
  /**
   * `--validation` / `--validation=<mode>`.
   *
   * - absent or `true` — run the static phase (the default).
   * - `'render'` — additionally run the render probe.
   * - `'static'` — the default, stated explicitly.
   */
  validation?: boolean | string
  /** `--no-validation`. Wins over everything: nothing runs. */
  noValidation?: boolean
  /** `--validation-strict`. */
  validationStrict?: boolean
  /** `--validation-category=html,a11y`. */
  validationCategory?: string
}

/** Which phases a run should execute. */
export type ValidationPhases = {
  static: boolean
  render: boolean
}

/** What {@linkcode resolveValidationFlags} produces. */
export type ResolvedValidationFlags = {
  /** `false` when validation is off entirely — no engine call, no phases. */
  enabled: boolean
  phases: ValidationPhases
  /** Merged onto the project's own config by the caller; see {@linkcode mergeValidationConfig}. */
  config: ValidationConfig
}

const VALID_CATEGORIES: ReadonlySet<string> = new Set<DiagnosticCategory>([
  'html',
  'seo',
  'a11y',
  'social',
  'pwa',
  'framework',
])

/**
 * Translates flags into phases plus config.
 *
 * **Precedence, and it is the same in every command:**
 *
 * 1. `--no-validation` wins outright. Nothing else is read, because "do not run" has no useful
 *    interaction with "run strictly" or "run only these categories".
 * 2. `--validation=render` adds the render phase to the static one. It never REPLACES it: the render
 *    phase covers a subset of routes (no dynamic segments) and a subset of rules, so treating it as
 *    an alternative would silently reduce coverage while reading like an increase.
 * 3. `--validation-strict` and `--validation-category` shape the run. Both are meaningless with
 *    validation off, which case 1 already handled.
 *
 * @throws {Error} If `--validation` names an unknown mode, or `--validation-category` names an
 * unknown category. Both fail loudly rather than being ignored: a typo'd category that silently
 * matched nothing would report a clean run over an empty rule set.
 */
export function resolveValidationFlags(flags: ValidationFlags): ResolvedValidationFlags {
  if (flags.noValidation === true) {
    return { enabled: false, phases: { static: false, render: false }, config: {} }
  }

  let render = false
  if (typeof flags.validation === 'string') {
    if (flags.validation === 'render') render = true
    else if (flags.validation !== 'static') {
      throw new Error(
        `Unknown --validation mode '${flags.validation}'. Valid modes: 'static' (default), 'render'.`,
      )
    }
  }

  const config: ValidationConfig = {}
  if (flags.validationStrict === true) config.strict = true

  if (flags.validationCategory !== undefined) {
    const categories = flags.validationCategory
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
    const unknown = categories.filter((entry) => !VALID_CATEGORIES.has(entry))
    if (unknown.length > 0) {
      throw new Error(
        `Unknown --validation-category value(s): ${unknown.join(', ')}. Valid categories: ${
          [...VALID_CATEGORIES].join(', ')
        }.`,
      )
    }
    config.categories = categories as DiagnosticCategory[]
  }

  return { enabled: true, phases: { static: true, render }, config }
}

/**
 * Combines a project's own `defineSpaceApp({ validation })` with what the command line asked for.
 *
 * **The command line wins, field by field.** A flag is a deliberate act at the moment of running,
 * and a project's stored policy is a default — so `--validation-strict` turns strict on for a
 * project that never asked for it, and `--validation-category` narrows a run without editing the
 * app. Fields the flags say nothing about are left exactly as the project declared them, so `rules`
 * and `exempt` survive untouched: there is deliberately no flag for either, because per-rule
 * severity and route exemptions are policy that belongs in the project, versioned with it, rather
 * than retyped on a command line.
 *
 * @param projectConfig - `false` means the project disabled validation, and nothing overrides that:
 * a project that has opted out is not opted back in by a flag that merely shapes a run.
 */
export function mergeValidationConfig(
  projectConfig: ValidationConfig | false | undefined,
  flagConfig: ValidationConfig,
): ValidationConfig | false {
  if (projectConfig === false) return false
  return {
    ...projectConfig,
    ...(flagConfig.strict !== undefined ? { strict: flagConfig.strict } : {}),
    ...(flagConfig.categories !== undefined ? { categories: flagConfig.categories } : {}),
  }
}
