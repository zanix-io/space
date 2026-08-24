import { assertEquals, assertStringIncludes } from '@std/assert'
import { fromFileUrl, join } from '@std/path'
import { getTemporaryFolder } from '@zanix/helpers'
import { createCachedVideoTranscoder } from 'modules/media/cached-video-transcoder.ts'
import { createInMemoryTransformCacheStore } from 'modules/assets/transform-cache-store.ts'
import type {
  ThumbnailOptions,
  ThumbnailResult,
  TranscodeInput,
  TranscodeOptions,
  TranscodeResult,
  VideoTranscoder,
} from 'modules/media/video-transcoder.ts'

const ROOT = fromFileUrl(import.meta.resolve('../../../../'))

async function tempDir(prefix: string): Promise<string> {
  return await Deno.makeTempDir({ dir: getTemporaryFolder(import.meta.url), prefix })
}

/** A fake `VideoTranscoder` — never touches a real ffmpeg. `transcodeCalls`/`thumbnailCalls`
 * count real invocations, the one thing this whole test suite needs to observe: did the
 * decorator actually call through, or did it serve a cache hit. */
function createFakeTranscoder(
  behavior: {
    transcodeOutcome?: 'optimized' | 'never-worsened' | 'passthrough'
    thumbnailBytes?: Uint8Array
  } = {},
) {
  const outcome = behavior.transcodeOutcome ?? 'optimized'
  const calls = { transcode: 0, thumbnail: 0 }

  const transcoder: VideoTranscoder = {
    probe: () => Promise.resolve({ available: true }),

    async transcode(input: TranscodeInput, options: TranscodeOptions): Promise<TranscodeResult> {
      calls.transcode++
      const sourceBytes = await Deno.readFile(input.sourcePath)

      if (outcome === 'passthrough') {
        await Deno.writeFile(options.outputPath, sourceBytes)
        return {
          outputPath: options.outputPath,
          bytesWritten: sourceBytes.byteLength,
          mimeType: 'video/mp4',
          passthrough: true,
          neverWorsened: false,
        }
      }
      if (outcome === 'never-worsened') {
        await Deno.writeFile(options.outputPath, sourceBytes)
        return {
          outputPath: options.outputPath,
          bytesWritten: sourceBytes.byteLength,
          mimeType: 'video/mp4',
          passthrough: false,
          neverWorsened: true,
        }
      }
      // 'optimized' — a deterministic, real-looking transform of the source's own bytes, so two
      // DIFFERENT sources never accidentally produce the same "optimized" output.
      const produced = new Uint8Array([...sourceBytes, 0xaa, 0xbb])
      await Deno.writeFile(options.outputPath, produced)
      return {
        outputPath: options.outputPath,
        bytesWritten: produced.byteLength,
        mimeType: 'video/mp4',
        passthrough: false,
        neverWorsened: false,
      }
    },

    async extractThumbnail(
      _input: TranscodeInput,
      options: ThumbnailOptions,
    ): Promise<ThumbnailResult> {
      calls.thumbnail++
      const bytes = behavior.thumbnailBytes ?? new Uint8Array([1, 2, 3])
      await Deno.writeFile(options.outputPath, bytes)
      return {
        outputPath: options.outputPath,
        bytesWritten: bytes.byteLength,
        mimeType: 'image/jpeg',
      }
    },
  }

  return { transcoder, calls }
}

// --- transcode(): the requested idempotency matrix -----------------------------------------------

