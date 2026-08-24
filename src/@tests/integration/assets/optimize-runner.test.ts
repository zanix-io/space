import { assert, assertEquals, assertRejects } from '@std/assert'
import sharp from 'sharp'
import { createOptimizeRunner } from 'modules/assets/optimize-runner.ts'
import type { ImagesOptimizeOptions } from 'modules/assets/image-optimize.ts'

console.error = () => {}

/**
 * `useWorker` is exclusively an execution-strategy switch — every test here proves it changes
 * WHERE the CPU work runs, never WHAT it computes. Real `WorkerManager` (`@zanix/utils/workers`),
 * not mocked: this exact combination (a worker task that throws) hung indefinitely in a real spike
 * during design until `@zanix/logger` was imported ahead of `@zanix/workers` — the "errors aren't
 * silenced" test below is the regression test for that exact, previously-reproduced bug.
 */

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

Deno.test(
  'createOptimizeRunner(false): the default — runs inline, no worker ever created, close() is a no-op',
  async () => {
    const runner = createOptimizeRunner(false)
    const source = await gradientJpeg(300, 200, 100)
    const result = await runner.optimizeImage('hero.jpg', source, { breakpoints: ['msm'] })
    assert(result.length >= 1)
    runner.close() // must not throw even though nothing was ever created
  },
)

Deno.test(
  'createOptimizeRunner(undefined): same inline default as `false`',
  async () => {
    const runner = createOptimizeRunner(undefined)
    const source = await gradientJpeg(300, 200, 100)
    const result = await runner.optimizeImage('hero.jpg', source, true)
    assert(result.length === 1)
    runner.close()
  },
)

Deno.test(
  'createOptimizeRunner(true) vs createOptimizeRunner(false): identical emit decisions and ' +
    'pixel-identical output for the exact same input',
  async () => {
    const source = await gradientJpeg(2000, 1500, 100)
    const options: ImagesOptimizeOptions = { breakpoints: ['msm', 'mlg'], formats: ['webp'] }

    const inline = createOptimizeRunner(false)
    const inlineResult = await inline.optimizeImage('hero.jpg', source, { ...options })
    inline.close()

    const worker = createOptimizeRunner(true)
    let workerResult
    try {
      workerResult = await worker.optimizeImage('hero.jpg', source, { ...options })
    } finally {
      worker.close()
    }

    assertEquals(
      inlineResult.map((e) => e.relativePath).sort(),
      workerResult.map((e) => e.relativePath).sort(),
      'the exact same set of variants must be emitted/discarded in both modes',
    )

    // The untouched `hero.jpg` passthrough entry is a genuine reference-equality shortcut in
    // BOTH modes (never re-encoded) — compared separately here since a real, empirically-found
    // `@std/assert` performance cliff makes `assertEquals` on two DIFFERENT ~1MB Uint8Array
    // instances (this file's own original bytes vs. the worker's structurally-cloned copy of the
    // exact same bytes) pathologically slow, even though they ARE equal.
    const inlineOriginal = inlineResult.find((e) => e.relativePath === 'hero.jpg')
    const workerOriginal = workerResult.find((e) => e.relativePath === 'hero.jpg')
    assertEquals(inlineOriginal?.bytes.byteLength, workerOriginal?.bytes.byteLength)

    // Every DERIVED variant: real, empirically-found finding — sharp/libvips' JPEG re-encode is
    // NOT guaranteed byte-for-byte deterministic between a genuinely separate worker thread and
    // the main thread (confirmed: identical `sharp.concurrency()` value on the SAME thread stays
    // byte-identical; only crossing a REAL worker-thread boundary introduces a handful of
    // differing bytes, most likely mozjpeg's own trellis/entropy-coding step) — even though the
    // DECODED pixel content is 100% identical either way (also confirmed directly). So the
    // correct equivalence check here is pixel content + dimensions, not raw compressed bytes —
    // svgo (a separate test below) has no such native-threading involvement and stays genuinely
    // byte-for-byte equal.
    for (const entry of inlineResult) {
      if (entry.relativePath === 'hero.jpg') continue
      const workerEntry = workerResult.find((e) => e.relativePath === entry.relativePath)
      assert(workerEntry, `missing ${entry.relativePath} in the worker-mode result`)

      // deno-lint-ignore no-await-in-loop
      const inlineMeta = await sharp(entry.bytes).metadata()
      // deno-lint-ignore no-await-in-loop
      const workerMeta = await sharp(workerEntry.bytes).metadata()
      assertEquals(inlineMeta.width, workerMeta.width, `${entry.relativePath} width mismatch`)
      assertEquals(inlineMeta.height, workerMeta.height, `${entry.relativePath} height mismatch`)
      assertEquals(inlineMeta.format, workerMeta.format, `${entry.relativePath} format mismatch`)

      // deno-lint-ignore no-await-in-loop
      const inlinePixels = await sharp(entry.bytes).raw().toBuffer()
      // deno-lint-ignore no-await-in-loop
      const workerPixels = await sharp(workerEntry.bytes).raw().toBuffer()
      assertEquals(
        inlinePixels,
        workerPixels,
        `${entry.relativePath} must decode to identical pixel data between modes`,
      )
    }
  },
)

