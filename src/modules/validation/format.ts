/**
 * Renders diagnostics as text for a build log.
 *
 * Separated from the engine so that how a finding is WORDED is never entangled with whether it is
 * reported — and so a different consumer (an editor, a JSON reporter, a dev-server overlay) can
 * present the same `Diagnostic` values its own way without reimplementing any policy.
 *
 * @module
 */
import type { Diagnostic } from './diagnostic.ts'
import { getRule } from './rules.ts'
import { isNormative } from './diagnostic.ts'

const LABEL: Record<Diagnostic['severity'], string> = {
  error: 'error',
  warning: 'warn ',
  info: 'info ',
}

/** Where a finding is, as a short suffix — route when there is one, else file, else nothing. */
function location(diagnostic: Diagnostic): string {
  if (diagnostic.route !== undefined && diagnostic.file !== undefined) {
    return `  (${diagnostic.file} · route '${diagnostic.route}')`
  }
  if (diagnostic.file !== undefined) return `  (${diagnostic.file})`
  if (diagnostic.route !== undefined) return `  (route '${diagnostic.route}')`
  return ''
}

/**
 * Explains why a finding has the severity it has, when that is not simply the catalog default.
 *
 * Only emitted when something actually changed the outcome. Printing "catalog: warning" on every
 * line would be noise; printing nothing when a project's own configuration turned a warning into a
 * build failure would leave the most surprising case unexplained.
 */
function severityExplanation(diagnostic: Diagnostic): string | undefined {
  const { resolution } = diagnostic
  const parts: string[] = []
  if (resolution.override !== undefined && resolution.override !== true) {
    parts.push(`severity set to '${resolution.override}' by this project`)
  } else if (resolution.override === true) {
    parts.push('enabled by this project')
  }
  if (resolution.strictPromoted) {
    parts.push(`promoted from '${resolution.catalog}' to 'error' by strict mode`)
  }
  return parts.length > 0 ? parts.join('; ') : undefined
}

/** Options for {@linkcode formatDiagnostics}. */
export type FormatOptions = {
  /**
   * Whether to prefix each finding with its severity (`error`/`warn `/`info `). Defaults to `true`.
   *
   * Set `false` when the surrounding presentation already conveys severity some other way — a
   * terminal reporter routing each finding to a coloured logger channel, for instance, where the
   * label would be read twice. This is purely about wording: it never changes which findings exist
   * or how severe they are.
   */
  severityLabel?: boolean
  /** Include the rule's basis and reference on each finding. Off by default — useful when a
   * reader is questioning whether a rule should exist at all, noise otherwise. */
  explain?: boolean
}

/**
 * Formats one diagnostic as a single block of lines.
 *
 * The first line always carries severity, code and message. Everything after it is conditional, so
 * a clean-ish build stays readable and a contested finding can still justify itself.
 */
export function formatDiagnostic(diagnostic: Diagnostic, options: FormatOptions = {}): string {
  const label = options.severityLabel === false ? '' : `${LABEL[diagnostic.severity]}  `
  const lines = [
    `  ${label}${diagnostic.code}  ${diagnostic.message}${location(diagnostic)}`,
  ]

  if (diagnostic.hint !== undefined) lines.push(`         ${diagnostic.hint}`)

  const explanation = severityExplanation(diagnostic)
  if (explanation !== undefined) lines.push(`         severity: ${explanation}`)

  if (options.explain) {
    const rule = getRule(diagnostic.code)
    const authority = isNormative(rule) ? 'required by' : 'based on'
    lines.push(
      `         ${authority} ${rule.basis}${
        rule.reference !== undefined ? ` — ${rule.reference}` : ''
      }`,
    )
  }

  return lines.join('\n')
}

/**
 * Formats a whole run, grouped by severity so the things that matter are read first.
 *
 * @returns The report, or an empty string when there is nothing to say — so a caller can skip
 * printing entirely rather than emitting a header over nothing.
 */
export function formatDiagnostics(
  diagnostics: Diagnostic[],
  options: FormatOptions = {},
): string {
  if (diagnostics.length === 0) return ''
  return diagnostics.map((diagnostic) => formatDiagnostic(diagnostic, options)).join('\n')
}
