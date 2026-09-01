import { assert, assertEquals } from '@std/assert'
import { extractSymbolIds, optimizeSvgAsset } from 'modules/assets/svg-optimize.ts'
import { SVGO_SPECIFIER } from 'modules/lazy/specifiers.ts'

/** Real `svgo` calls, not mocks — confirmed to run cleanly under Deno with no native binary
 * (verified directly: import, run, verified output). */

Deno.test(
  "optimizeSvgAsset: a real improvement replaces the same key's bytes — no new keys, " +
    'SVG has no breakpoint/format concept',
  async () => {
    const source = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">' +
        '<!-- a comment --><circle cx="50" cy="50" r="40" id="unused-id-12345"/></svg>',
    )
    const result = await optimizeSvgAsset('icon.svg', source)

    assertEquals(result.relativePath, 'icon.svg')
    assert(result.bytes.byteLength < source.byteLength, 'expected the optimized SVG to be smaller')
    const text = new TextDecoder().decode(result.bytes)
    assert(!text.includes('<!-- a comment -->'), 'comments should be stripped')
    assert(!text.includes('width="100"'), 'explicit width should be stripped')
  },
)

Deno.test(
  'optimizeSvgAsset: no improvement keeps the original bytes exactly (byte-for-byte)',
  async () => {
    // Already minimal — nothing for svgo\'s safe transforms to strip.
    const source = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg"><circle cx="1" cy="1" r="1"/></svg>',
    )
    const result = await optimizeSvgAsset('icon.svg', source)
    assertEquals(result.bytes, source)
  },
)

Deno.test(
  'optimizeSvgAsset: a malformed/unparseable SVG passes through untouched rather than failing ' +
    'the build',
  async () => {
    const source = new TextEncoder().encode('<svg><circle cx="1" cy="1" r="1"</svg>') // truncated tag
    const result = await optimizeSvgAsset('broken.svg', source)
    assertEquals(result.relativePath, 'broken.svg')
    assertEquals(result.bytes, source)
  },
)

Deno.test(
  'optimizeSvgAsset: never touches CSS-selector purging (unrelated to the sprite <use> pattern) ' +
    '— a class referenced only elsewhere is preserved',
  async () => {
    const source = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg"><style>.never-used-anywhere{fill:red}</style>' +
        '<circle class="never-used-anywhere" cx="1" cy="1" r="1"/></svg>',
    )
    const result = await optimizeSvgAsset('icon.svg', source)
    const text = new TextDecoder().decode(result.bytes)
    assert(text.includes('never-used-anywhere'), 'the legacy purge step must not run here')
  },
)

// Symbol-id protection — a multi-symbol sprite (`<symbol id="name">`, meant for an external
// `<use href="other-file.svg#name">`) has no `<use>` of its own referencing those ids WITHIN the
// same document, so a naive `cleanupIds` run would strip every one. `extractSymbolIds`/
// `fullConfigFor` protect them automatically, on every call, with NO argument needed — this is
// the module's own current default, not an opt-in.

function spriteFixture(): Uint8Array {
  return new TextEncoder().encode(
    '<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0">' +
      '<symbol id="search" viewBox="0 0 512 512"><path d="M1 1"/></symbol>' +
      '<symbol id="close" viewBox="0 0 384 512"><path d="M2 2"/></symbol>' +
      '</svg>',
  )
}

Deno.test(
  'extractSymbolIds: finds every <symbol id> regardless of attribute order, ignores ids on ' +
    'any other element',
  () => {
    const text = '<svg><symbol viewBox="0 0 1 1" id="a"/><symbol id="b" viewBox="0 0 1 1"/>' +
      '<circle id="not-a-symbol"/></svg>'
    assertEquals(extractSymbolIds(text).sort(), ['a', 'b'])
  },
)

Deno.test(
  'optimizeSvgAsset: preserveIds omitted (default) now PROTECTS symbol ids automatically — no ' +
    'argument needed, a <symbol>-based sprite is safe by default',
  async () => {
    const result = await optimizeSvgAsset('sprite.svg', spriteFixture())
    const text = new TextDecoder().decode(result.bytes)
    assert(text.includes('id="search"'), 'expected the real "search" symbol id to survive')
    assert(text.includes('id="close"'), 'expected the real "close" symbol id to survive')
    assert(!text.includes('width="0"'), 'expected removeDimensions to still run')
  },
)

Deno.test(
  'optimizeSvgAsset: symbol-id protection is PRECISE, not all-or-nothing — a stray, ' +
    'genuinely-unused id on a NON-symbol element in the SAME file still gets cleaned',
  async () => {
    const source = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg" width="0">' +
        '<symbol id="search" viewBox="0 0 512 512"><path d="M1 1"/></symbol>' +
        '<circle id="stray-not-a-symbol" r="1"/>' +
        '</svg>',
    )
    const result = await optimizeSvgAsset('mixed.svg', source)
    const text = new TextDecoder().decode(result.bytes)
    assert(text.includes('id="search"'), 'the symbol id must survive')
    assert(
      !text.includes('id="stray-not-a-symbol"'),
      'a non-symbol dead id in the same file must still be cleaned — protection is per-id, ' +
        'not a blanket skip of the whole file',
    )
  },
)

