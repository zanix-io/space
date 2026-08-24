/**
 * Validation module — build-time checking of the documents this framework produces.
 *
 * Two phases, and the split between them is the point (see `validate-document.ts` and
 * `validate-html.ts` for each one's own reasoning):
 *
 * - **static** — decidable from modules, layouts, routes and configuration. Runs on every build.
 * - **render** — needs real HTML, so real data, so it only covers routes with no dynamic segments.
 *   Opt-in.
 *
 * A third and fourth phase are catalogued but never executed: `runtime` (needs a live deployment)
 * and `human` (needs judgement). They appear in `UNAUTOMATABLE` so the limits of this system are
 * stated rather than left to be discovered.
 *
 * Renderer-agnostic throughout. Render-phase rules read `DocumentSemantics`, never HTML produced by
 * a particular serializer, so one rule holds for React and Preact alike. The active renderer is
 * read where needed and never derived — see this package's own renderer contract.
 *
 * @module
 */
export type {
  Diagnostic,
  DiagnosticCategory,
  DiagnosticPhase,
  DiagnosticSeverity,
  RuleBasis,
  RuleDefinition,
  SeverityResolution,
} from './diagnostic.ts'
export { isNormative } from './diagnostic.ts'
export { getRule, RULES, UNAUTOMATABLE } from './rules.ts'
export {
  DiagnosticCollector,
  hasBlockingDiagnostics,
  isExemptFromDocumentRules,
  resolveSeverity,
  sortDiagnostics,
  summarize,
} from './engine.ts'
export type { ValidationConfig } from './engine.ts'
export { validateDocuments } from './validate-document.ts'
export type { StaticAppInput, StaticPageInput } from './validate-document.ts'
export {
  validateRenderedDocument,
  validateRenderedDocuments,
  viewportBlocksZoom,
} from './validate-html.ts'
export type { RenderedPageInput } from './validate-html.ts'
export type { DocumentSemantics } from '../render/document-model.ts'
export type { ResolvedHead } from '../router/head-descriptor.ts'
export { formatDiagnostic, formatDiagnostics } from './format.ts'
export type { FormatOptions } from './format.ts'
export {
  getValidationConfig,
  resetValidationConfig,
  setValidationConfig,
} from './config-registry.ts'
export { mergeValidationConfig, resolveValidationFlags } from './cli-options.ts'
export type { ResolvedValidationFlags, ValidationFlags, ValidationPhases } from './cli-options.ts'
