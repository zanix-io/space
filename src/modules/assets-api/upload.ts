/**
 * Reads an uploaded asset directly off the real, untouched `Request` — the confirmed, real answer
 * to "streaming-friendly upload" for this ecosystem: `@zanix/server`'s own request-body pipeline
 * (`bodyPayloadProperty`, `utils/routes.ts`) only auto-parses `application/json`/
 * `application/x-www-form-urlencoded` — anything else (a real file upload) is left completely
 * untouched on `HandlerContext.req`, so this reads `req.body` as a live `ReadableStream<Uint8Array>`
 * directly, never `await request.arrayBuffer()`. No multipart in v1 — one file per request, the
 * entire body IS the file; a filename, when the caller wants one recorded, travels via a header
 * (`@zanix/server` has no multipart support to parse a `filename` field out of otherwise).
 *
 * @module
 */

import { HttpError } from '@zanix/errors'

/** The real upload read directly off an untouched `Request` — see this module's own top-level doc. */
export interface UploadedAsset {
  /** The request body itself, unread and unbuffered. */
  stream: ReadableStream<Uint8Array>
  /** The request's own `Content-Type` header value. */
  contentType: string
  /** From the `X-Znx-Asset-Filename` header, when the client sent one. */
  filename?: string
  /** Only set when the client sent a real `Content-Length` — never assumed/computed here. */
  size?: number
}

// `X-Znx-`-prefixed, same as every other framework-owned header/cookie across the Zanix
// ecosystem (`X-Znx-Authorization`, `X-Znx-Admin-Protocol`, ...) — keeps a request header this
// package invents from colliding with a third-party proxy/CDN header of the same name.
const FILENAME_HEADER = 'X-Znx-Asset-Filename'

/**
 * @throws {HttpError} `BAD_REQUEST` when the request has no body, or no `Content-Type`.
 */
/** Reads an `UploadedAsset` off `req` without buffering — see this module's own top-level doc. */
export function readUploadedAssetFromRequest(req: Request): UploadedAsset {
  if (!req.body) {
    throw new HttpError('BAD_REQUEST', {
      meta: { source: 'zanix', reason: 'Request has no body to upload as an asset.' },
    })
  }
  const contentType = req.headers.get('content-type')
  if (!contentType) {
    throw new HttpError('BAD_REQUEST', {
      meta: { source: 'zanix', reason: 'Content-Type header is required for an asset upload.' },
    })
  }
  const contentLength = req.headers.get('content-length')

  return {
    stream: req.body,
    contentType,
    filename: req.headers.get(FILENAME_HEADER) ?? undefined,
    size: contentLength ? Number(contentLength) : undefined,
  }
}
