import { assert, assertEquals, assertThrows } from '@std/assert'
import { getRule, RULES, UNAUTOMATABLE } from 'modules/validation/rules.ts'
import { isNormative } from 'modules/validation/diagnostic.ts'
import type {
  DiagnosticCategory,
  DiagnosticPhase,
  DiagnosticSeverity,
  RuleBasis,
} from 'modules/validation/diagnostic.ts'

// ================================================================================================
// STRUCTURAL INVARIANTS OF THE CATALOG.
//
// Every number the catalog is expected to satisfy lives in ONE place, below. Spreading counts
// across several tests is how a catalog and its tests drift apart: a rule gets added, one test is
// updated, another keeps asserting a stale figure and still passes because it was checking a
// different slice. One frozen expectation, referenced everywhere.
// ================================================================================================

/** The catalog's expected shape. Changing the catalog means changing exactly this block. */
const EXPECTED = {
  totalRules: 31,
  errorRules: ['A11Y002', 'DOC003', 'FW001', 'FW003', 'PWA001'],
  /** Errors resting on an external standard. The remainder are framework invariants. */
  normativeErrorRules: ['A11Y002', 'DOC003', 'PWA001'],
  /** Rules that cannot be reconfigured. Identical to `errorRules` today, and that is a
   * consequence, not a definition — an unconditional rule need not be an error in principle. */
  nonConfigurableRules: ['A11Y002', 'DOC003', 'FW001', 'FW003', 'PWA001'],
  categories: ['html', 'seo', 'a11y', 'social', 'pwa', 'framework'] as DiagnosticCategory[],
  severities: ['info', 'warning', 'error'] as DiagnosticSeverity[],
  executedPhases: ['static', 'render'] as DiagnosticPhase[],
  bases: [
    'spec',
    'accessibility',
    'installability',
    'search-engine-recommendation',
    'ecosystem-recommendation',
    'framework-invariant',
    'project-convention',
    'heuristic',
  ] as RuleBasis[],
  /** Bases that make a rule normative. */
  normativeBases: ['spec', 'accessibility', 'installability'] as RuleBasis[],
  categoryPrefix: {
    html: 'DOC',
    a11y: 'A11Y',
    seo: 'SEO',
    framework: 'FW',
    pwa: 'PWA',
    social: 'SOC',
  } as Record<DiagnosticCategory, string>,
} as const

const ALL = Object.values(RULES)
const codesWhere = (predicate: (rule: typeof ALL[number]) => boolean) =>
  ALL.filter(predicate).map((rule) => rule.code).sort()

// --- identity ------------------------------------------------------------------------------------

Deno.test('catalog: the map key and the rule code always agree', () => {
  for (const [key, rule] of Object.entries(RULES)) assertEquals(key, rule.code)
})

Deno.test('catalog: rule IDs are unique', () => {
  const codes = ALL.map((rule) => rule.code)
  assertEquals(new Set(codes).size, codes.length)
})

Deno.test('catalog: holds exactly the expected number of rules', () => {
  assertEquals(ALL.length, EXPECTED.totalRules)
})

Deno.test('catalog: every code uses the prefix its category requires', () => {
  for (const rule of ALL) {
    assert(
      rule.code.startsWith(EXPECTED.categoryPrefix[rule.category]),
      `${rule.code} is category '${rule.category}' but lacks prefix '${
        EXPECTED.categoryPrefix[rule.category]
      }'`,
    )
  }
})

// --- enumerations --------------------------------------------------------------------------------

Deno.test(
  'catalog: every category, severity, phase and basis is a valid member of its type',
  () => {
    for (const rule of ALL) {
      assert(EXPECTED.categories.includes(rule.category), `${rule.code}: category`)
      assert(EXPECTED.severities.includes(rule.severity), `${rule.code}: severity`)
      assert(EXPECTED.bases.includes(rule.basis), `${rule.code}: basis`)
      assert(
        EXPECTED.executedPhases.includes(rule.phase),
        `${rule.code} declares phase '${rule.phase}', which this system never executes`,
      )
    }
  },
)

Deno.test(
  "catalog: 'optional' is gone from the severity axis entirely — it only ever meant 'off by " +
    "default', which is what optIn expresses, and two spellings of one idea is a duplicated source " +
    'of truth',
  () => {
    for (const rule of ALL) {
      assert(
        (rule.severity as string) !== 'optional',
        `${rule.code} still uses the removed 'optional' severity`,
      )
    }
  },
)

Deno.test(
  'catalog: runtime and human concerns live in UNAUTOMATABLE, never in the rule table — a rule ' +
    'that cannot run has no business claiming it can',
  () => {
    assert(UNAUTOMATABLE.length > 0)
    for (const entry of UNAUTOMATABLE) {
      assert(entry.phase === 'runtime' || entry.phase === 'human', entry.concern)
    }
  },
)

// --- normativity ---------------------------------------------------------------------------------

Deno.test('catalog: normativity is derived from basis and nothing else', () => {
  for (const rule of ALL) {
    assertEquals(
      isNormative(rule),
      (EXPECTED.normativeBases as readonly RuleBasis[]).includes(rule.basis),
      rule.code,
    )
  }
})

