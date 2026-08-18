import { assert, assertEquals } from '@std/assert'
import { resolveSeverity } from 'modules/validation/engine.ts'
import type { ValidationConfig } from 'modules/validation/engine.ts'
import type { DiagnosticSeverity, RuleDefinition } from 'modules/validation/diagnostic.ts'
import { RULES } from 'modules/validation/rules.ts'

// ================================================================================================
// THE PRECEDENCE MATRIX.
//
//     catalog severity  →  per-rule override  →  strict promotion  →  effective severity
//
// `resolveSeverity` is the single authority. These tests enumerate the matrix exhaustively rather
// than sampling it, because the failure this design guards against is not a wrong answer in an
// obvious case — it is an implicit precedence emerging from the order conditions happen to be
// written in. Only full enumeration catches that.
//
// In this project `strict` means literally: no ACTIVE warning may remain a warning.
// ================================================================================================

function rule(overrides: Partial<RuleDefinition> = {}): RuleDefinition {
  return {
    code: 'TEST001',
    category: 'html',
    severity: 'warning',
    phase: 'static',
    basis: 'framework-invariant',
    configurable: true,
    optIn: false,
    summary: 'test rule',
    ...overrides,
  }
}

const SEVERITIES: DiagnosticSeverity[] = ['info', 'warning', 'error']
const OVERRIDES: Array<DiagnosticSeverity | boolean | undefined> = [
  undefined,
  true,
  false,
  'info',
  'warning',
  'error',
]

/** The precedence rule, written independently of the implementation, as the oracle to compare
 * against. If this and `resolveSeverity` ever disagree, one of them is wrong and the test says so. */
function expected(
  catalog: DiagnosticSeverity,
  optIn: boolean,
  override: DiagnosticSeverity | boolean | undefined,
  strict: boolean,
): DiagnosticSeverity | undefined {
  if (override === false) return undefined
  if (override === undefined && optIn) return undefined
  const afterOverride = typeof override === 'string' ? override : catalog
  return strict && afterOverride === 'warning' ? 'error' : afterOverride
}

Deno.test(
  'precedence: the full matrix — every catalog severity × optIn × override × strict combination ' +
    'agrees with the stated precedence, with no exceptions anywhere in the space',
  () => {
    for (const catalog of SEVERITIES) {
      for (const optIn of [false, true]) {
        for (const override of OVERRIDES) {
          for (const strict of [false, true]) {
            const config: ValidationConfig = {
              strict,
              ...(override === undefined ? {} : { rules: { TEST001: override } }),
            }
            const actual = resolveSeverity(rule({ severity: catalog, optIn }), config)
            assertEquals(
              actual?.effective,
              expected(catalog, optIn, override, strict),
              `catalog=${catalog} optIn=${optIn} override=${String(override)} strict=${strict}`,
            )
          }
        }
      }
    }
  },
)

// --- the specific cases the contract calls out ----------------------------------------------------

Deno.test('precedence: warning + strict = error', () => {
  assertEquals(resolveSeverity(rule({ severity: 'warning' }), { strict: true })?.effective, 'error')
})

Deno.test(
  'precedence: warning + EXPLICIT warning override + strict = error. A project asking for strict ' +
    'enforcement is asking about the outcome, not about which warnings it happened to name — and ' +
    'the previous implementation exempted this case purely as a side effect of condition ordering',
  () => {
    const resolution = resolveSeverity(
      rule({ severity: 'warning' }),
      { strict: true, rules: { TEST001: 'warning' } },
    )
    assertEquals(resolution?.effective, 'error')
    assertEquals(resolution?.strictPromoted, true)
  },
)

Deno.test('precedence: an override to error is unaffected by strict', () => {
  const resolution = resolveSeverity(
    rule({ severity: 'info' }),
    { strict: true, rules: { TEST001: 'error' } },
  )
  assertEquals(resolution?.effective, 'error')
  assertEquals(resolution?.strictPromoted, false)
})

Deno.test(
  'precedence: strict never promotes info — not from the catalog, and not from an override. A mode ' +
    "meant to enforce a project's standards would be useless if it also enforced things the " +
    'framework itself says are not standards',
  () => {
    assertEquals(resolveSeverity(rule({ severity: 'info' }), { strict: true })?.effective, 'info')
    assertEquals(
      resolveSeverity(rule({ severity: 'warning' }), { strict: true, rules: { TEST001: 'info' } })
        ?.effective,
      'info',
    )
  },
)

