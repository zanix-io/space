/**
 * Buffers a `Uint8Array | ReadableStream<Uint8Array>` into one real `Uint8Array` — the one shared
 * helper every adapter that needs full bytes (to hash, to write to a temp file for ffmpeg, to
 * persist as a single blob) reuses, instead of each re-deriving its own stream-draining loop.
 *
 * {@linkcode readBoundedBytes} is the same drain, with a real byte cap enforced WHILE buffering —
 * the actual defense against an unbounded upload (`asset-service.ts`'s own `createAsset()` is the
 * one real caller: a client-supplied `Content-Length` is optional and spoofable, so the cap has to
 * be enforced against the REAL bytes read, not just checked against a header once up front). It's a
 * thin wrapper over `@zanix/helpers`'s framework-neutral `assertContentLengthWithinLimit`/
 * `readBoundedStream` (promoted from this exact pattern existing independently in both
 * `@zanix/server` and `@zanix/space`) — this module's only job is translating the plain
 * `ApplicationError` those throw into the `HttpError('PAYLOAD_TOO_LARGE')` shape this package's own
 * callers/tests already depend on.
 *
 * @module
 */

import { ApplicationError, HttpError } from '@zanix/errors'
import { assertContentLengthWithinLimit, readBoundedStream } from '@zanix/helpers'

export async function readAllBytes(
  data: Uint8Array | ReadableStream<Uint8Array>,
): Promise<Uint8Array> {
  if (data instanceof Uint8Array) return data

  const chunks: Uint8Array[] = []
  const reader = data.getReader()
  // deno-lint-ignore no-await-in-loop
  for (let result = await reader.read(); !result.done; result = await reader.read()) {
    chunks.push(result.value)
  }

  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
  const merged = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return merged
}

/** The two size-limit codes {@linkcode assertContentLengthWithinLimit}/{@linkcode readBoundedStream}
 * (`@zanix/helpers`) throw as `ApplicationError` — the only ones this module converts into its own
 * `HttpError('PAYLOAD_TOO_LARGE')`. Any other error (a genuinely unexpected failure, not a
 * size-limit rejection) propagates unmodified instead of being mislabeled as one. */
const BODY_SIZE_LIMIT_CODES = new Set([
  'UTILS_NETWORK_CONTENT_LENGTH_TOO_LARGE',
  'UTILS_NETWORK_BODY_TOO_LARGE',
])

function payloadTooLargeError(maxBytes: number): HttpError {
  return new HttpError('PAYLOAD_TOO_LARGE', {
    meta: {
      source: 'zanix',
      reason: `Upload exceeded the ${maxBytes}-byte limit.`,
    },
  })
}

/**
 * Same drain as {@linkcode readAllBytes}, with a real byte cap enforced against bytes actually
 * read — never against a claimed size. A `Uint8Array` input is checked up front, since there's no
 * stream to cancel; a stream input is drained via `@zanix/helpers`'s `readBoundedStream`, which
 * cancels the reader (tearing the underlying stream down, never draining it to completion first)
 * the instant the running total exceeds `maxBytes`. Both paths throw a plain `ApplicationError`
 * internally — caught here and converted into this package's own `PAYLOAD_TOO_LARGE` `HttpError`;
 * any other error propagates unmodified.
 *
 * @throws {HttpError} `PAYLOAD_TOO_LARGE` once the accumulated byte count exceeds `maxBytes`.
 */
export async function readBoundedBytes(
  data: Uint8Array | ReadableStream<Uint8Array>,
  maxBytes: number,
): Promise<Uint8Array> {
  try {
    if (data instanceof Uint8Array) {
      assertContentLengthWithinLimit(data.byteLength, maxBytes)
      return data
    }
    return await readBoundedStream(data, maxBytes)
  } catch (error) {
    if (error instanceof ApplicationError && error.code && BODY_SIZE_LIMIT_CODES.has(error.code)) {
      throw payloadTooLargeError(maxBytes)
    }
    throw error
  }
}
