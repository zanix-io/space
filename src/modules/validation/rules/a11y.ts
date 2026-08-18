/**
 * Accessibility — WCAG success criteria and W3C ACT rules.
 *
 * One slice of the rule catalog. Split by category so no single file carries the whole policy and
 * so a change to one concern is visibly a change to that concern — see `../rules.ts`, which composes
 * these and is the only thing anything else imports.
 *
 * @module
 */
import type { RuleDefinition } from '../diagnostic.ts'

/** Accessibility — WCAG success criteria and W3C ACT rules. */
export const A11Y_RULES: Record<string, RuleDefinition> = {
  A11Y001: {
    code: 'A11Y001',
    category: 'a11y',
    severity: 'warning',
    phase: 'render',
    basis: 'accessibility',
    reference: 'WCAG 3.1.1 Language of Page (A)',
    configurable: true,
    optIn: false,
    summary: '<html> has no lang attribute.',
  },
  A11Y002: {
    code: 'A11Y002',
    category: 'a11y',
    // The only ERROR in this catalog backed by an external norm with exact, published thresholds.
    // Detecting a literal attribute value admits no ambiguity and no false positive, and there is
    // no legitimate case for it on a content page.
    severity: 'error',
    phase: 'render',
    basis: 'accessibility',
    reference: 'WCAG 1.4.4 Resize Text (AA) via ACT rule b4f0c3 (required for conformance)',
    configurable: false,
    optIn: false,
    summary: 'The viewport prevents zoom (user-scalable=no, or maximum-scale below 2).',
  },
  A11Y003: {
    code: 'A11Y003',
    category: 'a11y',
    severity: 'warning',
    phase: 'render',
    basis: 'search-engine-recommendation',
    configurable: true,
    optIn: false,
    summary: 'The document declares no viewport meta.',
  },
  A11Y004: {
    code: 'A11Y004',
    category: 'a11y',
    severity: 'warning',
    phase: 'render',
    basis: 'accessibility',
    // NOT an HTML conformance rule. The Standard says the absence of `alt` asserts that the image is
    // key content with no textual equivalent available — a conforming statement. The requirement is
    // WCAG's.
    reference: 'WCAG 1.1.1 Non-text Content (A)',
    configurable: true,
    optIn: false,
    summary:
      'An <img> has no alt attribute (alt="" is valid for decorative images and never flagged).',
  },
  A11Y005: {
    code: 'A11Y005',
    category: 'a11y',
    severity: 'warning',
    phase: 'render',
    basis: 'accessibility',
    reference: 'WCAG 2.4.4 Link Purpose in Context (A); failure technique F89',
    configurable: true,
    optIn: false,
    summary: 'A link has no accessible name.',
  },
  A11Y006: {
    code: 'A11Y006',
    category: 'a11y',
    severity: 'warning',
    phase: 'render',
    // The important flag in this whole file. Not an HTML requirement, not a WCAG success criterion,
    // and Google Search Central documents no requirement about heading counts. Reported because zero
    // <h1> is a reliable signal of an incomplete template — a framework judgement, nothing more. It
    // never affects whether a document is valid, and it reaches `error` only through explicit strict
    // mode.
    basis: 'project-convention',
    configurable: true,
    optIn: false,
    summary: 'The document contains no <h1>. Not a requirement of HTML, WCAG or Google Search.',
  },
  A11Y007: {
    code: 'A11Y007',
    category: 'a11y',
    severity: 'info',
    phase: 'render',
    basis: 'ecosystem-recommendation',
    // G141 ('Organizing a page using headings') is an ADVISORY technique, not a sufficient one, and
    // skipping levels is not a documented failure of 1.3.1. Google states outright that heading
    // order does not matter to Search. Genuine good practice; nothing more.
    configurable: true,
    optIn: true,
    summary: 'A heading skips a level (e.g. h1 followed by h3).',
  },
  A11Y008: {
    code: 'A11Y008',
    category: 'a11y',
    severity: 'info',
    phase: 'render',
    basis: 'ecosystem-recommendation',
    // The 'one h1 per page' rule came from HTML5's outline algorithm, which no browser ever
    // implemented and which was removed from the standard.
    configurable: true,
    optIn: true,
    summary: 'The document contains more than one <h1>. Valid HTML; informational only.',
  },
}