// --- activation is independent of severity ----------------------------------------------------------

Deno.test('precedence: an opt-in rule is inactive with no override, at every severity', () => {
  for (const severity of SEVERITIES) {
    assertEquals(resolveSeverity(rule({ severity, optIn: true }), {}), undefined, severity)
  }
})

Deno.test(
  'precedence: `true` activates an opt-in rule at its CATALOG severity, changing nothing about ' +
    'how serious it is — activation and severity are separate questions and this is how a project ' +
    'answers only the first',
  () => {
    const resolution = resolveSeverity(
      rule({ severity: 'info', optIn: true }),
      { rules: { TEST001: true } },
    )
    assertEquals(resolution?.effective, 'info')
    assertEquals(resolution?.catalog, 'info')
    assertEquals(resolution?.override, true)
  },
)

Deno.test('precedence: `true` on an opt-in warning still gets promoted by strict', () => {
  const resolution = resolveSeverity(
    rule({ severity: 'warning', optIn: true }),
    { strict: true, rules: { TEST001: true } },
  )
  assertEquals(resolution?.effective, 'error')
  assertEquals(resolution?.strictPromoted, true)
})

Deno.test('precedence: `false` deactivates, at every severity and regardless of strict', () => {
  for (const severity of SEVERITIES) {
    for (const strict of [false, true]) {
      assertEquals(
        resolveSeverity(rule({ severity }), { strict, rules: { TEST001: false } }),
        undefined,
        `${severity} strict=${strict}`,
      )
    }
  }
})

// --- gates that run before the precedence chain -------------------------------------------------

Deno.test(
  'precedence: a non-configurable rule short-circuits to its catalog severity — every override ' +
    'form is ignored, because a guarantee a project can quietly downgrade is not a guarantee',
  () => {
    for (const override of OVERRIDES) {
      const config: ValidationConfig = override === undefined
        ? {}
        : { rules: { TEST001: override } }
      const resolution = resolveSeverity(rule({ configurable: false, severity: 'error' }), config)
      assertEquals(resolution?.effective, 'error', String(override))
    }
  },
)

Deno.test('precedence: the category filter runs before everything and yields no finding', () => {
  assertEquals(
    resolveSeverity(rule({ category: 'html' }), {
      categories: ['a11y'],
      strict: true,
      rules: { TEST001: 'error' },
    }),
    undefined,
  )
})

// --- traceability ---------------------------------------------------------------------------------

Deno.test(
  'traceability: a resolution always explains itself — catalog severity, the override applied, ' +
    'whether strict promoted it, and the effective result',
  () => {
    const resolution = resolveSeverity(
      rule({ severity: 'info' }),
      { strict: true, rules: { TEST001: 'warning' } },
    )
    assertEquals(resolution, {
      catalog: 'info',
      override: 'warning',
      strictPromoted: true,
      effective: 'error',
    })
  },
)

Deno.test('traceability: with no override, none is reported rather than a fabricated one', () => {
  const resolution = resolveSeverity(rule({ severity: 'warning' }), {})
  assertEquals(resolution, { catalog: 'warning', strictPromoted: false, effective: 'warning' })
  assert(resolution)
  assertEquals(Object.hasOwn(resolution, 'override'), false)
})

// --- the real catalog, not just synthetic rules -----------------------------------------------------

Deno.test(
  'precedence holds over the REAL catalog: under strict, no active rule anywhere remains a warning',
  () => {
    for (const rule of Object.values(RULES)) {
      const resolution = resolveSeverity(rule, { strict: true })
      if (resolution === undefined) continue
      assert(
        resolution.effective !== 'warning',
        `${rule.code} remained a warning under strict mode`,
      )
    }
  },
)

Deno.test(
  'precedence holds over the REAL catalog: strict alone never activates an opt-in rule — ' +
    'enforcement policy and activation stay independent',
  () => {
    for (const rule of Object.values(RULES)) {
      if (!rule.optIn) continue
      assertEquals(resolveSeverity(rule, { strict: true }), undefined, rule.code)
    }
  },
)
