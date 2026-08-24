/**
 * Magic-byte (file-signature) verification for the image kind — closes the gap where
 * `runImageTransformation` (`asset-service.ts`) trusted the client-supplied `Content-Type` header
 * alone, with nothing checking that the uploaded BYTES actually match it. Deliberately narrow: only
 * the three signatures the image allowlist (`IMAGE_EXTENSION_BY_CONTENT_TYPE`) already accepts, and
 * only for images — audio/video have the identical header-only-trust pattern today, deliberately
 * left unaddressed here (the `.wav`/mp4/webm surfaces are a separate, not-yet-scoped fix).
 *
 * No new dependency: every signature is a small, spec-verified byte table, matched by hand.
 *
 * @module
 */

/** One content-type's own real byte signature — `bytes` matched at `offset` (default `0`). */
interface Signature {
  offset: number
  bytes: number[]
}

// jpeg: `FF D8 FF` — the SOI marker plus the first marker byte of the segment that always follows
// it; every real JPEG file, regardless of variant/EXIF, starts this way.
// png: the fixed 8-byte signature the PNG spec itself defines (`0x89 'P' 'N' 'G' CR LF 0x1A LF`) —
// the trailing CR/LF/EOF bytes exist specifically to detect transport corruption, not just to
// identify the format.
// webp: a RIFF container — `'RIFF'` at offset 0, a 4-byte little-endian chunk size at offset 4
// (deliberately not checked here — it varies with file length, and the format tag alone is enough
// to confirm this is genuinely a RIFF/WEBP file), then `'WEBP'` at offset 8.
const IMAGE_SIGNATURES: Record<string, Signature[]> = {
  'image/jpeg': [{ offset: 0, bytes: [0xff, 0xd8, 0xff] }],
  'image/png': [{ offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] }],
  'image/webp': [
    { offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] }, // 'RIFF'
    { offset: 8, bytes: [0x57, 0x45, 0x42, 0x50] }, // 'WEBP'
  ],
}

function matchesAt(bytes: Uint8Array, signature: Signature): boolean {
  if (bytes.byteLength < signature.offset + signature.bytes.length) return false
  return signature.bytes.every((byte, i) => bytes[signature.offset + i] === byte)
}

/**
 * Whether `bytes` genuinely starts with `contentType`'s real file signature. `false` for a
 * `contentType` this table doesn't cover — the caller's own content-type allowlist
 * (`IMAGE_EXTENSION_BY_CONTENT_TYPE`) already rejects anything outside jpeg/png/webp before this
 * ever runs, so an unknown `contentType` reaching here would itself be a bug upstream, not a
 * legitimate "not verified" case.
 */
export function matchesImageSignature(bytes: Uint8Array, contentType: string): boolean {
  const signatures = IMAGE_SIGNATURES[contentType]
  if (!signatures) return false
  return signatures.every((signature) => matchesAt(bytes, signature))
}
