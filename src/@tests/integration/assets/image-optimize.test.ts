import { assert, assertEquals, assertExists } from '@std/assert'
import sharp from 'sharp'
import { optimizeImageAsset } from 'modules/assets/image-optimize.ts'

/**
 * Real `sharp` calls throughout, not mocks — same reasoning `pwa-plugin.test.ts` already
 * documents: whether an emitted variant is actually smaller/correctly-sized/correctly-formatted
 * can only be verified against real encoded bytes. The exhaustive proof of the underlying
 * byte-comparison RULE itself lives in `pick-smaller.test.ts` (synthetic, deterministic); these
 * tests instead prove `image-optimize.ts` actually WIRES that rule correctly at each of its three
 * reference tiers, using real, quality-sensitive image content.
 */

/** Deterministic (no `Math.random()` — fully reproducible across runs), spatially-structured
 * fixture: a diagonal color gradient plus a sine-wave texture band. Real photographic content has
 * spatial correlation that lets webp/avif/jpeg-at-different-qualities behave differently from one
 * another — pure per-pixel random noise (tried first) does NOT, and produced flaky pass/fail
 * results for the webp/avif comparisons below; this fixture doesn't. */
function gradientRaw(width: number, height: number): Uint8Array {
  const raw = new Uint8Array(width * height * 3)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3
      raw[i] = Math.floor((x / width) * 255)
      raw[i + 1] = Math.floor((y / height) * 255)
      raw[i + 2] = Math.floor(128 + 127 * Math.sin((x + y) / 12))
    }
  }
  return raw
}

async function gradientJpeg(width: number, height: number, quality: number): Promise<Uint8Array> {
  return await sharp(gradientRaw(width, height), { raw: { width, height, channels: 3 } })
    .jpeg({ quality })
    .toBuffer()
}

function findEntry(entries: { relativePath: string; bytes: Uint8Array }[], relativePath: string) {
  return entries.find((e) => e.relativePath === relativePath)
}

Deno.test(
  'optimizeImageAsset: images:true bare — a real improvement replaces the original key, ' +
    'byte-for-byte one entry',
  async () => {
    const source = await gradientJpeg(200, 150, 100)
    const result = await optimizeImageAsset('hero.jpg', source, true)

    assertEquals(result.length, 1, 'no breakpoints/formats requested — exactly one entry')
    assertEquals(result[0].relativePath, 'hero.jpg')
    assert(
      result[0].bytes.byteLength < source.byteLength,
      'expected the optimized bytes to be smaller',
    )
  },
)

Deno.test(
  'optimizeImageAsset: images:true bare — no improvement keeps the original bytes exactly ' +
    '(byte-for-byte)',
  async () => {
    // A real source already encoded at LOW quality (15) — re-encoding at the pipeline's own
    // higher default quality (90) reliably produces a LARGER result (verified empirically before
    // writing this test, not assumed).
    const source = await gradientJpeg(200, 150, 15)
    const result = await optimizeImageAsset('hero.jpg', source, true)

    assertEquals(result.length, 1)
    assertEquals(result[0].relativePath, 'hero.jpg')
    assertEquals(
      result[0].bytes,
      source,
      'expected the EXACT original bytes, not a re-encoded copy',
    )
  },
)

Deno.test(
  'optimizeImageAsset: breakpoints only — original key untouched, new additive keys for each ' +
    'breakpoint that wins',
  async () => {
    const source = await gradientJpeg(2000, 1500, 100)
    const result = await optimizeImageAsset('hero.jpg', source, { breakpoints: ['msm', 'mlg'] })

    const original = findEntry(result, 'hero.jpg')
    assertExists(original)
    assertEquals(original.bytes, source, 'the original entry must be byte-for-byte untouched')

    const msm = findEntry(result, 'hero.msm.jpg')
    const mlg = findEntry(result, 'hero.mlg.jpg')
    assertExists(msm, 'expected a smaller msm variant to win against the (much bigger) original')
    assertExists(mlg, 'expected a smaller mlg variant to win against the (much bigger) original')
    assert(msm.bytes.byteLength < source.byteLength)
    assert(mlg.bytes.byteLength < source.byteLength)

    const msmMeta = await sharp(msm.bytes).metadata()
    const mlgMeta = await sharp(mlg.bytes).metadata()
    assertEquals(msmMeta.width, 360)
    assertEquals(mlgMeta.width, 720)
  },
)

