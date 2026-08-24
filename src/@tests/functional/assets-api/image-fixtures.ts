// deno-coverage-ignore-file

import sharp from 'sharp'

/**
 * Shared image-fixture helpers for `image-upload-s3.test.ts`/`image-upload-s3-never-worsened.test.ts`
 * — split into their OWN files (not separate `Deno.test` blocks in one file) per the
 * "its own file, one real server boot" convention `voice-upload-deny.test.ts` already establishes:
 * `deno test` runs each file in its own isolated worker, so two server boots sharing one process
 * (and one `webServerManager`/port 8000) never interfere — confirmed the hard way, this exact
 * `Connection refused` symptom is what happens when that convention is skipped.
 */

/** Deterministic, spatially-structured fixture (diagonal gradient + sine texture) — same as
 * `image-optimize.test.ts`'s own `gradientRaw`/`gradientJpeg`: real photographic-like content lets
 * a quality-based re-encode genuinely win or lose against the source, unlike flat/solid color. */
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

export async function gradientJpeg(
  width: number,
  height: number,
  quality: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const buffer = await sharp(gradientRaw(width, height), { raw: { width, height, channels: 3 } })
    .jpeg({ quality })
    .toBuffer()
  // Re-wrapped into a concretely `ArrayBuffer`-backed view — `sharp`'s own `Buffer` return type
  // is a `Uint8Array<ArrayBufferLike>`, which `fetch`'s `BodyInit` doesn't structurally accept
  // even though it's real bytes at runtime (same reasoning `S3ObjectStorage`'s own
  // `checksumOf`/`readAllBytes` already document for this exact TS quirk).
  return new Uint8Array(buffer)
}