Deno.test(
  'optimizeSvgAsset: preserveIds true keeps every symbol id exactly (skips cleanupIds ' +
    'entirely, same as before), still minifies everything else',
  async () => {
    const source = spriteFixture()
    const result = await optimizeSvgAsset('sprite.svg', source, true)
    const text = new TextDecoder().decode(result.bytes)

    assert(text.includes('id="search"'), 'expected the real "search" id to survive untouched')
    assert(text.includes('id="close"'), 'expected the real "close" id to survive untouched')
    assert(!text.includes('width="0"'), 'expected removeDimensions to still run')
    assert(
      result.bytes.byteLength < source.byteLength,
      'expected preserveIds to still shrink the file via the other safe transforms',
    )
  },
)

Deno.test(
  'optimizeSvgAsset: preserveIds true on a file with a genuinely unused NON-symbol id still ' +
    'keeps it — this glob remains the supplementary escape hatch for the non-symbol case',
  async () => {
    // Not a sprite pattern at all — a single decorative element with a stray id nothing anywhere
    // references. `preserveIds` only turns off deletion; it never claims every surviving id was
    // meaningful, the same way `include`/`svg` themselves are declared per-file, not inferred.
    const source = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg" width="10"><circle id="stray" r="1"/></svg>',
    )
    const result = await optimizeSvgAsset('icon.svg', source, true)
    const text = new TextDecoder().decode(result.bytes)
    assert(text.includes('id="stray"'), 'preserveIds keeps even an apparently-unused id, by design')
  },
)

// ================================================================================================
// Regression check — files with NO `<symbol>` at all (the common case: a standalone icon or
// illustration, zero or more plain ids) must optimize EXACTLY as they did before `preserve` was
// added, byte-for-byte. Compared directly against svgo called with the ORIGINAL, hardcoded
// pre-`preserve` config — not inferred from `optimizeSvgAsset`'s own behavior, an independent,
// literal re-implementation of "what cleanupIds used to do" to compare against.
// ================================================================================================

async function optimizeWithOriginalConfig(text: string): Promise<string> {
  const svgo = await import(SVGO_SPECIFIER) as unknown as {
    optimize(input: string, config?: unknown): { data: string }
  }
  return svgo.optimize(text, {
    plugins: [
      'removeDimensions',
      'removeMetadata',
      'removeComments',
      'minifyStyles',
      { name: 'cleanupIds', params: { minify: true, remove: true } }, // no `preserve` at all
    ],
  }).data
}

Deno.test(
  'optimizeSvgAsset: a plain icon with NO ids at all optimizes byte-identically to the ' +
    'original pre-preserve config — extractSymbolIds finding nothing changes nothing',
  async () => {
    const text = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24">' +
      '<!-- comment --><path d="M1 1 L2 2"/></svg>'
    const source = new TextEncoder().encode(text)

    const result = await optimizeSvgAsset('plain.svg', source)
    const expected = await optimizeWithOriginalConfig(text)

    assertEquals(new TextDecoder().decode(result.bytes), expected)
  },
)

Deno.test(
  'optimizeSvgAsset: a plain icon with a stray NON-symbol id optimizes byte-identically to the ' +
    'original pre-preserve config — the id is actually removed, not just "not asserted present"',
  async () => {
    const text = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">' +
      '<!-- a comment --><circle cx="50" cy="50" r="40" id="unused-id-12345"/></svg>'
    const source = new TextEncoder().encode(text)

    const result = await optimizeSvgAsset('icon.svg', source)
    const resultText = new TextDecoder().decode(result.bytes)
    const expected = await optimizeWithOriginalConfig(text)

    assertEquals(resultText, expected)
    assert(!resultText.includes('id="unused-id-12345"'), 'the stray id must actually be removed')
  },
)

Deno.test(
  'optimizeSvgAsset: a non-symbol id genuinely REFERENCED within the same document ' +
    '(<use href="#id">, not a <symbol>) still gets minified/renamed as before, not frozen',
  async () => {
    const text = '<svg xmlns="http://www.w3.org/2000/svg" width="0">' +
      '<path id="in-doc-shape" d="M1 1 L2 2"/><use href="#in-doc-shape" x="10"/></svg>'
    const source = new TextEncoder().encode(text)

    const result = await optimizeSvgAsset('icon.svg', source)
    const resultText = new TextDecoder().decode(result.bytes)
    const expected = await optimizeWithOriginalConfig(text)

    assertEquals(resultText, expected)
    assert(
      !resultText.includes('in-doc-shape'),
      'an in-document-referenced, non-symbol id must still be minified to a short generated id, ' +
        'exactly as cleanupIds always did — only <symbol> ids are exempted from this',
    )
  },
)
