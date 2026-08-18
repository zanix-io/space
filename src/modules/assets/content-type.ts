/**
 * A small, bounded lookup table by file extension — no new dependency. Covers the asset types
 * `assetsDir` is meant for (images, fonts, and other static content a component/page references by
 * path), not an exhaustive MIME database. `application/octet-stream` (a safe, generic binary
 * default — never guessed as `text/*`, which could enable content-sniffing in a browser) covers
 * anything not listed here.
 *
 * @module
 */
const CONTENT_TYPES: Record<string, string> = {
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json',
  '.pdf': 'application/pdf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
}

/** Resolves `path`'s own extension (case-insensitive) to a `Content-Type` header value —
 * `application/octet-stream` for anything not in the table above. */
export function contentTypeFor(path: string): string {
  const dot = path.lastIndexOf('.')
  const extension = dot === -1 ? '' : path.slice(dot).toLowerCase()
  return CONTENT_TYPES[extension] ?? 'application/octet-stream'
}
