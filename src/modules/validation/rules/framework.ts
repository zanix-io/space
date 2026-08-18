/**
 * Framework invariants — @zanix/space's own rules, resting on no external standard.
 *
 * One slice of the rule catalog. Split by category so no single file carries the whole policy and
 * so a change to one concern is visibly a change to that concern — see `../rules.ts`, which composes
 * these and is the only thing anything else imports.
 *
 * @module
 */
import type { RuleDefinition } from '../diagnostic.ts'

/** Framework invariants — @zanix/space's own rules, resting on no external standard. */
export const FRAMEWORK_RULES: Record<string, RuleDefinition> = {
  FW001: {
    code: 'FW001',
    category: 'framework',
    severity: 'error',
    phase: 'static',
    basis: 'framework-invariant',
    // ERROR on framework grounds ONLY, and the distinction is deliberate: the HTML Standard does not
    // forbid a second canonical, and Google documents no behavior for conflicting ones. What makes
    // it unconditional here is narrower and fully within this package's control — a canonical URL is
    // a per-URL fact while a layout is shared, so two different canonical hrefs in one document is a
    // contradiction in output this framework itself produced, with no reading under which it is
    // correct.
    configurable: false,
    optIn: false,
    summary: 'Head resolution produced more than one canonical with differing hrefs.',
  },
  FW002: {
    code: 'FW002',
    category: 'framework',
    severity: 'warning',
    phase: 'static',
    basis: 'framework-invariant',
    configurable: true,
    optIn: false,
    summary:
      'A layout declares a canonical link — a per-URL fact in a component shared across routes.',
  },
  FW003: {
    code: 'FW003',
    category: 'framework',
    severity: 'error',
    phase: 'render',
    basis: 'framework-invariant',
    configurable: false,
    optIn: false,
    summary:
      "The rendered document is missing the resolved head — the renderer's document assembly is broken.",
  },
  // FW004 IS DELIBERATELY ABSENT, and this ID stays reserved rather than reused.
  //
  // It was going to report `createNotFoundHandler` being wired in a Preact app, back when that
  // function was React-only and threw at the first real 404. PR1 removed the condition instead of
  // validating around it: the not-found path builds a `DocumentModel` and dispatches through
  // `not-found-renderer-registry.ts`, so both renderers serve a real 404 document and there is no
  // longer a misconfiguration to detect.
  //
  // Do not renumber the rules below to close the gap, and do not reintroduce FW004 to restore the
  // original matrix's cardinality — a rule must exist because a real condition needs reporting,
  // never to make a count come out round.
  FW005: {
    code: 'FW005',
    category: 'framework',
    severity: 'warning',
    phase: 'static',
    basis: 'framework-invariant',
    configurable: true,
    optIn: false,
    summary: 'A root layout hardcodes lang while the app serves [lang] routes.',
  },
  FW006: {
    code: 'FW006',
    category: 'framework',
    severity: 'warning',
    phase: 'static',
    basis: 'heuristic',
    // Explicitly NOT a substitute for DOC003, and never an error: this inspects a layout's SOURCE,
    // and a layout may legitimately delegate document construction to another component. DOC003
    // decides validity, and it does so against the final rendered document.
    configurable: true,
    optIn: false,
    summary:
      "A root layout's source contains no <html>/<body> (heuristic; DOC003 decides validity).",
  },
}