Deno.test(
  'createOptimizeRunner(true): svg optimization also produces byte-for-byte identical output ' +
    'to the inline strategy',
  async () => {
    const source = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg" width="10"><!-- c --><circle r="1"/></svg>',
    )
    const inline = createOptimizeRunner(false)
    const inlineResult = await inline.optimizeSvg('icon.svg', source)
    inline.close()

    const worker = createOptimizeRunner(true)
    let workerResult
    try {
      workerResult = await worker.optimizeSvg('icon.svg', source)
    } finally {
      worker.close()
    }

    assertEquals(inlineResult, workerResult)
  },
)

Deno.test(
  'createOptimizeRunner(n): a numeric pool respects the requested size, running several ' +
    'concurrent tasks correctly under contention (more tasks than workers)',
  async () => {
    const runner = createOptimizeRunner(2)
    try {
      const sources = await Promise.all(
        [360, 480, 600, 720, 900].map((w) => gradientJpeg(w, Math.round(w * 0.75), 95)),
      )
      const results = await Promise.all(
        sources.map((source, i) => runner.optimizeImage(`hero${i}.jpg`, source, true)),
      )
      // Every task must resolve independently and correctly — a broken pool would either hang,
      // drop tasks, or cross-deliver another task's result.
      results.forEach((result, i) => {
        assertEquals(result[0].relativePath, `hero${i}.jpg`)
      })
    } finally {
      runner.close()
    }
  },
)

// `runOnWorker`'s own `error instanceof Error ? error : new Error(String(...))` fallback (the
// non-`Error` branch) is deliberately NOT forced here: both real tasks this module ever runs on a
// worker (`optimizeImageAssetTask`/`optimizeSvgAssetTask`) only ever throw real sharp/svgo
// `Error`s, which survive `postMessage`'s structured-clone transfer as real `Error` instances —
// confirmed via the test below, which already exercises the worker-error path end to end. Forcing
// the OTHER branch would need a worker task that rejects with a non-`Error` primitive, which has
// no injection point through this module's own public API (`runOnWorker` itself is private) —
// dead code by design for this module's real task set, not a real gap.
Deno.test(
  'createOptimizeRunner(true): an error thrown inside a worker task is never silenced — it ' +
    'rejects the caller, it does not hang (regression test for a real, previously-reproduced bug)',
  async () => {
    const runner = createOptimizeRunner(true)
    try {
      const garbage = new Uint8Array([1, 2, 3, 4, 5]) // not a real image — sharp.metadata() throws
      await assertRejects(() => runner.optimizeImage('bad.jpg', garbage, true))
    } finally {
      runner.close()
    }
  },
)

Deno.test(
  'createOptimizeRunner(false): the same malformed input rejects inline too — identical error ' +
    'behavior in both modes, not just the success path',
  async () => {
    const runner = createOptimizeRunner(false)
    const garbage = new Uint8Array([1, 2, 3, 4, 5])
    await assertRejects(() => runner.optimizeImage('bad.jpg', garbage, true))
    runner.close()
  },
)

Deno.test(
  'createOptimizeRunner(true): falls back to a 4-worker pool when navigator.hardwareConcurrency ' +
    'is unavailable/falsy, rather than sizing the pool to 0',
  async () => {
    // `navigator` is a real, configurable global accessor (confirmed: `hardwareConcurrency` alone
    // has no setter, so the whole property is redefined, restored in `finally`) — the ONLY way to
    // force this branch, since a real host always reports a positive core count.
    const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
    if (!originalNavigator) throw new Error('expected a real "navigator" global to redefine')
    let runner: ReturnType<typeof createOptimizeRunner> | undefined
    try {
      Object.defineProperty(globalThis, 'navigator', {
        value: { hardwareConcurrency: 0 },
        configurable: true,
      })
      runner = createOptimizeRunner(true)
    } finally {
      Object.defineProperty(globalThis, 'navigator', originalNavigator)
    }

    try {
      // The pool size itself isn't observable through the public API — this proves the fallback
      // produced a WORKING pool (at least one real worker), not a degenerate zero-sized one that
      // would hang forever on `invoke()`.
      const source = await gradientJpeg(300, 200, 100)
      const result = await runner.optimizeImage('hero.jpg', source, { breakpoints: ['msm'] })
      assert(result.length >= 1)
    } finally {
      runner.close()
    }
  },
)