Deno.test(
  'optimizeImageAsset: small source, withoutEnlargement — a breakpoint wider than the source ' +
    'never upscales it',
  async () => {
    const source = await gradientJpeg(300, 200, 90)
    // mlg=720, wider than the 300px source.
    const result = await optimizeImageAsset('hero.jpg', source, { breakpoints: ['mlg'] })

    const mlg = findEntry(result, 'hero.mlg.jpg')
    if (mlg) {
      const meta = await sharp(mlg.bytes).metadata()
      assertEquals(meta.width, 300, 'must clamp to the real source width, never upscale to 720')
    }
    // Whether or not the variant beats the original at the SAME (clamped) width is
    // content-dependent and irrelevant here — the invariant under test is strictly the
    // no-upscale clamp, verified above whenever the variant exists at all.
  },
)

Deno.test(
  'optimizeImageAsset: two breakpoints clamped to the identical real (width, quality) pair on ' +
    'a small source — deduped internally, both keys still resolve independently',
  async () => {
    const source = await gradientJpeg(300, 200, 90) // smaller than both raw-width breakpoints
    // Two RAW NUMERIC breakpoints (both default to the same `DEFAULT_NUMERIC_BREAKPOINT_QUALITY`)
    // — unlike two named presets (which can carry DIFFERENT default qualities, e.g. msm=85/
    // mlg=90), these are guaranteed to share both the same clamped width AND the same quality
    // once clamped — the only condition under which the internal dedup cache is actually correct
    // to reuse bytes.
    const result = await optimizeImageAsset('hero.jpg', source, { breakpoints: [800, 900] })

    const w800 = findEntry(result, 'hero.w800.jpg')
    const w900 = findEntry(result, 'hero.w900.jpg')
    assertEquals(!!w800, !!w900, 'both clamped-to-the-same-width breakpoints must agree on winning')
    if (w800 && w900) assertEquals(w800.bytes, w900.bytes)
  },
)

Deno.test(
  'optimizeImageAsset: two breakpoints clamped to the same width but with DIFFERENT ' +
    "qualities are never conflated — each uses its own quality, not the other one's cached bytes",
  async () => {
    const source = await gradientJpeg(300, 200, 90) // smaller than both msm(360) and mlg(720)
    const result = await optimizeImageAsset('hero.jpg', source, { breakpoints: ['msm', 'mlg'] })

    const msm = findEntry(result, 'hero.msm.jpg') // preset quality 85
    const mlg = findEntry(result, 'hero.mlg.jpg') // preset quality 90 — same clamped width
    if (msm && mlg) {
      // A real bug this test catches directly: keying the internal dedup cache by width ALONE
      // would silently serve mlg the bytes computed for msm's own (lower) quality.
      const rebuiltAtMlgQuality = await sharp(source)
        .resize({ width: 300, withoutEnlargement: true })
        .jpeg({ quality: 90, mozjpeg: true })
        .toBuffer()
      assertEquals(
        mlg.bytes,
        rebuiltAtMlgQuality,
        "mlg must be encoded at ITS OWN quality (90), not msm's (85)",
      )
    }
  },
)

Deno.test(
  'optimizeImageAsset: formats without breakpoints — each format compared independently ' +
    'against the ORIGINAL, never against each other',
  async () => {
    const source = await gradientJpeg(500, 400, 100)
    const result = await optimizeImageAsset('hero.jpg', source, { formats: ['webp', 'avif'] })

    const original = findEntry(result, 'hero.jpg')
    assertExists(original)
    assertEquals(original.bytes, source)

    // At original dimensions, converting a real photo-like JPEG to webp/avif at quality 90
    // reliably wins against a quality-100 JPEG source of the same content.
    const webp = findEntry(result, 'hero.webp')
    const avif = findEntry(result, 'hero.avif')
    assertExists(webp)
    assertExists(avif)
    assert(webp.bytes.byteLength < source.byteLength)
    assert(avif.bytes.byteLength < source.byteLength)
  },
)

Deno.test(
  'optimizeImageAsset: formats without breakpoints — requesting the ORIGINAL format again ' +
    'produces no duplicate/colliding key',
  async () => {
    const source = await gradientJpeg(300, 200, 100)
    const result = await optimizeImageAsset('hero.jpg', source, { formats: ['jpeg', 'webp'] })

    const jpgKeys = result.filter((e) => e.relativePath === 'hero.jpg')
    assertEquals(
      jpgKeys.length,
      1,
      'requesting the original format again must never create a 2nd hero.jpg entry',
    )
  },
)

