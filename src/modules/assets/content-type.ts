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
  // Added for `isAudioAsset`'s own completeness (classification only — see that function's own
  // doc for why only `.wav` is actually TRANSFORMABLE by this framework's own voice policy today).
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.opus': 'audio/opus',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  // The rest of the legacy `zjs-cli` media pipeline's own video container allowlist
  // (`videos/config.ts`) — added here rather than in a second, video-only table, so
  // `detectVideoSource` (`video-source.ts`) has exactly one place to ask "is this a video file
  // extension" instead of duplicating this list. `.m3u8` is deliberately NOT included: the legacy
  // pipeline listed it as an input format but never actually produced HLS segments/manifests for
  // it — carrying the entry forward would just re-plant the same dead code here.
  '.ogv': 'video/ogg',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.flv': 'video/x-flv',
  '.wmv': 'video/x-ms-wmv',
  '.m4v': 'video/x-m4v',
  '.mpeg': 'video/mpeg',
  '.mpg': 'video/mpeg',
  '.3gp': 'video/3gpp',
  '.3g2': 'video/3gpp2',
  '.avi': 'video/x-msvideo',
}

/** Resolves `path`'s own extension (case-insensitive) to a `Content-Type` header value —
 * `application/octet-stream` for anything not in the table above. */
export function contentTypeFor(path: string): string {
  const dot = path.lastIndexOf('.')
  const extension = dot === -1 ? '' : path.slice(dot).toLowerCase()
  return CONTENT_TYPES[extension] ?? 'application/octet-stream'
}

/** Whether `path`'s own extension is a recognized VIDEO format — reuses this module's own single
 * `CONTENT_TYPES` table (never a second, duplicated video-extension list) by checking its
 * resolved mime type's own `video/` prefix. Used by `mediaPlugin` (`modules/bundler/media-plugin.
 * ts`) to decide which scanned `assetsDir` entries are even candidates for video transcoding —
 * mirrors `assetsPlugin`'s own `OPTIMIZABLE_IMAGE_EXTENSIONS.has(ext)` check, just derived from
 * the shared table instead of a second hardcoded set. `audio/*`/`image/*` entries (e.g. `.mp3`,
 * `.svg`) are deliberately excluded — video optimization only, not asked for otherwise. */
export function isVideoAsset(path: string): boolean {
  return contentTypeFor(path).startsWith('video/')
}

/** Whether `path`'s own extension is a recognized AUDIO format — same reasoning/table reuse as
 * {@linkcode isVideoAsset}. Broad CLASSIFICATION only (`.mp3`, `.opus`, `.flac`, ... all count) —
 * NOT a statement about what this framework can actually TRANSFORM. `modules/media/audio/
 * policies/voice.ts`'s own `isVoiceSource` is the narrower, transformation-eligibility check
 * (`.wav` only, deliberately conservative — see that function's own doc); `mediaPlugin` gates real
 * voice optimization on THAT function, never on this one. */
export function isAudioAsset(path: string): boolean {
  return contentTypeFor(path).startsWith('audio/')
}