Deno.test(
  'transcode(): same source + same policy -> the second call makes ZERO real transcode calls',
  async () => {
    const dir = await tempDir('cached-transcode-idempotent-')
    try {
      const sourcePath = join(dir, 'source.mp4')
      await Deno.writeFile(sourcePath, new Uint8Array([1, 2, 3, 4, 5]))
      const { transcoder, calls } = createFakeTranscoder()
      const cached = createCachedVideoTranscoder(transcoder, createInMemoryTransformCacheStore())

      const outputPath1 = join(dir, 'output1.mp4')
      const outputPath2 = join(dir, 'output2.mp4')
      const first = await cached.transcode({ sourcePath }, {
        breakpoint: 'msm',
        outputPath: outputPath1,
      })
      const second = await cached.transcode({ sourcePath }, {
        breakpoint: 'msm',
        outputPath: outputPath1,
      })

      assertEquals(calls.transcode, 1, 'the real transcoder must be called exactly once')
      assertEquals(second.bytesWritten, first.bytesWritten)
      // A DIFFERENT outputPath (never requested before) must still get the SAME cached bytes.
      const third = await cached.transcode({ sourcePath }, {
        breakpoint: 'msm',
        outputPath: outputPath2,
      })
      assertEquals(
        calls.transcode,
        1,
        'a hit at a new outputPath must still avoid a real transcode',
      )
      assertEquals(await Deno.readFile(outputPath2), await Deno.readFile(outputPath1))
      assertEquals(third.bytesWritten, first.bytesWritten)
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
)

Deno.test(
  'transcode(): a changed SOURCE reprocesses (different content -> different hash)',
  async () => {
    const dir = await tempDir('cached-transcode-source-changed-')
    try {
      const sourcePath = join(dir, 'source.mp4')
      const outputPath = join(dir, 'output.mp4')
      const { transcoder, calls } = createFakeTranscoder()
      const cached = createCachedVideoTranscoder(transcoder, createInMemoryTransformCacheStore())

      await Deno.writeFile(sourcePath, new Uint8Array([1, 2, 3]))
      await cached.transcode({ sourcePath }, { breakpoint: 'msm', outputPath })
      assertEquals(calls.transcode, 1)

      // Same path, REAL bytes changed underneath it.
      await Deno.writeFile(sourcePath, new Uint8Array([9, 9, 9]))
      await cached.transcode({ sourcePath }, { breakpoint: 'msm', outputPath })
      assertEquals(calls.transcode, 2, 'a changed source must trigger a real reprocess')
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
)

Deno.test('transcode(): a changed POLICY VERSION reprocesses', async () => {
  const dir = await tempDir('cached-transcode-policy-changed-')
  try {
    const sourcePath = join(dir, 'source.mp4')
    const outputPath = join(dir, 'output.mp4')
    await Deno.writeFile(sourcePath, new Uint8Array([1, 2, 3]))
    const { transcoder, calls } = createFakeTranscoder()
    const store = createInMemoryTransformCacheStore()

    const cachedV1 = createCachedVideoTranscoder(transcoder, store, {
      transcodePolicyVersion: 'v1',
    })
    await cachedV1.transcode({ sourcePath }, { breakpoint: 'msm', outputPath })
    assertEquals(calls.transcode, 1)

    // Same source, same breakpoint/format, but the CALIBRATION policy changed (e.g. v1 -> v2).
    const cachedV2 = createCachedVideoTranscoder(transcoder, store, {
      transcodePolicyVersion: 'v2',
    })
    await cachedV2.transcode({ sourcePath }, { breakpoint: 'msm', outputPath })
    assertEquals(calls.transcode, 2, 'a policy version bump must trigger a real reprocess')
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
})

Deno.test('transcode(): a changed BREAKPOINT reprocesses', async () => {
  const dir = await tempDir('cached-transcode-breakpoint-changed-')
  try {
    const sourcePath = join(dir, 'source.mp4')
    const outputPath = join(dir, 'output.mp4')
    await Deno.writeFile(sourcePath, new Uint8Array([1, 2, 3]))
    const { transcoder, calls } = createFakeTranscoder()
    const cached = createCachedVideoTranscoder(transcoder, createInMemoryTransformCacheStore())

    await cached.transcode({ sourcePath }, { breakpoint: 'msm', outputPath })
    assertEquals(calls.transcode, 1)

    await cached.transcode({ sourcePath }, { breakpoint: 'dlg', outputPath })
    assertEquals(calls.transcode, 2, 'a different breakpoint must trigger a real reprocess')
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
})

Deno.test('transcode(): a changed FORMAT reprocesses', async () => {
  const dir = await tempDir('cached-transcode-format-changed-')
  try {
    const sourcePath = join(dir, 'source.mp4')
    const outputPath1 = join(dir, 'output.mp4')
    const outputPath2 = join(dir, 'output.webm')
    await Deno.writeFile(sourcePath, new Uint8Array([1, 2, 3]))
    const { transcoder, calls } = createFakeTranscoder()
    const cached = createCachedVideoTranscoder(transcoder, createInMemoryTransformCacheStore())

    await cached.transcode({ sourcePath }, {
      breakpoint: 'msm',
      format: 'mp4',
      outputPath: outputPath1,
    })
    assertEquals(calls.transcode, 1)

    await cached.transcode({ sourcePath }, {
      breakpoint: 'msm',
      format: 'webm',
      outputPath: outputPath2,
    })
    assertEquals(calls.transcode, 2, 'a different output format must trigger a real reprocess')
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
})

Deno.test(
  'transcode(): "never worsened" -> a second call never retries ffmpeg, and copies the ORIGINAL',
  async () => {
    const dir = await tempDir('cached-transcode-never-worsened-')
    try {
      const sourcePath = join(dir, 'source.mp4')
      const outputPath1 = join(dir, 'output1.mp4')
      const outputPath2 = join(dir, 'output2.mp4')
      const sourceBytes = new Uint8Array([7, 7, 7, 7])
      await Deno.writeFile(sourcePath, sourceBytes)

      const { transcoder, calls } = createFakeTranscoder({ transcodeOutcome: 'never-worsened' })
      const cached = createCachedVideoTranscoder(transcoder, createInMemoryTransformCacheStore())

      const first = await cached.transcode({ sourcePath }, {
        breakpoint: 'msm',
        outputPath: outputPath1,
      })
      assertEquals(calls.transcode, 1)
      assertEquals(first.neverWorsened, true)
      assertEquals(await Deno.readFile(outputPath1), sourceBytes)

      const second = await cached.transcode({ sourcePath }, {
        breakpoint: 'msm',
        outputPath: outputPath2,
      })
      assertEquals(calls.transcode, 1, 'a never-worsened result must never be retried')
      assertEquals(second.neverWorsened, true)
      assertEquals(await Deno.readFile(outputPath2), sourceBytes)
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
)

Deno.test(
  'transcode(): ffmpeg-unavailable passthrough is NEVER cached -> a later call still tries for real',
  async () => {
    const dir = await tempDir('cached-transcode-passthrough-not-cached-')
    try {
      const sourcePath = join(dir, 'source.mp4')
      const outputPath = join(dir, 'output.mp4')
      await Deno.writeFile(sourcePath, new Uint8Array([1, 2, 3]))

      const { transcoder, calls } = createFakeTranscoder({ transcodeOutcome: 'passthrough' })
      const cached = createCachedVideoTranscoder(transcoder, createInMemoryTransformCacheStore())

      await cached.transcode({ sourcePath }, {
        breakpoint: 'msm',
        outputPath,
        onUnavailable: 'passthrough',
      })
      await cached.transcode({ sourcePath }, {
        breakpoint: 'msm',
        outputPath,
        onUnavailable: 'passthrough',
      })

      assertEquals(
        calls.transcode,
        2,
        'an environment-level passthrough must never be treated as a cache hit',
      )
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
)

Deno.test(
  'transcode(): a corrupt/incompatible cache entry (bytes missing from the store) recomputes safely',
  async () => {
    const dir = await tempDir('cached-transcode-corrupt-')
    try {
      const sourcePath = join(dir, 'source.mp4')
      const outputPath = join(dir, 'output.mp4')
      await Deno.writeFile(sourcePath, new Uint8Array([1, 2, 3]))

      const { transcoder, calls } = createFakeTranscoder()
      const store = createInMemoryTransformCacheStore()
      const cached = createCachedVideoTranscoder(transcoder, store)

      await cached.transcode({ sourcePath }, { breakpoint: 'msm', outputPath })
      assertEquals(calls.transcode, 1)

      // Simulate a store whose index says "done" but whose byte-store lost the payload — a real
      // corruption/incompatibility shape (setEntry survived, setBytes's own file didn't).
      const sourceHash = await (await import('modules/assets/transform-cache.ts')).hashSourceBytes(
        new Uint8Array([1, 2, 3]),
      )
      const key = `${sourceHash}:video:msm:mp4:v1`
      await store.setEntry(key, { status: 'optimized', bytesWritten: 999 }) // never matches real getBytes

      await cached.transcode({ sourcePath }, { breakpoint: 'msm', outputPath })
      assertEquals(
        calls.transcode,
        2,
        'a cache entry whose bytes cannot be materialized must recompute',
      )
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
)

// --- extractThumbnail(): the same matrix, independently versioned --------------------------------

Deno.test(
  'extractThumbnail(): same source + same policy -> the second call makes ZERO real thumbnail extractions',
  async () => {
    const dir = await tempDir('cached-thumbnail-idempotent-')
    try {
      const sourcePath = join(dir, 'source.mp4')
      await Deno.writeFile(sourcePath, new Uint8Array([1, 2, 3]))
      const { transcoder, calls } = createFakeTranscoder()
      const cached = createCachedVideoTranscoder(transcoder, createInMemoryTransformCacheStore())

      const outputPath1 = join(dir, 'thumb1.jpg')
      const outputPath2 = join(dir, 'thumb2.jpg')
      const first = await cached.extractThumbnail({ sourcePath }, { outputPath: outputPath1 })
      await cached.extractThumbnail({ sourcePath }, { outputPath: outputPath1 })
      assertEquals(calls.thumbnail, 1)

      const third = await cached.extractThumbnail({ sourcePath }, { outputPath: outputPath2 })
      assertEquals(
        calls.thumbnail,
        1,
        'a hit at a new outputPath must still avoid a real extraction',
      )
      assertEquals(third.bytesWritten, first.bytesWritten)
      assertEquals(await Deno.readFile(outputPath2), await Deno.readFile(outputPath1))
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
)

Deno.test('extractThumbnail(): a changed atSeconds/width/format reprocesses', async () => {
  const dir = await tempDir('cached-thumbnail-params-changed-')
  try {
    const sourcePath = join(dir, 'source.mp4')
    const outputPath = join(dir, 'thumb.jpg')
    await Deno.writeFile(sourcePath, new Uint8Array([1, 2, 3]))
    const { transcoder, calls } = createFakeTranscoder()
    const cached = createCachedVideoTranscoder(transcoder, createInMemoryTransformCacheStore())

    await cached.extractThumbnail({ sourcePath }, { outputPath, atSeconds: 1 })
    assertEquals(calls.thumbnail, 1)
    await cached.extractThumbnail({ sourcePath }, { outputPath, atSeconds: 5 })
    assertEquals(calls.thumbnail, 2, 'a different atSeconds must trigger a real reprocess')
    await cached.extractThumbnail({ sourcePath }, { outputPath, atSeconds: 5, width: 320 })
    assertEquals(calls.thumbnail, 3, 'a different width must trigger a real reprocess')
    await cached.extractThumbnail({ sourcePath }, {
      outputPath,
      atSeconds: 5,
      width: 320,
      format: 'png',
    })
    assertEquals(calls.thumbnail, 4, 'a different format must trigger a real reprocess')
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
})

Deno.test(
  'extractThumbnail(): a changed thumbnail POLICY VERSION reprocesses independently of the transcode policy',
  async () => {
    const dir = await tempDir('cached-thumbnail-policy-changed-')
    try {
      const sourcePath = join(dir, 'source.mp4')
      const outputPath = join(dir, 'thumb.jpg')
      await Deno.writeFile(sourcePath, new Uint8Array([1, 2, 3]))
      const { transcoder, calls } = createFakeTranscoder()
      const store = createInMemoryTransformCacheStore()

      const cachedV1 = createCachedVideoTranscoder(transcoder, store, {
        thumbnailPolicyVersion: 'v1',
      })
      await cachedV1.extractThumbnail({ sourcePath }, { outputPath })
      assertEquals(calls.thumbnail, 1)

      const cachedV2 = createCachedVideoTranscoder(transcoder, store, {
        thumbnailPolicyVersion: 'v2',
      })
      await cachedV2.extractThumbnail({ sourcePath }, { outputPath })
      assertEquals(calls.thumbnail, 2, 'a thumbnail policy bump must trigger a real reprocess')

      // And bumping the TRANSCODE policy must never affect an already-cached thumbnail.
      const cachedV2Transcode = createCachedVideoTranscoder(transcoder, store, {
        thumbnailPolicyVersion: 'v2',
        transcodePolicyVersion: 'v99',
      })
      await cachedV2Transcode.extractThumbnail({ sourcePath }, { outputPath })
      assertEquals(
        calls.thumbnail,
        2,
        'a transcode-only policy bump must not affect the thumbnail cache',
      )
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
)

Deno.test(
  'extractThumbnail(): a corrupt/incompatible cache entry recomputes safely',
  async () => {
    const dir = await tempDir('cached-thumbnail-corrupt-')
    try {
      const sourcePath = join(dir, 'source.mp4')
      const outputPath = join(dir, 'thumb.jpg')
      await Deno.writeFile(sourcePath, new Uint8Array([1, 2, 3]))

      const { transcoder, calls } = createFakeTranscoder()
      const store = createInMemoryTransformCacheStore()
      const cached = createCachedVideoTranscoder(transcoder, store)

      await cached.extractThumbnail({ sourcePath }, { outputPath })
      assertEquals(calls.thumbnail, 1)

      const { hashSourceBytes } = await import('modules/assets/transform-cache.ts')
      const sourceHash = await hashSourceBytes(new Uint8Array([1, 2, 3]))
      const key = `${sourceHash}:thumbnail:1:jpeg:v1`
      await store.setEntry(key, { status: 'optimized', bytesWritten: 999 })

      await cached.extractThumbnail({ sourcePath }, { outputPath })
      assertEquals(
        calls.thumbnail,
        2,
        'a cache entry whose bytes cannot be materialized must recompute',
      )
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
)

// --- extractThumbnail({format:'webp'}): the same guarantees, explicitly named — webp is a first-
// class, officially supported thumbnail format, not a second-tier one that only happens to work
// through the generic format-change tests above.

Deno.test(
  'extractThumbnail(webp): same source + same policy + same dimensions -> ZERO real calls on repeat',
  async () => {
    const dir = await tempDir('cached-thumbnail-webp-idempotent-')
    try {
      const sourcePath = join(dir, 'source.mp4')
      await Deno.writeFile(sourcePath, new Uint8Array([1, 2, 3]))
      const { transcoder, calls } = createFakeTranscoder()
      const cached = createCachedVideoTranscoder(transcoder, createInMemoryTransformCacheStore())

      const outputPath1 = join(dir, 'thumb1.webp')
      const outputPath2 = join(dir, 'thumb2.webp')
      const first = await cached.extractThumbnail(
        { sourcePath },
        { outputPath: outputPath1, atSeconds: 1, width: 240, format: 'webp' },
      )
      assertEquals(calls.thumbnail, 1)

      const second = await cached.extractThumbnail(
        { sourcePath },
        { outputPath: outputPath2, atSeconds: 1, width: 240, format: 'webp' },
      )
      assertEquals(calls.thumbnail, 1, 'a repeat webp request must never call the real transcoder')
      assertEquals(second.mimeType, 'image/webp')
      assertEquals(second.bytesWritten, first.bytesWritten)
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
)

Deno.test(
  'extractThumbnail: jpeg <-> webp are INDEPENDENT transforms — no transformId collision either direction',
  async () => {
    const dir = await tempDir('cached-thumbnail-jpeg-webp-independent-')
    try {
      const sourcePath = join(dir, 'source.mp4')
      await Deno.writeFile(sourcePath, new Uint8Array([1, 2, 3]))
      const { transcoder, calls } = createFakeTranscoder()
      const cached = createCachedVideoTranscoder(transcoder, createInMemoryTransformCacheStore())

      const jpegPath = join(dir, 'thumb.jpg')
      const webpPath = join(dir, 'thumb.webp')

      // jpeg first, webp second — webp must be a real, independent call, not a false cache hit.
      await cached.extractThumbnail({ sourcePath }, { outputPath: jpegPath, format: 'jpeg' })
      assertEquals(calls.thumbnail, 1)
      await cached.extractThumbnail({ sourcePath }, { outputPath: webpPath, format: 'webp' })
      assertEquals(calls.thumbnail, 2, 'jpeg -> webp must be a real, independent transform')

      // And each direction stays independently cached — repeating either one is still a hit.
      await cached.extractThumbnail({ sourcePath }, { outputPath: jpegPath, format: 'jpeg' })
      assertEquals(calls.thumbnail, 2, 'repeating jpeg after webp must still be a cache hit')
      await cached.extractThumbnail({ sourcePath }, { outputPath: webpPath, format: 'webp' })
      assertEquals(calls.thumbnail, 2, 'repeating webp after jpeg must still be a cache hit')

      // Reverse order too — webp first, jpeg second, symmetric guarantee.
      const store2 = createInMemoryTransformCacheStore()
      const { transcoder: transcoder2, calls: calls2 } = createFakeTranscoder()
      const cached2 = createCachedVideoTranscoder(transcoder2, store2)
      await cached2.extractThumbnail({ sourcePath }, { outputPath: webpPath, format: 'webp' })
      assertEquals(calls2.thumbnail, 1)
      await cached2.extractThumbnail({ sourcePath }, { outputPath: jpegPath, format: 'jpeg' })
      assertEquals(
        calls2.thumbnail,
        2,
        'webp -> jpeg must equally be a real, independent transform',
      )
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
)

Deno.test(
  'extractThumbnail(webp): a changed THUMBNAIL_TRANSFORM_POLICY_VERSION invalidates the cached webp too',
  async () => {
    const dir = await tempDir('cached-thumbnail-webp-policy-changed-')
    try {
      const sourcePath = join(dir, 'source.mp4')
      const outputPath = join(dir, 'thumb.webp')
      await Deno.writeFile(sourcePath, new Uint8Array([1, 2, 3]))
      const { transcoder, calls } = createFakeTranscoder()
      const store = createInMemoryTransformCacheStore()

      const cachedV1 = createCachedVideoTranscoder(transcoder, store, {
        thumbnailPolicyVersion: 'v1',
      })
      await cachedV1.extractThumbnail({ sourcePath }, { outputPath, format: 'webp' })
      assertEquals(calls.thumbnail, 1)
      // Same policy, same everything — a real cache hit, sanity-checked before the bump.
      await cachedV1.extractThumbnail({ sourcePath }, { outputPath, format: 'webp' })
      assertEquals(calls.thumbnail, 1)

      const cachedV2 = createCachedVideoTranscoder(transcoder, store, {
        thumbnailPolicyVersion: 'v2',
      })
      await cachedV2.extractThumbnail({ sourcePath }, { outputPath, format: 'webp' })
      assertEquals(calls.thumbnail, 2, 'a thumbnail policy bump must invalidate a cached webp too')
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
)

// =================================================================================================
// REAL end-to-end: createCachedVideoTranscoder(createSystemFfmpegTranscoder(), ...) — the actual
// production composition, against a real (fake, deterministic) ffmpeg binary + a real persisted
// file store, in an isolated subprocess. Closes the "cierra WebP completamente" requirement: these
// prove the guarantees hold for the REAL transcoder/decorator pair, never only for the in-process
// fake used above.
// =================================================================================================

/** Writes a real, executable fake `ffmpeg`/`ffprobe` pair into `binDir`. `-encoders` returns
 * `encodersOutput` verbatim (controls `capabilities.webpEncoder`); `-version` succeeds; any other
 * invocation is a real "encode" call — counted (one line appended to `counterFile`) and completed
 * by writing a few bytes to its own last argument (always the real output path). Same technique
 * `system-ffmpeg-transcoder.test.ts`'s own `runIsolatedWithFakeFfmpeg` already establishes. */
async function writeFakeFfmpegBinaries(
  binDir: string,
  encodersOutput: string,
  counterFile: string,
): Promise<void> {
  const fakeFfmpeg = join(binDir, 'ffmpeg')
  await Deno.writeTextFile(
    fakeFfmpeg,
    `#!/bin/sh
for arg in "$@"; do
  if [ "$arg" = "-encoders" ]; then
    cat <<'EOF'
${encodersOutput}
EOF
    exit 0
  fi
  if [ "$arg" = "-version" ]; then
    echo "ffmpeg version fake"
    exit 0
  fi
done
echo "call" >> "${counterFile}"
for last; do :; done
printf '\\xff\\xd8\\xfake' > "$last"
exit 0
`,
  )
  await Deno.chmod(fakeFfmpeg, 0o755)
  const fakeFfprobe = join(binDir, 'ffprobe')
  await Deno.writeTextFile(fakeFfprobe, '#!/bin/sh\nexit 0\n')
  await Deno.chmod(fakeFfprobe, 0o755)
}

async function runRealCachedIsolated(
  scriptBody: string,
  encodersOutput: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const binDir = await Deno.makeTempDir({
    dir: getTemporaryFolder(import.meta.url),
    prefix: 'real-cached-fake-ffmpeg-bin-',
  })
  const dir = await Deno.makeTempDir({
    dir: getTemporaryFolder(import.meta.url),
    prefix: 'real-cached-isolated-',
  })
  try {
    const counterFile = join(dir, 'calls.log')
    await Deno.writeTextFile(counterFile, '')
    await writeFakeFfmpegBinaries(binDir, encodersOutput, counterFile)

    const path = join(dir, 'script.ts')
    await Deno.writeTextFile(
      path,
      `// deno-coverage-ignore-file
import { createSystemFfmpegTranscoder } from '${ROOT}src/modules/media/system-ffmpeg-transcoder.ts'
import { createCachedVideoTranscoder } from '${ROOT}src/modules/media/cached-video-transcoder.ts'
import { createFileTransformCacheStore } from '${ROOT}src/modules/assets/transform-cache-store.ts'
const cacheDir = ${JSON.stringify(join(dir, 'cache'))}
const outDir = ${JSON.stringify(join(dir, 'out'))}
await Deno.mkdir(outDir, { recursive: true })
const sourcePath = ${JSON.stringify(join(dir, 'source.mp4'))}
await Deno.writeFile(sourcePath, new Uint8Array([1, 2, 3, 4, 5]))
const cached = createCachedVideoTranscoder(
  createSystemFfmpegTranscoder(),
  createFileTransformCacheStore(cacheDir),
)
${scriptBody}
`,
    )
    const { code, stdout, stderr } = await new Deno.Command(Deno.execPath(), {
      args: [
        'run',
        '--allow-all',
        '--no-check',
        '--no-prompt',
        '--minimum-dependency-age=0',
        '--config',
        join(ROOT, 'deno.jsonc'),
        path,
      ],
      cwd: ROOT,
      env: { PATH: `${binDir}:/usr/bin:/bin` },
    }).output()
    const callCount = (await Deno.readTextFile(counterFile)).split('\n').filter(Boolean).length
    return {
      code,
      stdout: new TextDecoder().decode(stdout) + `\nCALL_COUNT=${callCount}`,
      stderr: new TextDecoder().decode(stderr),
    }
  } finally {
    await Deno.remove(dir, { recursive: true })
    await Deno.remove(binDir, { recursive: true })
  }
}

const REAL_ENCODERS_WITH_WEBP = 'V..... libx264\nA..... aac\nV..... libvpx-vp9\nA..... libopus\n' +
  'V....D libwebp              libwebp WebP image (codec webp)\n'
const REAL_ENCODERS_WITHOUT_WEBP = 'V..... libx264\nA..... aac\nV..... libvpx-vp9\nA..... libopus\n'

Deno.test(
  'REAL createCachedVideoTranscoder(createSystemFfmpegTranscoder()): webp — same source/policy/' +
    'dimensions -> the real fake ffmpeg binary is invoked exactly ONCE across two calls',
  async () => {
    const { code, stdout, stderr } = await runRealCachedIsolated(
      `
const out1 = outDir + '/thumb1.webp'
const out2 = outDir + '/thumb2.webp'
const webpOpts = { atSeconds: 1, width: 240, format: 'webp' }
await cached.extractThumbnail({ sourcePath }, { outputPath: out1, ...webpOpts })
await cached.extractThumbnail({ sourcePath }, { outputPath: out2, ...webpOpts })
console.log('DONE')
`,
      REAL_ENCODERS_WITH_WEBP,
    )

    assertEquals(code, 0, `expected success, not a crash:\n${stderr}\n${stdout}`)
    assertStringIncludes(stdout, 'CALL_COUNT=1')
  },
)

Deno.test(
  'REAL createCachedVideoTranscoder(createSystemFfmpegTranscoder()): jpeg then webp -> TWO real ' +
    'calls, never a false cache hit across formats',
  async () => {
    const { code, stdout, stderr } = await runRealCachedIsolated(
      `
const jpegPath = outDir + '/thumb.jpg'
const webpPath = outDir + '/thumb.webp'
await cached.extractThumbnail({ sourcePath }, { outputPath: jpegPath, format: 'jpeg' })
await cached.extractThumbnail({ sourcePath }, { outputPath: webpPath, format: 'webp' })
console.log('DONE')
`,
      REAL_ENCODERS_WITH_WEBP,
    )

    assertEquals(code, 0, `expected success, not a crash:\n${stderr}\n${stdout}`)
    assertStringIncludes(stdout, 'CALL_COUNT=2')
  },
)

Deno.test(
  'REAL createCachedVideoTranscoder(createSystemFfmpegTranscoder()): a THUMBNAIL_TRANSFORM_POLICY_' +
    'VERSION bump forces a real second call for an otherwise identical webp request',
  async () => {
    const { code, stdout, stderr } = await runRealCachedIsolated(
      `
const opts = { outputPath: outDir + '/thumb.webp', format: 'webp' }
const cachedV1 = createCachedVideoTranscoder(
  createSystemFfmpegTranscoder(),
  createFileTransformCacheStore(cacheDir),
  { thumbnailPolicyVersion: 'v1' },
)
await cachedV1.extractThumbnail({ sourcePath }, opts)
await cachedV1.extractThumbnail({ sourcePath }, opts)
const cachedV2 = createCachedVideoTranscoder(
  createSystemFfmpegTranscoder(),
  createFileTransformCacheStore(cacheDir),
  { thumbnailPolicyVersion: 'v2' },
)
await cachedV2.extractThumbnail({ sourcePath }, opts)
console.log('DONE')
`,
      REAL_ENCODERS_WITH_WEBP,
    )

    assertEquals(code, 0, `expected success, not a crash:\n${stderr}\n${stdout}`)
    // v1 twice (1 real call) + v2 once (1 real call) = 2 total real calls.
    assertStringIncludes(stdout, 'CALL_COUNT=2')
  },
)

Deno.test(
  'REAL createCachedVideoTranscoder(createSystemFfmpegTranscoder()): webp unavailable -> NO ' +
    'fallback, no output file, ZERO real ffmpeg encode calls, specific error surfaces through the cache',
  async () => {
    const { code, stdout, stderr } = await runRealCachedIsolated(
      `
const outputPath = outDir + '/thumb.webp'
try {
  await cached.extractThumbnail({ sourcePath }, { outputPath, format: 'webp' })
  console.log('NO_THROW')
} catch (error) {
  console.log('THREW:' + error.message)
}
let exists = true
try { await Deno.stat(outputPath) } catch { exists = false }
console.log('OUTPUT_EXISTS=' + exists)
`,
      REAL_ENCODERS_WITHOUT_WEBP,
    )

    assertEquals(code, 0, `expected a reported result, not a crash:\n${stderr}\n${stdout}`)
    assertStringIncludes(stdout, 'THREW:System ffmpeg is missing WebP encoder support')
    assertStringIncludes(stdout, 'OUTPUT_EXISTS=false')
    // The capability check happens before ever invoking a real "encode" — confirmed by a zero
    // count, not just "it threw" (a thrown error alone wouldn't rule out a wasted real attempt).
    assertStringIncludes(stdout, 'CALL_COUNT=0')
  },
)