Deno.test(
  'optimizeImageAsset: breakpoints + formats — three-tier rule: a format variant is judged ' +
    'against ITS OWN breakpoint reference, never the global original nor another format',
  async () => {
    const source = await gradientJpeg(2000, 1500, 100)
    const result = await optimizeImageAsset('hero.jpg', source, {
      breakpoints: ['msm'],
      formats: ['webp', 'avif'],
    })

    const original = findEntry(result, 'hero.jpg')
    assertExists(original)
    assertEquals(
      original.bytes,
      source,
      'breakpoints/formats specified — original must stay untouched',
    )

    const msmJpg = findEntry(result, 'hero.msm.jpg')
    const msmWebp = findEntry(result, 'hero.msm.webp')
    const msmAvif = findEntry(result, 'hero.msm.avif')
    assertExists(
      msmJpg,
      'the msm/jpeg tier-1 reference should win against the much bigger original',
    )
    assertExists(msmWebp)
    assertExists(msmAvif)

    // The format variants must be smaller than the MSM tier-1 reference specifically, not
    // merely smaller than the (much bigger) global original — the discriminating assertion for
    // the 3-tier rule: a candidate that beat the global original but LOST against its own
    // breakpoint tier would be a real bug this test would catch.
    assert(msmWebp.bytes.byteLength < msmJpg.bytes.byteLength)
    assert(msmAvif.bytes.byteLength < msmJpg.bytes.byteLength)

    const meta = await sharp(msmWebp.bytes).metadata()
    assertEquals(
      meta.width,
      360,
      'the webp variant must be resized to the SAME breakpoint width as its jpeg reference',
    )
  },
)

Deno.test(
  'optimizeImageAsset: metadata (EXIF/ICC) is stripped without ever calling .withMetadata()',
  async () => {
    const withExif = await sharp({
      create: { width: 300, height: 200, channels: 3, background: { r: 10, g: 20, b: 30 } },
    })
      .jpeg({ quality: 90 })
      .withMetadata({ exif: { IFD0: { Copyright: 'secret-author' } } })
      .toBuffer()
    const sourceMeta = await sharp(withExif).metadata()
    assert(sourceMeta.exif, 'sanity check: the fixture really does carry EXIF data')

    const result = await optimizeImageAsset('hero.jpg', withExif, true)
    const optimizedMeta = await sharp(result[0].bytes).metadata()
    assert(!optimizedMeta.exif, 'expected EXIF to be stripped from the optimized output')
  },
)

Deno.test(
  'optimizeImageAsset: an unsupported source format (not jpeg/png/webp/avif) passes through ' +
    'completely untouched',
  async () => {
    // A 1x1 GIF (not one of the 4 formats this pipeline re-encodes).
    const gifBytes = new Uint8Array([
      0x47,
      0x49,
      0x46,
      0x38,
      0x39,
      0x61,
      1,
      0,
      1,
      0,
      0,
      0,
      0,
      0x21,
      0xf9,
      0x04,
      1,
      0,
      0,
      0,
      0,
      0x2c,
      0,
      0,
      0,
      0,
      1,
      0,
      1,
      0,
      0,
      2,
      2,
      0x44,
      1,
      0,
      0x3b,
    ])
    const result = await optimizeImageAsset('anim.gif', gifBytes, {
      breakpoints: ['msm'],
      formats: ['webp'],
    })

    assertEquals(result.length, 1, 'no variants for an unsupported format, regardless of options')
    assertEquals(result[0].relativePath, 'anim.gif')
    assertEquals(result[0].bytes, gifBytes)
  },
)

Deno.test(
  'optimizeImageAsset: a raw numeric breakpoint (no preset name) resolves and emits under ' +
    'its own w<width> key',
  async () => {
    const source = await gradientJpeg(2000, 1500, 100)
    const result = await optimizeImageAsset('hero.jpg', source, { breakpoints: [500] })

    const variant = findEntry(result, 'hero.w500.jpg')
    assertExists(variant)
    const meta = await sharp(variant.bytes).metadata()
    assertEquals(meta.width, 500)
  },
)
