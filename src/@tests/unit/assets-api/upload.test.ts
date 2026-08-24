import { assert, assertEquals, assertThrows } from '@std/assert'
import { HttpError } from '@zanix/errors'
import { readUploadedAssetFromRequest } from 'modules/assets-api/upload.ts'

function streamFrom(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes)
      controller.close()
    },
  })
}

function requestWith(
  headers: Record<string, string>,
  hasBody = true,
): Request {
  return new Request('http://localhost/assets/audio', {
    method: 'POST',
    headers,
    body: hasBody ? streamFrom(new Uint8Array([1, 2, 3])) : undefined,
    // A real streamed body needs `duplex: 'half'` in Deno's own fetch-compatible Request — same
    // requirement a real upload has.
    duplex: hasBody ? 'half' : undefined,
  } as RequestInit)
}

Deno.test(
  'readUploadedAssetFromRequest: a request with no body throws BAD_REQUEST',
  () => {
    const req = requestWith({}, false)
    const error = assertThrows(
      () => readUploadedAssetFromRequest(req),
      HttpError,
    )
    assertEquals(error.status.code, 'BAD_REQUEST')
    assertEquals(error.meta?.reason, 'Request has no body to upload as an asset.')
  },
)

Deno.test(
  'readUploadedAssetFromRequest: a request with a body but no Content-Type throws BAD_REQUEST',
  () => {
    const req = requestWith({})
    const error = assertThrows(
      () => readUploadedAssetFromRequest(req),
      HttpError,
    )
    assertEquals(error.status.code, 'BAD_REQUEST')
    assertEquals(
      error.meta?.reason,
      'Content-Type header is required for an asset upload.',
    )
  },
)

Deno.test(
  'readUploadedAssetFromRequest: filename is undefined when the caller sends no ' +
    'X-Znx-Asset-Filename header',
  () => {
    const req = requestWith({ 'content-type': 'audio/wav' })
    const asset = readUploadedAssetFromRequest(req)

    assertEquals(asset.contentType, 'audio/wav')
    assertEquals(asset.filename, undefined)
  },
)

Deno.test(
  'readUploadedAssetFromRequest: filename is read from X-Znx-Asset-Filename when the caller ' +
    'sends it',
  () => {
    const req = requestWith({
      'content-type': 'audio/wav',
      'X-Znx-Asset-Filename': 'voice.wav',
    })
    const asset = readUploadedAssetFromRequest(req)

    assertEquals(asset.filename, 'voice.wav')
  },
)

Deno.test(
  'readUploadedAssetFromRequest: size is undefined when the caller sends no Content-Length',
  () => {
    const req = requestWith({ 'content-type': 'audio/wav' })
    const asset = readUploadedAssetFromRequest(req)

    assertEquals(asset.size, undefined)
  },
)

Deno.test(
  'readUploadedAssetFromRequest: size is the parsed Content-Length when the caller sends one',
  () => {
    const req = requestWith({ 'content-type': 'audio/wav', 'content-length': '3' })
    const asset = readUploadedAssetFromRequest(req)

    assertEquals(asset.size, 3)
  },
)

Deno.test(
  'readUploadedAssetFromRequest: the real request body stream is exposed unchanged',
  async () => {
    const req = requestWith({ 'content-type': 'audio/wav' })
    const asset = readUploadedAssetFromRequest(req)

    const reader = asset.stream.getReader()
    const { value } = await reader.read()
    assert(value)
    assertEquals([...value], [1, 2, 3])
  },
)
