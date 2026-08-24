/**
 * The rule catalog — every document validation `@zanix/space` performs, as data.
 *
 * The catalog is data, not logic spread through the code that happens to detect things. Policy that
 * lives inline drifts: a check gets tightened during an unrelated fix, a warning quietly becomes an
 * error, and nobody notices that a recommendation has acquired the force of a requirement. Here
 * every severity, category and basis is visible next to its justification.
 *
 * **Split by category** across `rules/`, and composed here. Each slice stays small enough to read in
 * one sitting, and a change to one concern is visibly a change to that concern. This module is the
 * only thing anything else imports — no consumer reaches for a slice directly.
 *
 * Two properties the catalog is careful about:
 *
 * 1. **`basis` is the single source of truth for normativity** — `isNormative` derives it, and no
 *    rule declares it separately. Several rules that feel like requirements are not: `<h1>` presence
 *    is not required by the HTML Standard, is not a WCAG success criterion, and Google Search
 *    documents no requirement about heading counts. It is a project convention, marked as one.
 * 2. **`error` is rare and justified.** Five rules qualify, and only three rest on an external
 *    standard. The other two are framework invariants, and they say so.
 *
 * @module
 */
import type { RuleDefinition } from './diagnostic.ts'
import { InternalError } from '@zanix/errors'
import { HTML_RULES } from './rules/html.ts'
import { A11Y_RULES } from './rules/a11y.ts'
import { SEO_RULES } from './rules/seo.ts'
import { FRAMEWORK_RULES } from './rules/framework.ts'
import { PWA_RULES } from './rules/pwa.ts'
import { SOCIAL_RULES } from './rules/social.ts'

/** Every rule, keyed by code. */
export const RULES: Record<string, RuleDefinition> = {
  ...HTML_RULES,
  ...A11Y_RULES,
  ...SEO_RULES,
  ...FRAMEWORK_RULES,
  ...PWA_RULES,
  ...SOCIAL_RULES,
}

/**
 * Rules that exist to mark a boundary rather than to run — catalogued so the limits of build-time
 * validation are explicit rather than implied by silence.
 *
 * Nothing here is ever evaluated. `runtime` rules need a live deployment (does the canonical URL
 * actually resolve? does that `og:image` exist, at what dimensions?); `human` rules need judgement
 * (is this `<h1>` *descriptive*? is this content thin?). Both are real concerns and neither can be
 * answered by a build, so they are named here instead of being approximated by something that
 * would produce confident wrong answers.
 */
export const UNAUTOMATABLE: ReadonlyArray<{ concern: string; phase: 'runtime' | 'human' }> = [
  { concern: 'The canonical URL resolves to the intended page in production', phase: 'runtime' },
  { concern: 'og:image exists, is reachable, and has usable dimensions', phase: 'runtime' },
  { concern: 'hreflang reciprocity across domains', phase: 'runtime' },
  { concern: 'Titles and descriptions are unique across dynamic routes', phase: 'runtime' },
  {
    concern: 'A route returns a real 404 rather than a soft 404 for missing data',
    phase: 'runtime',
  },
  { concern: 'Headings and labels are descriptive (WCAG 2.4.6)', phase: 'human' },
  { concern: 'Alt text actually describes its image', phase: 'human' },
  { concern: 'Link text conveys its destination in context', phase: 'human' },
  { concern: 'Content is substantive rather than thin or duplicated', phase: 'human' },
]

/** Looks a rule up by code. Throws for an unknown code — a typo in a rule reference should fail
 * loudly at the point of use, never silently produce a diagnostic with no metadata.
 *
 * @throws {InternalError} If `code` names no catalogued rule. */
export function getRule(code: string): RuleDefinition {
  const rule = RULES[code]
  if (!rule) {
    throw new InternalError(`Unknown validation rule code: ${code}`, {
      code: 'SPACE_VALIDATION_UNKNOWN_RULE_CODE',
      meta: { ruleCode: code },
    })
  }
  return rule
}
