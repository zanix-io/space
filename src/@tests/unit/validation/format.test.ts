import { assertEquals, assertStringIncludes } from '@std/assert'
import { formatDiagnostic, formatDiagnostics } from 'modules/validation/format.ts'
import type { Diagnostic } from 'modules/validation/diagnostic.ts'
import { RULES } from 'modules/validation/rules.ts'

// ================================================================================================
// `formatDiagnostic`/`formatDiagnostics` are pure string formatting — every branch is reachable
// purely by constructing the right `Diagnostic`/options combination, no fixtures beyond that.
//
// Two real rules stand in for "normative, with a reference" and "non-normative, without one":
// DOC003 (basis 'spec', has `reference`) and FW002 (basis 'framework-invariant', no `reference`).
// ================================================================================================

const NORMATIVE_RULE = RULES.DOC003 // basis: spec — normative, has a reference
const NON_NORMATIVE_RULE = RULES.FW002 // basis: framework-invariant — non-normative, no reference

function diagnostic(overrides: Partial<Diagnostic> = {}): Diagnostic {
  return {
    code: 'DOC003',
    category: 'html',
    severity: 'error',
    resolution: { catalog: 'error', strictPromoted: false, effective: 'error' },
    phase: 'render',
    basis: 'spec',
    message: 'The document is missing <html>.',
    ...overrides,
  }
}

// --- location() — reached only through formatDiagnostic's first line ---------------------------

Deno.test('formatDiagnostic: location shows both file and route when both are present', () => {
  const result = formatDiagnostic(
    diagnostic({ file: 'src/routes/index.tsx', route: '/home' }),
  )
  assertStringIncludes(result, "  (src/routes/index.tsx · route '/home')")
})

Deno.test('formatDiagnostic: location shows only the file when there is no route', () => {
  const result = formatDiagnostic(diagnostic({ file: 'src/routes/index.tsx' }))
  assertEquals(
    result,
    '  error  DOC003  The document is missing <html>.  (src/routes/index.tsx)',
  )
})

Deno.test('formatDiagnostic: location shows only the route when there is no file', () => {
  const result = formatDiagnostic(diagnostic({ route: '/home' }))
  assertStringIncludes(result, "  (route '/home')")
})

Deno.test('formatDiagnostic: location is empty when neither file nor route is present', () => {
  const result = formatDiagnostic(diagnostic())
  const firstLine = result.split('\n')[0]
  assertEquals(firstLine.endsWith(')'), false)
  assertEquals(firstLine, '  error  DOC003  The document is missing <html>.')
})

// --- severityLabel --------------------------------------------------------------------------------

Deno.test('formatDiagnostic: default options prefix the severity label', () => {
  const result = formatDiagnostic(diagnostic())
  assertStringIncludes(result, '  error  DOC003')
})

Deno.test('formatDiagnostic: severityLabel: true explicitly matches the default', () => {
  const result = formatDiagnostic(diagnostic(), { severityLabel: true })
  assertStringIncludes(result, '  error  DOC003')
})

Deno.test('formatDiagnostic: severityLabel: false omits the label entirely', () => {
  const result = formatDiagnostic(diagnostic(), { severityLabel: false })
  const firstLine = result.split('\n')[0]
  assertEquals(firstLine, '  DOC003  The document is missing <html>.')
})

// --- hint -------------------------------------------------------------------------------------

Deno.test('formatDiagnostic: a hint is included on its own line when present', () => {
  const result = formatDiagnostic(diagnostic({ hint: 'Add a top-level <html> element.' }))
  assertStringIncludes(result, '         Add a top-level <html> element.')
})

Deno.test('formatDiagnostic: no hint line is emitted when hint is absent', () => {
  const result = formatDiagnostic(diagnostic())
  assertEquals(result.split('\n').length, 1)
})

// --- severityExplanation, reached only through formatDiagnostic --------------------------------

Deno.test(
  "formatDiagnostic: a specific override ('warning', not true) reads 'severity set to ... by " +
    "this project'",
  () => {
    const result = formatDiagnostic(
      diagnostic({
        resolution: {
          catalog: 'error',
          override: 'warning',
          strictPromoted: false,
          effective: 'warning',
        },
      }),
    )
    assertStringIncludes(result, "severity: severity set to 'warning' by this project")
  },
)

