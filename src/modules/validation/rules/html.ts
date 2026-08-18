/**
 * HTML — conformance with the HTML Living Standard.
 *
 * One slice of the rule catalog. Split by category so no single file carries the whole policy and
 * so a change to one concern is visibly a change to that concern — see `../rules.ts`, which composes
 * these and is the only thing anything else imports.
 *
 * @module
 */
import type { RuleDefinition } from '../diagnostic.ts'

/** HTML — conformance with the HTML Living Standard. */
export const HTML_RULES: Record<string, RuleDefinition> = {
  DOC001: {
    code: 'DOC001',
    category: 'html',
    // WARNING, not ERROR, as a transition. The underlying requirement is real and unambiguous, but
    // promoting it now would break every app generated before `zanix generate page` started
    // emitting a `static head`. Planned for ERROR in a future major, once page-kind exemptions have
    // been available long enough that "no title" only remains possible on a route that declared
    // itself not to be a document.
    severity: 'warning',
    phase: 'static',
    basis: 'spec',
    reference:
      "HTML Standard §4.2.1 head content model ('exactly one is a title element'); WCAG 2.4.2 Page Titled (A)",
    configurable: true,
    optIn: false,
    summary: 'The document resolves no <title>.',
  },
  DOC002: {
    code: 'DOC002',
    category: 'html',
    severity: 'warning',
    phase: 'render',
    basis: 'spec',
    reference: "HTML Standard §4.2.2 ('There must be no more than one title element per document')",
    configurable: true,
    optIn: false,
    summary: 'The document contains more than one <title>.',
  },
  DOC003: {
    code: 'DOC003',
    category: 'html',
    severity: 'error',
    phase: 'render',
    basis: 'spec',
    reference: 'HTML Standard §3.1.1 documents, §4.1 the html element',
    // Unconditional: a response that is not a document is not a matter of taste.
    configurable: false,
    optIn: false,
    summary: 'The rendered response is not a document (missing doctype, <html> or <body>).',
  },
  DOC004: {
    code: 'DOC004',
    category: 'html',
    severity: 'info',
    phase: 'render',
    basis: 'ecosystem-recommendation',
    // Deliberately non-normative despite HTML having an encoding-declaration requirement: this
    // framework satisfies that requirement at the protocol level on every response
    // (`content-type: text/html; charset=utf-8`). The meta is a secondary declaration for cases a
    // header does not cover, so its absence is informational, never a conformance failure.
    configurable: true,
    optIn: true,
    summary:
      'The document declares no <meta charset> (the response header already declares utf-8).',
  },
}
