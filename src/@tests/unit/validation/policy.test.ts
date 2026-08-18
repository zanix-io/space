import { assert, assertEquals } from '@std/assert'
import { RULES } from 'modules/validation/rules.ts'
import { isNormative } from 'modules/validation/diagnostic.ts'
import { resolveSeverity } from 'modules/validation/engine.ts'

// ================================================================================================
// PER-RULE POLICY — the classification decisions specific to individual rules.
//
// Scope is deliberately narrow. Structural invariants (counts, enumerations, normativity derived
// from basis, the three dimensions staying independent) live in `catalog-invariants.test.ts`, and
// the severity precedence matrix lives in `precedence.test.ts`. This file asserts only what neither
// can: that a specific rule is classified the way it is FOR THE STATED REASON. Repeating their
// assertions here would create a second source of truth about the same facts — the failure mode
// this split exists to avoid.
// ================================================================================================

Deno.test(
  '<h1>: a project convention, not an accessibility requirement. Not required by the HTML ' +
    'Standard, not a WCAG success criterion, and Google Search Central documents no requirement ' +
    'about heading counts — so its basis is project-convention even though its category is a11y',
  () => {
    const rule = RULES.A11Y006
    assertEquals(rule.category, 'a11y')
    assertEquals(rule.basis, 'project-convention')
    assertEquals(isNormative(rule), false)
    assertEquals(rule.severity, 'warning')
    // On by default — a useful signal about template completeness — but never an error by default,
    // and always something a project can switch off.
    assertEquals(rule.optIn, false)
    assertEquals(rule.configurable, true)
    assertEquals(resolveSeverity(rule, {})?.effective, 'warning')
  },
)

Deno.test(
  '<h1>: reaches error ONLY through a project explicitly adopting strict enforcement, never ' +
    'through a framework default',
  () => {
    assertEquals(resolveSeverity(RULES.A11Y006, { strict: true })?.effective, 'error')
    assertEquals(resolveSeverity(RULES.A11Y006, {})?.effective, 'warning')
  },
)

Deno.test(
  'heading order and multiple <h1>: ecosystem recommendations, off by default. G141 is an ADVISORY ' +
    'technique rather than a sufficient one, skipping levels is not a documented failure of WCAG ' +
    '1.3.1, and Google states heading order does not matter to Search',
  () => {
    for (const code of ['A11Y007', 'A11Y008'] as const) {
      assertEquals(RULES[code].basis, 'ecosystem-recommendation', code)
      assertEquals(RULES[code].severity, 'info', code)
      assertEquals(RULES[code].optIn, true, code)
    }
  },
)

Deno.test(
  'title/description length: a heuristic with NO primary source. Google states outright that there ' +
    'is no limit on how long a meta description can be; the familiar 60/160 figures are industry ' +
    'convention, and the basis records exactly that',
  () => {
    assertEquals(RULES.SEO007.basis, 'heuristic')
    assertEquals(RULES.SEO007.optIn, true)
    assertEquals(resolveSeverity(RULES.SEO007, {}), undefined)
  },
)

Deno.test(
  'robots: exactly ONE robots rule exists, about an unrecognized token. There is deliberately no ' +
    'rule for a MISSING robots meta — its absence means index,follow, which is the correct default',
  () => {
    const robotsRules = Object.values(RULES).filter((rule) =>
      rule.summary.toLowerCase().includes('robots')
    )
    assertEquals(robotsRules.map((rule) => rule.code), ['SEO003'])
    assertEquals(RULES.SEO003.severity, 'warning')
    // Not normative: crawlers IGNORE tokens they do not recognize, so the failure mode is a
    // silently inert directive, not an invalid document.
    assertEquals(isNormative(RULES.SEO003), false)
  },
)

Deno.test(
  'canonical: a search-engine recommendation, never a standard. Google describes rel=canonical as ' +
    '"a strong signal" rather than a directive, and recommends absolute URLs without requiring them',
  () => {
    assertEquals(RULES.SEO002.basis, 'search-engine-recommendation')
    assertEquals(RULES.SEO005.basis, 'search-engine-recommendation')
    assertEquals(isNormative(RULES.SEO005), false)
    // The citation survives the demotion — as context, not as authority.
    assert(RULES.SEO005.reference !== undefined)
  },
)