Deno.test(
  "formatDiagnostic: override === true reads 'enabled by this project', not a quoted severity",
  () => {
    const result = formatDiagnostic(
      diagnostic({
        resolution: { catalog: 'info', override: true, strictPromoted: false, effective: 'info' },
      }),
    )
    assertStringIncludes(result, 'severity: enabled by this project')
  },
)

Deno.test(
  "formatDiagnostic: strictPromoted reads 'promoted from ... to error by strict mode'",
  () => {
    const result = formatDiagnostic(
      diagnostic({
        resolution: { catalog: 'warning', strictPromoted: true, effective: 'error' },
      }),
    )
    assertStringIncludes(result, "severity: promoted from 'warning' to 'error' by strict mode")
  },
)

Deno.test(
  'formatDiagnostic: override and strictPromoted together join with "; " into one severity line',
  () => {
    const result = formatDiagnostic(
      diagnostic({
        resolution: {
          catalog: 'warning',
          override: 'warning',
          strictPromoted: true,
          effective: 'error',
        },
      }),
    )
    assertStringIncludes(
      result,
      "severity: severity set to 'warning' by this project; promoted from 'warning' to 'error' " +
        'by strict mode',
    )
  },
)

Deno.test(
  'formatDiagnostic: neither override nor strictPromoted means no severity line at all',
  () => {
    const result = formatDiagnostic(
      diagnostic({
        resolution: { catalog: 'error', strictPromoted: false, effective: 'error' },
      }),
    )
    assertEquals(result.includes('severity:'), false)
  },
)

// --- explain --------------------------------------------------------------------------------------

Deno.test(
  'formatDiagnostic: explain omitted (default false) emits no authority/reference line',
  () => {
    const result = formatDiagnostic(diagnostic())
    assertEquals(result.includes('required by'), false)
    assertEquals(result.includes('based on'), false)
  },
)

Deno.test(
  'formatDiagnostic: explain on a normative rule with a reference says "required by" and cites it',
  () => {
    const result = formatDiagnostic(
      diagnostic({ code: NORMATIVE_RULE.code, basis: NORMATIVE_RULE.basis }),
      { explain: true },
    )
    assertStringIncludes(
      result,
      `         required by ${NORMATIVE_RULE.basis} — ${NORMATIVE_RULE.reference}`,
    )
  },
)

Deno.test(
  'formatDiagnostic: explain on a non-normative rule with no reference says "based on" and omits ' +
    'the em-dash suffix entirely',
  () => {
    const result = formatDiagnostic(
      diagnostic({ code: NON_NORMATIVE_RULE.code, basis: NON_NORMATIVE_RULE.basis }),
      { explain: true },
    )
    assertEquals(NON_NORMATIVE_RULE.reference, undefined)
    assertStringIncludes(result, `         based on ${NON_NORMATIVE_RULE.basis}`)
    assertEquals(result.includes('—'), false)
  },
)

// --- formatDiagnostics ---------------------------------------------------------------------------

Deno.test('formatDiagnostics: an empty array formats to the empty string', () => {
  assertEquals(formatDiagnostics([]), '')
})

Deno.test('formatDiagnostics: joins multiple diagnostics with a newline', () => {
  const first = diagnostic({ code: 'DOC003', message: 'first finding' })
  const second = diagnostic({ code: 'DOC003', message: 'second finding', severity: 'warning' })
  const result = formatDiagnostics([first, second])
  assertEquals(result, `${formatDiagnostic(first)}\n${formatDiagnostic(second)}`)
})

Deno.test('formatDiagnostics: forwards options to every diagnostic it formats', () => {
  const first = diagnostic({ code: NORMATIVE_RULE.code, basis: NORMATIVE_RULE.basis })
  const second = diagnostic({
    code: NORMATIVE_RULE.code,
    basis: NORMATIVE_RULE.basis,
    message: 'second',
  })
  const options = { severityLabel: false, explain: true }
  const result = formatDiagnostics([first, second], options)
  assertEquals(
    result,
    `${formatDiagnostic(first, options)}\n${formatDiagnostic(second, options)}`,
  )
  assertEquals(result.includes('error  DOC003'), false)
  assertStringIncludes(result, 'required by')
})
