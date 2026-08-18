/**
 * The vocabulary every `@zanix/space` document validation speaks — categories, severities, phases,
 * what a rule rests on, and the {@linkcode Diagnostic} shape they combine into.
 *
 * **This is a document validation system, not an SEO checker.** SEO, HTML conformance,
 * accessibility, social metadata and PWA installability are different concerns, answering to
 * different authorities, with different consequences when violated. Folding them into one bucket is
 * how a "best practice" quietly acquires the force of a requirement.
 *
 * Three dimensions are kept strictly independent, because collapsing any two of them is what makes
 * a policy impossible to reason about:
 *
 * - {@linkcode DiagnosticSeverity} — how bad a finding is.
 * - {@linkcode RuleDefinition.optIn} — whether the rule is active by default.
 * - `strict` ({@linkcode ValidationConfig}) — a project-wide enforcement policy.
 *
 * A rule being off by default says nothing about how serious it is when it fires, and a project
 * turning strict on says nothing about which rules are active. An earlier model had a fourth
 * severity, `optional`, that in practice only ever meant "off by default" — a second spelling of
 * `optIn` sitting in the severity axis. It is gone.
 *
 * @module
 */

/**
 * What kind of concern a rule belongs to. A shared engine, distinct authorities.
 *
 * - `html` — conformance with the HTML Living Standard.
 * - `seo` — how search engines discover, index and present the page. Very little here is a
 *   *requirement*; see {@linkcode RuleBasis}.
 * - `a11y` — accessibility.
 * - `social` — link-preview metadata (Open Graph, X Cards). Explicitly NOT SEO: no search engine
 *   ranks on any of it.
 * - `pwa` — Web App Manifest and service worker. Validates installation artifacts, not the document.
 * - `framework` — invariants `@zanix/space` itself imposes.
 */
export type DiagnosticCategory = 'html' | 'seo' | 'a11y' | 'social' | 'pwa' | 'framework'

/**
 * How much a finding is worth. Three values, deliberately — anything a project wants switched off
 * belongs to `optIn`/`rules`, never to a fourth severity.
 *
 * `error` is reserved, narrowly. A rule qualifies only when all four hold: detected
 * deterministically, represents an invalid document or an unambiguous contradiction, false
 * positives near-impossible, and a clear answer to "why should this block the build".
 */
export type DiagnosticSeverity = 'info' | 'warning' | 'error'

/**
 * When a rule can be evaluated at all — the boundary that keeps this system honest about what it
 * can and cannot know.
 *
 * - `static` — decidable from modules, layouts, routes and configuration. No rendering.
 * - `render` — needs real HTML, so real data. Only viable for routes with no dynamic segments.
 * - `runtime` — only knowable against a live deployment. Catalogued in `UNAUTOMATABLE`, never run.
 * - `human` — inherently a judgement call. Same treatment.
 */
export type DiagnosticPhase = 'static' | 'render' | 'runtime' | 'human'

/**
 * What a rule actually rests on. **The single source of truth for a rule's authority** — whether it
 * is normative is DERIVED from this (see {@linkcode isNormative}), never stored separately.
 *
 * Keeping this as one classified field rather than a `normative` boolean plus prose is what stops
 * the two from disagreeing, and it forces the distinction the whole catalog depends on: a
 * documented recommendation from a search engine is not a norm, however authoritative its source.
 *
 * Normative bases — a violation means the artifact fails an external standard:
 * - `spec` — a mandatory requirement of the HTML Living Standard or another protocol spec.
 * - `accessibility` — a WCAG success criterion, or a W3C ACT rule mapped to one.
 * - `installability` — a documented, testable criterion for a PWA being installable.
 *
 * Non-normative bases — a violation means something is inadvisable, not invalid:
 * - `search-engine-recommendation` — documented guidance from a search engine. Verifiable and worth
 *   citing, but guidance.
 * - `ecosystem-recommendation` — widely-held practice with a real rationale and no single authority.
 * - `framework-invariant` — a rule `@zanix/space` imposes on its own output.
 * - `project-convention` — a convention this framework's scaffolding follows, which a project is
 *   free not to.
 * - `heuristic` — a signal with no primary source at all.
 */
export type RuleBasis =
  | 'spec'
  | 'accessibility'
  | 'installability'
  | 'search-engine-recommendation'
  | 'ecosystem-recommendation'
  | 'framework-invariant'
  | 'project-convention'
  | 'heuristic'

/** The bases that make a rule normative. */
const NORMATIVE_BASES: ReadonlySet<RuleBasis> = new Set<RuleBasis>([
  'spec',
  'accessibility',
  'installability',
])

/**
 * Whether a rule rests on an external standard. Derived from {@linkcode RuleDefinition.basis} — a
 * rule never declares this itself, so there is nothing to fall out of sync.
 */
export function isNormative(rule: Pick<RuleDefinition, 'basis'>): boolean {
  return NORMATIVE_BASES.has(rule.basis)
}

/**
 * How a finding's effective severity was arrived at.
 *
 * Carried so that "why is this an error?" is always answerable. The CLI need not print all of it by
 * default, but the model must never make the question impossible to answer.
 */
export type SeverityResolution = {
  /** The rule's own severity, from the catalog. */
  catalog: DiagnosticSeverity
  /** What the project's `rules` map said, if anything. `true` means "activate at catalog severity". */
  override?: DiagnosticSeverity | true
  /** Whether `strict` promoted a warning to an error. */
  strictPromoted: boolean
  /** What actually applies. */
  effective: DiagnosticSeverity
}

/** One finding. */
export type Diagnostic = {
  /** The rule's stable identifier, e.g. `'DOC001'`. */
  code: string
  category: DiagnosticCategory
  /** The severity that applies to THIS finding — the same value as `resolution.effective`, hoisted
   * because it is what almost every consumer wants. */
  severity: DiagnosticSeverity
  /** How `severity` was arrived at. See {@linkcode SeverityResolution}. */
  resolution: SeverityResolution
  phase: DiagnosticPhase
  /** What this rule rests on, copied from the catalog so a reported finding can justify itself
   * without a second lookup. */
  basis: RuleBasis
  /** What is wrong, in one sentence, about this specific occurrence. */
  message: string
  /** The file this is about, when there is one. */
  file?: string
  /** The route this is about, when the finding is route-scoped rather than file-scoped. */
  route?: string
  /** What to do about it. Omitted when the message is already the whole answer. */
  hint?: string
}

/** A rule's fixed metadata — everything true about the rule itself, independent of any finding. */
export type RuleDefinition = {
  code: string
  category: DiagnosticCategory
  /** The severity applied unless the project overrides it or `strict` promotes it. */
  severity: DiagnosticSeverity
  phase: DiagnosticPhase
  /** What this rule rests on. See {@linkcode RuleBasis}; `normative` is derived from it. */
  basis: RuleBasis
  /**
   * Where the claim comes from. **Required for a normative basis** — a rule that can fail a build
   * on standards grounds must always be able to answer "says who". Allowed, and encouraged, for a
   * recommendation basis too, where it is context rather than authority.
   */
  reference?: string
  /** Whether a project may change this rule's severity or switch it off. `false` for rules whose
   * whole point is being unconditional. */
  configurable: boolean
  /**
   * Whether the rule is OFF by default. Purely an activation question — it says nothing about how
   * serious the rule is, and a project turns it on through `rules` without having to restate a
   * severity (`rules: { X: true }`).
   */
  optIn: boolean
  /** One-line statement of what the rule checks. */
  summary: string
}