Deno.test(
  'social metadata never blocks a build, in any configuration. No search engine ranks on Open ' +
    'Graph or X Cards, so these must not be able to fail a build even under strict mode',
  () => {
    for (const rule of Object.values(RULES).filter((r) => r.category === 'social')) {
      assert(rule.severity !== 'error', `${rule.code} must not be an error`)
      assertEquals(rule.optIn, true, `${rule.code} must be opt-in`)
      // Opt-in rules stay inactive under strict, so strict cannot switch them on by the back door.
      assertEquals(resolveSeverity(rule, { strict: true }), undefined, rule.code)
    }
  },
)

Deno.test(
  'og:image relative URLs: a recommendation, not a spec requirement. The Open Graph protocol ' +
    'defines its URL type as http/https URLs but gives no guidance at all on relative-URL handling ' +
    '— carried as normative during development and demoted on review',
  () => {
    assertEquals(RULES.SOC001.basis, 'ecosystem-recommendation')
    assertEquals(isNormative(RULES.SOC001), false)
    assert(RULES.SOC001.reference?.includes('no guidance on relative URLs'))
  },
)

Deno.test(
  'og required properties: genuinely a spec requirement — the protocol names og:title, og:type, ' +
    'og:image and og:url as required for every page. Normative, yet still opt-in, because a project ' +
    'that does not use Open Graph has nothing to conform to',
  () => {
    assertEquals(RULES.SOC002.basis, 'spec')
    assertEquals(isNormative(RULES.SOC002), true)
    assertEquals(RULES.SOC002.optIn, true)
  },
)

Deno.test(
  'viewport: an externally-normative error with published thresholds. ACT rule b4f0c3 maps to WCAG ' +
    '1.4.4 and is marked required for conformance at AA and above',
  () => {
    assertEquals(RULES.A11Y002.basis, 'accessibility')
    assertEquals(RULES.A11Y002.severity, 'error')
    assertEquals(RULES.A11Y002.configurable, false)
    assert(RULES.A11Y002.reference?.includes('b4f0c3'))
  },
)

Deno.test(
  'img alt: a WCAG requirement, explicitly NOT an HTML conformance one. The Standard says the ' +
    'absence of alt asserts that the image is key content with no textual equivalent available — a ' +
    'conforming statement — so the basis is accessibility and the category is a11y, never html',
  () => {
    assertEquals(RULES.A11Y004.category, 'a11y')
    assertEquals(RULES.A11Y004.basis, 'accessibility')
    assertEquals(RULES.A11Y004.reference, 'WCAG 1.1.1 Non-text Content (A)')
  },
)

Deno.test(
  'charset: informational only, because this framework declares the encoding at the protocol level ' +
    'on every response. The meta is a secondary declaration, so its absence is not a conformance ' +
    'failure despite HTML carrying an encoding-declaration requirement',
  () => {
    assertEquals(RULES.DOC004.basis, 'ecosystem-recommendation')
    assertEquals(isNormative(RULES.DOC004), false)
    assertEquals(RULES.DOC004.severity, 'info')
  },
)

Deno.test(
  'the framework errors declare themselves as such — FW001 and FW003 rest on no external standard ' +
    'and must never look as though they do',
  () => {
    for (const code of ['FW001', 'FW003'] as const) {
      assertEquals(RULES[code].basis, 'framework-invariant', code)
      assertEquals(isNormative(RULES[code]), false, code)
      assertEquals(RULES[code].reference, undefined, code)
    }
  },
)

Deno.test(
  "FW006 is a heuristic, not a framework invariant — it inspects a layout's SOURCE rather than the " +
    'document, so it can produce false positives when a layout delegates document construction. ' +
    'DOC003 is what decides validity, and it does so against real rendered output',
  () => {
    assertEquals(RULES.FW006.basis, 'heuristic')
    assertEquals(RULES.FW006.severity, 'warning')
    assertEquals(RULES.FW006.configurable, true)
    assertEquals(RULES.DOC003.phase, 'render')
    assertEquals(RULES.DOC003.configurable, false)
  },
)