Deno.test(
  'catalog: a normative rule ALWAYS cites a reference — a rule that can fail a build on standards ' +
    'grounds must be able to answer "says who"',
  () => {
    for (const rule of ALL) {
      if (!isNormative(rule)) continue
      assert(
        rule.reference !== undefined && rule.reference.trim().length > 0,
        `${rule.code} is normative (basis '${rule.basis}') but cites no reference`,
      )
    }
  },
)

Deno.test(
  'catalog: a recommendation may cite its source too, and doing so never makes it normative — ' +
    'this is the distinction the whole catalog rests on',
  () => {
    const citedRecommendations = ALL.filter((rule) => !isNormative(rule) && rule.reference)
    // Real examples, not a hypothetical: both were demoted from normative during review.
    assertEquals(
      citedRecommendations.map((rule) => rule.code).sort(),
      ['SEO005', 'SOC001'],
    )
    for (const rule of citedRecommendations) assertEquals(isNormative(rule), false, rule.code)
  },
)

Deno.test(
  'catalog: no Google or ecosystem recommendation is classified as a standard — a documented ' +
    'recommendation is not a norm, however authoritative its source',
  () => {
    for (const rule of ALL) {
      if (
        rule.basis === 'search-engine-recommendation' ||
        rule.basis === 'ecosystem-recommendation' ||
        rule.basis === 'framework-invariant' ||
        rule.basis === 'project-convention' ||
        rule.basis === 'heuristic'
      ) {
        assertEquals(isNormative(rule), false, rule.code)
      }
    }
  },
)

// --- errors --------------------------------------------------------------------------------------

Deno.test('catalog: exactly the expected rules are errors', () => {
  assertEquals(codesWhere((rule) => rule.severity === 'error'), [...EXPECTED.errorRules].sort())
})

Deno.test('catalog: exactly the expected errors rest on an external standard', () => {
  assertEquals(
    codesWhere((rule) => rule.severity === 'error' && isNormative(rule)),
    [...EXPECTED.normativeErrorRules].sort(),
  )
})

Deno.test(
  'catalog: every other error is a framework invariant and says so — an error must never look ' +
    'like it has standards backing when it does not',
  () => {
    const frameworkErrors = ALL.filter((rule) => rule.severity === 'error' && !isNormative(rule))
    for (const rule of frameworkErrors) assertEquals(rule.basis, 'framework-invariant', rule.code)
    assertEquals(
      frameworkErrors.map((rule) => rule.code).sort(),
      EXPECTED.errorRules
        .filter((code) => !(EXPECTED.normativeErrorRules as readonly string[]).includes(code))
        .sort(),
    )
  },
)

// --- independence of the three dimensions ---------------------------------------------------------

Deno.test(
  'catalog: optIn has NO relationship to severity — an opt-in rule may be any severity, and a ' +
    'default-on rule may be any severity. Collapsing the two is what the removed `optional` did',
  () => {
    const optInSeverities = new Set(ALL.filter((r) => r.optIn).map((r) => r.severity))
    const defaultOnSeverities = new Set(ALL.filter((r) => !r.optIn).map((r) => r.severity))
    // Both groups span more than one severity, so neither flag can be predicted from the other.
    assert(optInSeverities.size > 1, 'opt-in rules should not all share one severity')
    assert(defaultOnSeverities.size > 1, 'default-on rules should not all share one severity')
  },
)

Deno.test(
  'catalog: a non-configurable rule is never opt-in — that combination is an impossible state, a ' +
    'rule off by default that no project is allowed to switch on',
  () => {
    for (const rule of ALL) {
      if (!rule.configurable) assertEquals(rule.optIn, false, rule.code)
    }
  },
)

Deno.test('catalog: exactly the expected rules are non-configurable', () => {
  assertEquals(
    codesWhere((rule) => !rule.configurable),
    [...EXPECTED.nonConfigurableRules].sort(),
  )
})

// --- completeness ---------------------------------------------------------------------------------

Deno.test('catalog: every rule has a non-empty summary', () => {
  for (const rule of ALL) assert(rule.summary.trim().length > 0, rule.code)
})

Deno.test(
  'catalog: FW004 is absent and stays reserved — PR1 removed the condition it would have ' +
    'detected, and a rule must exist because something needs reporting, never to round out a count',
  () => {
    assertEquals(Object.hasOwn(RULES, 'FW004'), false)
    // The gap is documented where someone would look before "fixing" it.
    assertEquals(RULES.FW003 !== undefined && RULES.FW005 !== undefined, true)
  },
)

// --- getRule ---------------------------------------------------------------------------------

Deno.test('getRule: looks a real code up and returns its definition', () => {
  assertEquals(getRule('DOC003'), RULES.DOC003)
})

Deno.test(
  'getRule: throws for an unknown code, loudly, rather than returning a diagnostic with no ' +
    'metadata',
  () => {
    assertThrows(
      () => getRule('NOT-A-REAL-CODE'),
      Error,
      'Unknown validation rule code: NOT-A-REAL-CODE',
    )
  },
)
