import { assert, assertEquals } from '@std/assert'
import { optimizeSvgAsset } from 'modules/assets/svg-optimize.ts'

/** Real `svgo` calls, not mocks — confirmed to run cleanly under Deno with no native binary
 * (a real spike during design: import, run, verified output). */

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
