import { assert, assertEquals, assertRejects } from '@std/assert'
import { HttpError } from '@zanix/errors'
import { readAllBytes, readBoundedBytes } from 'modules/assets-api/read-all-bytes.ts'

function streamFrom(...chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk)
      controller.close()
    },
  })
}

// --- readAllBytes: unchanged behavior, still real ------------------------------------------------

Deno.test('readAllBytes: a Uint8Array input is returned as-is', async () => {
  const bytes = new Uint8Array([1, 2, 3])
  assertEquals(await readAllBytes(bytes), bytes)
})

Deno.test(
  'readAllBytes: a multi-chunk stream is merged into one contiguous Uint8Array',
  async () => {
    const merged = await readAllBytes(
      streamFrom(new Uint8Array([1, 2]), new Uint8Array([3, 4, 5])),
    )
    assertEquals([...merged], [1, 2, 3, 4, 5])
  },
)

// --- readBoundedBytes: Uint8Array input ------------------------------------------------------------

Deno.test('readBoundedBytes: a Uint8Array within the cap is returned as-is', async () => {
  const bytes = new Uint8Array([1, 2, 3])
  assertEquals(await readBoundedBytes(bytes, 3), bytes)
})

Deno.test(
  'readBoundedBytes: a Uint8Array over the cap throws PAYLOAD_TOO_LARGE immediately, no stream ' +
    'involved',
  async () => {
    const bytes = new Uint8Array([1, 2, 3, 4])
    const error = await assertRejects(() => readBoundedBytes(bytes, 3), HttpError)
    assertEquals(error.status.code, 'PAYLOAD_TOO_LARGE')
  },
)

// --- readBoundedBytes: stream input, within the cap ------------------------------------------------

Deno.test(
  'readBoundedBytes: a streamed upload within the cap is buffered normally, byte-identical to ' +
    'readAllBytes',
  async () => {
    const merged = await readBoundedBytes(
      streamFrom(new Uint8Array([1, 2]), new Uint8Array([3, 4, 5])),
      5,
    )
    assertEquals([...merged], [1, 2, 3, 4, 5])
  },
)

// --- readBoundedBytes: stream input, exceeding the cap mid-read — the real defense, since a ------
// caller may have sent no Content-Length at all (chunked transfer-encoding) or lied about it. ------

Deno.test(
  'readBoundedBytes: a streamed upload that exceeds the cap mid-read is aborted — the reader is ' +
    'cancelled, never drained to completion first, and a real PAYLOAD_TOO_LARGE is thrown',
  async () => {
    let cancelled = false
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]))
        controller.enqueue(new Uint8Array([4, 5, 6, 7, 8]))
        // A third chunk that must never actually be read — proves the drain stops the INSTANT
        // the cap is exceeded (on the second chunk, 3 + 5 = 8 > 5), not merely before returning.
        controller.enqueue(new Uint8Array([9, 10]))
        controller.close()
      },
      cancel() {
        cancelled = true
      },
    })

    const error = await assertRejects(() => readBoundedBytes(stream, 5), HttpError)
    assertEquals(error.status.code, 'PAYLOAD_TOO_LARGE')
    assert(cancelled, 'the underlying stream must be cancelled, never drained to completion first')
  },
)

Deno.test(
  'readBoundedBytes: exactly at the cap (not one byte over) succeeds — the boundary is inclusive',
  async () => {
    const merged = await readBoundedBytes(streamFrom(new Uint8Array([1, 2, 3])), 3)
    assertEquals([...merged], [1, 2, 3])
  },
)
