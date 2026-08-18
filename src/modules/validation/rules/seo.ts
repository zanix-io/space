/**
 * SEO — search discovery and presentation. Very little here is a requirement; `basis` says which.
 *
 * One slice of the rule catalog. Split by category so no single file carries the whole policy and
 * so a change to one concern is visibly a change to that concern — see `../rules.ts`, which composes
 * these and is the only thing anything else imports.
 *
 * @module
 */
import type { RuleDefinition } from '../diagnostic.ts'

/** SEO — search discovery and presentation. Very little here is a requirement; `basis` says which. */
export const SEO_RULES: Record<string, RuleDefinition> = {
  SEO001: {
    code: 'SEO001',
    category: 'seo',
    severity: 'warning',
    phase: 'static',
    basis: 'search-engine-recommendation',
    // Not a ranking factor. Google uses it for the snippet only when it describes the page better
    // than the page's own content, and may ignore it entirely.
    configurable: true,
    optIn: false,
    summary: 'The page declares no meta description.',
  },
  SEO002: {
    code: 'SEO002',
    category: 'seo',
    // `warning` when a project activates it — the severity it always meant. It reads as absent by
    // default because it is `optIn`, which is now the ONLY thing expressing that.
    severity: 'warning',
    phase: 'static',
    basis: 'search-engine-recommendation',
    // Off by default, by project policy. Google describes rel=canonical as 'a strong signal', not a
    // directive, and documents no requirement that every page declare one.
    configurable: true,
    optIn: true,
    summary: 'The page declares no self-referencing canonical.',
  },
  SEO003: {
    code: 'SEO003',
    category: 'seo',
    severity: 'warning',
    phase: 'static',
    basis: 'search-engine-recommendation',
    // Not an error: Google IGNORES unrecognized robots values, so the failure mode is 'the directive
    // silently does not apply', not 'invalid document'.
    configurable: true,
    optIn: false,
    summary: 'A meta robots directive uses a token no documented crawler recognizes.',
  },
  SEO004: {
    code: 'SEO004',
    category: 'seo',
    severity: 'warning',
    phase: 'static',
    basis: 'ecosystem-recommendation',
    configurable: true,
    optIn: false,
    summary: 'A route declaring noindex also appears in the sitemap.',
  },
  SEO005: {
    code: 'SEO005',
    category: 'seo',
    severity: 'warning',
    phase: 'static',
    basis: 'search-engine-recommendation',
    // Context, NOT authority. Google RECOMMENDS absolute canonical URLs; it does not require them,
    // and a relative one still resolves. Carrying this as `normative` during development conflated
    // a documented recommendation with a standard — the precise conflation this catalog exists to
    // prevent.
    reference:
      'Google Search Central: \'Use absolute paths rather than relative paths with the rel="canonical" link element\'',
    configurable: true,
    optIn: false,
    summary: 'A canonical link uses a relative URL.',
  },
  SEO006: {
    code: 'SEO006',
    category: 'seo',
    severity: 'warning',
    phase: 'static',
    basis: 'ecosystem-recommendation',
    configurable: true,
    optIn: false,
    summary: 'A sitemap entry has no corresponding route.',
  },
  SEO007: {
    code: 'SEO007',
    category: 'seo',
    severity: 'info',
    phase: 'static',
    basis: 'heuristic',
    // Off by default and labelled a heuristic, because it is one. Google states there is no limit on
    // meta description length; the familiar 60/160 figures are industry convention with no primary
    // source behind them.
    configurable: true,
    optIn: true,
    summary:
      'A title or description falls outside the configured length range (heuristic, no primary source).',
  },
  SEO008: {
    code: 'SEO008',
    category: 'seo',
    severity: 'warning',
    phase: 'render',
    basis: 'framework-invariant',
    configurable: true,
    optIn: false,
    summary: 'The rendered document contains no indexable text content.',
  },
}
