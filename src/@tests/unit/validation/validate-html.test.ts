import { assert, assertEquals } from '@std/assert'
import { validateRenderedDocument, viewportBlocksZoom } from 'modules/validation/validate-html.ts'
import type { RenderedPageInput } from 'modules/validation/validate-html.ts'
import type { DocumentSemantics } from 'modules/render/document-model.ts'
import type { ValidationConfig } from 'modules/validation/engine.ts'

/** A complete, valid document — every test below starts here and breaks exactly one thing. */
function semantics(overrides: Partial<DocumentSemantics> = {}): DocumentSemantics {
  return {
    titles: ['Widget'],
    meta: { 'name:description': 'A widget.' },
    links: [],
    lang: 'en',
    isDocument: true,
    hasMetaCharset: true,
    viewport: 'width=device-width, initial-scale=1',
    h1Count: 1,
    hasTextContent: true,
    ...overrides,
  }
}

function page(overrides: Partial<RenderedPageInput> = {}): RenderedPageInput {
  return {
    filePath: 'routes/products/page.tsx',
    routePath: 'products',
    semantics: semantics(),
    ...overrides,
  }
}

function codes(input: RenderedPageInput, config: ValidationConfig = {}): string[] {
  return validateRenderedDocument(input, config).map((diagnostic) => diagnostic.code)
}

// --- viewport, the one externally-normative error -------------------------------------------------

Deno.test('viewportBlocksZoom: the exact thresholds ACT rule b4f0c3 publishes', () => {
  assertEquals(viewportBlocksZoom('width=device-width, initial-scale=1'), false)
  assertEquals(viewportBlocksZoom('width=device-width, user-scalable=no'), true)
  assertEquals(viewportBlocksZoom('width=device-width, maximum-scale=1'), true)
  assertEquals(viewportBlocksZoom('width=device-width, maximum-scale=1.5'), true)
  // Exactly 2 is the boundary and is allowed — the rule says "less than 2".
  assertEquals(viewportBlocksZoom('width=device-width, maximum-scale=2'), false)
  assertEquals(viewportBlocksZoom('width=device-width, maximum-scale=5'), false)
  // `maximum-scale=yes` is coerced to 1.0 by the same rule.
  assertEquals(viewportBlocksZoom('width=device-width, maximum-scale=yes'), true)
})

Deno.test('A11Y002: a zoom-blocking viewport is an ERROR and cannot be downgraded', () => {
  const input = page({ semantics: semantics({ viewport: 'width=device-width, user-scalable=no' }) })
  const diagnostics = validateRenderedDocument(input, { rules: { A11Y002: false } })
  const found = diagnostics.find((diagnostic) => diagnostic.code === 'A11Y002')
  assertEquals(found?.severity, 'error')
})

Deno.test('A11Y003: an absent viewport is a warning, not an error', () => {
  const diagnostics = validateRenderedDocument(
    page({ semantics: semantics({ viewport: undefined }) }),
  )
  assertEquals(diagnostics.find((d) => d.code === 'A11Y003')?.severity, 'warning')
})

// --- document structure --------------------------------------------------------------------------

Deno.test('DOC003: a non-document response is an error', () => {
  const diagnostics = validateRenderedDocument(
    page({ semantics: semantics({ isDocument: false }) }),
  )
  assertEquals(diagnostics.find((d) => d.code === 'DOC003')?.severity, 'error')
})

Deno.test(
  'DOC003 SHORT-CIRCUITS every other rule — reporting "no title", "no lang" and "no viewport" ' +
    'against something that is not a document produces a cascade of findings with one real cause',
  () => {
    const found = codes(page({
      semantics: semantics({
        isDocument: false,
        titles: [],
        lang: undefined,
        viewport: undefined,
        h1Count: 0,
        hasTextContent: false,
      }),
    }))
    assertEquals(found, ['DOC003'])
  },
)

// --- head assembly -------------------------------------------------------------------------------

Deno.test(
  'FW003: a document missing a title THAT WAS RESOLVED means the renderer dropped the head — ' +
    'reported as a framework defect, not as a missing declaration',
  () => {
    const diagnostics = validateRenderedDocument(page({
      semantics: semantics({ titles: [] }),
      expectedTitle: 'Widget',
    }))
    const fw003 = diagnostics.find((d) => d.code === 'FW003')
    assertEquals(fw003?.severity, 'error')
    assertEquals(diagnostics.some((d) => d.code === 'DOC001'), false)
  },
)

Deno.test(
  'DOC001: the same missing title with NOTHING resolved is an authoring gap, not a framework ' +
    'defect — conflating the two would point the reader at the wrong problem',
  () => {
    const found = codes(page({ semantics: semantics({ titles: [] }) }))
    assertEquals(found.includes('DOC001'), true)
    assertEquals(found.includes('FW003'), false)
  },
)

Deno.test('DOC002: more than one title is reported', () => {
  const found = codes(page({ semantics: semantics({ titles: ['A', 'B'] }) }))
  assertEquals(found.includes('DOC002'), true)
})

