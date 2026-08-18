import { assertEquals, assertThrows } from '@std/assert'
import { mergeValidationConfig, resolveValidationFlags } from 'modules/validation/cli-options.ts'

// ================================================================================================
// FLAG SEMANTICS — one mapping, identical in `build` and `dev`.
//
// Two commands interpreting the same flag differently is the kind of implicit semantics that makes
// a validator untrustworthy. These tests pin the mapping once; both commands consume it unchanged.
// ================================================================================================

Deno.test('flags: nothing given runs the static phase — the default', () => {
  const resolved = resolveValidationFlags({})
  assertEquals(resolved.enabled, true)
  assertEquals(resolved.phases, { static: true, render: false })
  assertEquals(resolved.config, {})
})

Deno.test('flags: --validation is the default, stated explicitly', () => {
  assertEquals(resolveValidationFlags({ validation: true }).phases, { static: true, render: false })
  assertEquals(resolveValidationFlags({ validation: 'static' }).phases, {
    static: true,
    render: false,
  })
})

Deno.test(
  'flags: --validation=render ADDS the render phase, it never replaces the static one. The render ' +
    'phase covers a subset of routes and a subset of rules, so treating it as an alternative would ' +
    'silently reduce coverage while reading like an increase',
  () => {
    assertEquals(resolveValidationFlags({ validation: 'render' }).phases, {
      static: true,
      render: true,
    })
  },
)

Deno.test('flags: --no-validation wins outright over every other flag', () => {
  const resolved = resolveValidationFlags({
    noValidation: true,
    validation: 'render',
    validationStrict: true,
    validationCategory: 'html',
  })
  assertEquals(resolved.enabled, false)
  assertEquals(resolved.phases, { static: false, render: false })
  assertEquals(resolved.config, {})
})

Deno.test('flags: --validation-strict maps to config.strict and nothing else', () => {
  assertEquals(resolveValidationFlags({ validationStrict: true }).config, { strict: true })
})

Deno.test('flags: --validation-category maps to config.categories, trimmed', () => {
  assertEquals(
    resolveValidationFlags({ validationCategory: 'html, a11y ,pwa' }).config.categories,
    ['html', 'a11y', 'pwa'],
  )
})

Deno.test(
  'flags: an unknown category FAILS rather than being ignored — a typo that silently matched ' +
    'nothing would report a clean run over an empty rule set',
  () => {
    assertThrows(
      () => resolveValidationFlags({ validationCategory: 'html,seoo' }),
      Error,
      'seoo',
    )
  },
)

Deno.test('flags: an unknown --validation mode fails loudly', () => {
  assertThrows(() => resolveValidationFlags({ validation: 'deep' }), Error, 'deep')
})

Deno.test(
  'flags: category selection does NOT touch severity — the two are independent axes and a flag ' +
    'that narrowed a run must never also change how serious what remains is',
  () => {
    const resolved = resolveValidationFlags({ validationCategory: 'a11y' })
    assertEquals(resolved.config.strict, undefined)
    assertEquals(Object.hasOwn(resolved.config, 'rules'), false)
  },
)

// --- merging with the project's own policy ---------------------------------------------------------

Deno.test('merge: flags win field by field over the project policy', () => {
  assertEquals(
    mergeValidationConfig({ strict: false }, { strict: true }),
    { strict: true },
  )
})

Deno.test(
  'merge: fields the flags say nothing about survive untouched — `rules` and `exempt` have no flag ' +
    'because per-rule severity and route exemptions belong in the project, versioned with it',
  () => {
    const project = { rules: { SEO002: 'warning' as const }, exempt: ['preview/**'] }
    const merged = mergeValidationConfig(project, { strict: true })
    assertEquals(merged, { rules: { SEO002: 'warning' }, exempt: ['preview/**'], strict: true })
  },
)

Deno.test(
  'merge: a project that disabled validation stays disabled — a flag that merely shapes a run does ' +
    'not opt it back in',
  () => {
    assertEquals(mergeValidationConfig(false, { strict: true }), false)
  },
)

Deno.test('merge: no project config at all yields just the flag config', () => {
  assertEquals(mergeValidationConfig(undefined, { categories: ['html'] }), {
    categories: ['html'],
  })
})