// --- language ------------------------------------------------------------------------------------

Deno.test('A11Y001: a missing or empty lang is reported', () => {
  assertEquals(codes(page({ semantics: semantics({ lang: undefined }) })).includes('A11Y001'), true)
  assertEquals(codes(page({ semantics: semantics({ lang: '  ' }) })).includes('A11Y001'), true)
})

// --- headings ------------------------------------------------------------------------------------

Deno.test('A11Y006: zero h1 is a WARNING, and its message says it is not a requirement', () => {
  const diagnostics = validateRenderedDocument(page({ semantics: semantics({ h1Count: 0 }) }))
  const found = diagnostics.find((d) => d.code === 'A11Y006')
  assertEquals(found?.severity, 'warning')
  assertEquals(found?.message.includes('not a requirement of HTML, WCAG or Google Search'), true)
})

Deno.test('A11Y006: a document with no h1 is still VALID — no error is produced anywhere', () => {
  const diagnostics = validateRenderedDocument(page({ semantics: semantics({ h1Count: 0 }) }))
  assertEquals(diagnostics.some((d) => d.severity === 'error'), false)
})

Deno.test('A11Y008: multiple h1 is off by default, and INFO when opted in', () => {
  const input = page({ semantics: semantics({ h1Count: 3 }) })
  assertEquals(codes(input).includes('A11Y008'), false)
  const diagnostics = validateRenderedDocument(input, { rules: { A11Y008: 'info' } })
  assertEquals(diagnostics.find((d) => d.code === 'A11Y008')?.severity, 'info')
})

Deno.test('A11Y007: a heading level skip is detected from the markup, once opted in', () => {
  const input = page({ html: '<h1>a</h1><h3>b</h3>' })
  assertEquals(codes(input).includes('A11Y007'), false)
  assertEquals(codes(input, { rules: { A11Y007: 'info' } }).includes('A11Y007'), true)
})

Deno.test('A11Y007: a well-ordered heading sequence is not reported', () => {
  const input = page({ html: '<h1>a</h1><h2>b</h2><h3>c</h3><h2>d</h2>' })
  assertEquals(codes(input, { rules: { A11Y007: 'info' } }).includes('A11Y007'), false)
})

// --- images and links ------------------------------------------------------------------------------

Deno.test('A11Y004: an img with no alt attribute is reported', () => {
  assertEquals(codes(page({ html: '<img src="/a.png">' })).includes('A11Y004'), true)
})

Deno.test(
  'A11Y004: alt="" is CORRECT for a decorative image and is never reported — the rule is about a ' +
    'missing attribute, not an empty one',
  () => {
    assertEquals(codes(page({ html: '<img src="/a.png" alt="">' })).includes('A11Y004'), false)
  },
)

Deno.test('A11Y005: a link with no accessible name is reported', () => {
  assertEquals(codes(page({ html: '<a href="/x"><span></span></a>' })).includes('A11Y005'), true)
})

Deno.test('A11Y005: text, aria-label, or an image with alt each supply a name', () => {
  for (
    const html of [
      '<a href="/x">Read the report</a>',
      '<a href="/x" aria-label="Read the report"><svg></svg></a>',
      '<a href="/x"><img src="/i.png" alt="Read the report"></a>',
    ]
  ) {
    assertEquals(codes(page({ html })).includes('A11Y005'), false, html)
  }
})

Deno.test('A11Y005: an anchor with no href is not a link and is ignored', () => {
  assertEquals(codes(page({ html: '<a><span></span></a>' })).includes('A11Y005'), false)
})

// --- content ------------------------------------------------------------------------------------

Deno.test('SEO008: a document with no text content is reported', () => {
  assertEquals(
    codes(page({ semantics: semantics({ hasTextContent: false }) })).includes('SEO008'),
    true,
  )
})

// --- exemptions and clean documents ----------------------------------------------------------------

Deno.test('a complete, valid document produces no diagnostics at all', () => {
  assertEquals(codes(page({ html: '<h1>Widget</h1><p>text</p>' })), [])
})

Deno.test(
  'a route exempted by project policy is skipped entirely, even when badly broken — the only way ' +
    'out at this phase, since a redirecting page never renders HTML to reach it',
  () => {
    const input = page({
      routePath: 'internal/hooks',
      semantics: semantics({ isDocument: false, titles: [], lang: undefined }),
    })
    assertEquals(validateRenderedDocument(input, { exempt: ['internal/**'] }), [])
    // Without the exemption the same input is reported.
    assert(validateRenderedDocument(input).length > 0)
  },
)

Deno.test(
  'rules needing raw markup are simply skipped when no html is supplied — a caller with only ' +
    'semantics still gets every other rule, rather than a false clean bill of health',
  () => {
    const found = codes(page({ semantics: semantics({ titles: [] }) }))
    assertEquals(found.includes('DOC001'), true)
    assertEquals(found.includes('A11Y004'), false)
  },
)
