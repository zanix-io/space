/**
 * Video-provider detection, kept deliberately UI-agnostic (no JSX, no renderer) so both
 * `@zanix/space` (build/server code) and a future `@zanix/space-ui` `Video` component can share
 * exactly one detection pass. Pure and synchronous — never throws, never does I/O or network
 * access, just classifies a `src` string.
 *
 * Detection covers YouTube/Vimeo with id extraction, a generic-URL fallback for any other
 * provider (Facebook/Instagram/Twitter/TikTok included — deliberately NOT given first-class
 * provider status here), and a file-extension fallback for a local/CDN video file.
 *
 * Design notes:
 * - {@linkcode DetectedVideoSource} is a discriminated union (`type: 'provider' | 'iframe' |
 *   'file' | 'unknown'`) rather than a flat `platform/*`-vs-mimetype string union with an
 *   always-optional `id` — a consumer can narrow on `type` and, for `'provider'`, get `id`
 *   guaranteed present, since the regex has already proven a capture group exists whenever that
 *   variant is produced.
 * - Facebook/Instagram/Twitter/TikTok are not detected with their own per-platform regex that
 *   extracts an `id` — nothing downstream reads a per-platform id for any of the four, only the
 *   raw, un-rewritten iframe `src`, so extracting one would only add dead code.
 * - The generic-URL fallback uses real `URL` parsing ({@linkcode isEmbeddableUrl}) rather than a
 *   hand-rolled regex: it accepts both `http:` and `https:` symmetrically (never a bare relative
 *   path — that would already have been claimed by the file-extension check above it, or falls
 *   through to `'unknown'`).
 * - The file-extension check reuses `content-type.ts`'s own {@linkcode contentTypeFor} (which
 *   carries the full video container list) instead of a second, parallel extension table — and
 *   strips a query string/fragment first, so a real CDN URL like `clip.mp4?token=…` still resolves
 *   correctly.
 * - A URL whose extension is a known-but-unsupported media manifest format (currently only
 *   `.m3u8`) resolves to `'unknown'`, never `'iframe'`. `contentTypeFor` deliberately never lists
 *   `.m3u8` (see that module's own doc — `@zanix/space` doesn't implement HLS segmentation), so
 *   without this explicit check an absolute `https://…/stream.m3u8` URL would fall through to the
 *   generic-URL fallback and be misclassified as `'iframe'` — wrong on both counts a consumer
 *   could reasonably assume: it is not a web PAGE (a raw HLS manifest embedded in an `<iframe>`
 *   renders as garbled text or a download prompt, never a playable embed), and treating it as
 *   `'file'` would be equally wrong (`<video src="…m3u8">` only plays natively in Safari; every
 *   other browser needs a JS player this package doesn't ship). `'unknown'` is the only
 *   classification that doesn't imply a playback path this package can't actually deliver.
 *
 * @module
 */

import { contentTypeFor } from './content-type.ts'

/** A video provider `@zanix/space` gives first-class embed support to — its own id-extraction
 * regex and its own {@linkcode buildProviderEmbedUrl} query-parameter builder. Any other video
 * host (Facebook, Instagram, Twitter/X, TikTok, or anything else) is still detected as an
 * embeddable URL, just not as a named provider — see {@linkcode DetectedVideoSource}'s `'iframe'`
 * variant. Loom/Twitch/Wistia and similar are deliberately NOT included here — no existing
 * consumer to justify them yet. */
export type VideoProvider = 'youtube' | 'vimeo'

/**
 * The result of classifying a `src` string. Exactly one of four shapes:
 * - `'provider'` — a YouTube or Vimeo URL, with its video id already extracted.
 * - `'iframe'` — some other absolute `http(s)` URL, embeddable as-is (Facebook, Instagram,
 *   Twitter/X, TikTok, or any other host `@zanix/space` doesn't special-case).
 * - `'file'` — a path/URL whose extension is a recognized video container, with its real
 *   `Content-Type` value already resolved.
 * - `'unknown'` — none of the above (an empty string, a bare non-URL string, an unrecognized
 *   extension on something that isn't an absolute URL either).
 */
export type DetectedVideoSource =
  | { type: 'provider'; provider: 'youtube'; id: string; src: string }
  | { type: 'provider'; provider: 'vimeo'; id: string; src: string }
  | { type: 'iframe'; src: string }
  | { type: 'file'; mimeType: string; src: string }
  | { type: 'unknown'; src: string }

// Both patterns accept an optional scheme/`www.` prefix.
const YOUTUBE_SOURCE_PATTERN =
  /^(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:embed\/|watch\?v=)|youtu\.be\/)([a-zA-Z0-9_-]+)/i
const VIMEO_SOURCE_PATTERN = /^(?:https?:\/\/)?(?:www\.)?vimeo\.com\/(\d+)/i

/** `contentTypeFor` operates on a bare path — strip a query string/fragment first so a real CDN
 * URL (`clip.mp4?token=…`) still resolves its extension correctly, then only accept the result if
 * it is actually a video MIME type (this table also holds image/font/document types, which are
 * never a valid `DetectedVideoSource`). */
function videoMimeTypeFor(src: string): string | undefined {
  const withoutQueryOrHash = src.split(/[?#]/, 1)[0]
  const mimeType = contentTypeFor(withoutQueryOrHash)
  return mimeType.startsWith('video/') ? mimeType : undefined
}

/** Real `URL` parsing, restricted to `http:`/`https:`. A relative path never qualifies: it either
 * already matched a video extension above, or isn't something this package can safely assume is
 * embeddable as a third-party iframe source. */
function isEmbeddableUrl(src: string): boolean {
  try {
    const url = new URL(src)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

/** Extensions that ARE a recognized video/media container, but one `@zanix/space` explicitly does
 * not support playing — see this module's own doc comment for the full `.m3u8` reasoning. Checked
 * BEFORE the generic-URL fallback, so an absolute URL ending in one of these never gets
 * misclassified as `'iframe'` just because it also happens to be a well-formed `http(s)` URL.
 * Deliberately just this one, confirmed case — NOT a general "any adaptive-streaming format"
 * rule; a DASH `.mpd` manifest, for example, is not covered here (no investigation has been done
 * for it), and would fall through to `'iframe'` today rather than being silently assumed safe. */
const UNSUPPORTED_MEDIA_EXTENSIONS = new Set(['m3u8'])

function hasUnsupportedMediaExtension(src: string): boolean {
  const withoutQueryOrHash = src.split(/[?#]/, 1)[0]
  const dot = withoutQueryOrHash.lastIndexOf('.')
  if (dot === -1) return false
  return UNSUPPORTED_MEDIA_EXTENSIONS.has(withoutQueryOrHash.slice(dot + 1).toLowerCase())
}

/**
 * Classifies `src` into a {@linkcode DetectedVideoSource}. Pure, synchronous, never throws.
 *
 * @example
 * ```ts
 * detectVideoSource('https://www.youtube.com/watch?v=AawFtdp0LRw')
 * // → { type: 'provider', provider: 'youtube', id: 'AawFtdp0LRw', src: '...' }
 *
 * detectVideoSource('https://youtu.be/abcdefghijk')
 * // → { type: 'provider', provider: 'youtube', id: 'abcdefghijk', src: '...' }
 *
 * detectVideoSource('https://vimeo.com/123456')
 * // → { type: 'provider', provider: 'vimeo', id: '123456', src: '...' }
 *
 * detectVideoSource('https://twitter.com/user/status/123456789')
 * // → { type: 'iframe', src: '...' } — Twitter/X stays generic
 *
 * detectVideoSource('/videos/clip.mp4')
 * // → { type: 'file', mimeType: 'video/mp4', src: '/videos/clip.mp4' }
 *
 * detectVideoSource('not a video source at all')
 * // → { type: 'unknown', src: '...' }
 * ```
 */
export function detectVideoSource(src: string): DetectedVideoSource {
  const trimmed = src.trim()
  if (trimmed === '') return { type: 'unknown', src: trimmed }

  const youtubeMatch = trimmed.match(YOUTUBE_SOURCE_PATTERN)
  if (youtubeMatch) {
    return { type: 'provider', provider: 'youtube', id: youtubeMatch[1], src: trimmed }
  }

  const vimeoMatch = trimmed.match(VIMEO_SOURCE_PATTERN)
  if (vimeoMatch) {
    return { type: 'provider', provider: 'vimeo', id: vimeoMatch[1], src: trimmed }
  }

  const mimeType = videoMimeTypeFor(trimmed)
  if (mimeType) return { type: 'file', mimeType, src: trimmed }

  if (hasUnsupportedMediaExtension(trimmed)) return { type: 'unknown', src: trimmed }

  if (isEmbeddableUrl(trimmed)) return { type: 'iframe', src: trimmed }

  return { type: 'unknown', src: trimmed }
}

/** {@linkcode buildProviderEmbedUrl} options for a YouTube provider source. */
export interface YoutubeEmbedOptions {
  /** Starts playback automatically. */
  autoplay?: boolean
  /** `false` hides the player's own UI controls. */
  controls?: boolean
  /** YouTube's real embed parameter is `mute`, unlike Vimeo's `muted` — see
   * {@linkcode VimeoEmbedOptions}'s own `muted` doc comment for the corresponding case on that
   * provider. */
  muted?: boolean
  /** YouTube only loops a *single* video when `playlist=<id>` is also present — `loop=1` alone is
   * silently ignored by YouTube's player. This builder always adds `playlist` itself when `loop`
   * is `true`, so the option actually does what its name says. */
  loop?: boolean
}

/** {@linkcode buildProviderEmbedUrl} options for a Vimeo provider source. */
export interface VimeoEmbedOptions {
  /** Starts playback automatically. */
  autoplay?: boolean
  /** `false` hides the player's own UI controls. */
  controls?: boolean
  /** Vimeo's real embed parameter is `muted`, not `mute` (YouTube's parameter name) — sending the
   * wrong name off a shared query-string template would silently do nothing on Vimeo. */
  muted?: boolean
  /** Loops playback once it reaches the end. */
  loop?: boolean
  /** Vimeo-only: no controls/UI chrome, intended for a looping ambient/background video. Has no
   * YouTube equivalent — exactly why embed options are typed per-provider instead of one shared
   * shape. */
  background?: boolean
}

function buildYoutubeEmbedUrl(id: string, options: YoutubeEmbedOptions | undefined): string {
  const params = new URLSearchParams()
  if (options?.autoplay) params.set('autoplay', '1')
  if (options?.controls === false) params.set('controls', '0')
  if (options?.muted) params.set('mute', '1')
  if (options?.loop) {
    params.set('loop', '1')
    params.set('playlist', id) // required by YouTube for a single video to actually loop
  }
  const query = params.toString()
  return `https://www.youtube.com/embed/${id}${query ? `?${query}` : ''}`
}

function buildVimeoEmbedUrl(id: string, options: VimeoEmbedOptions | undefined): string {
  const params = new URLSearchParams()
  if (options?.autoplay) params.set('autoplay', '1')
  if (options?.controls === false) params.set('controls', '0')
  if (options?.muted) params.set('muted', '1')
  if (options?.loop) params.set('loop', '1')
  if (options?.background) params.set('background', '1')
  const query = params.toString()
  return `https://player.vimeo.com/video/${id}${query ? `?${query}` : ''}`
}

/**
 * Builds the final embed URL for an already-detected `'provider'` source — the overloads below
 * make passing a `'file'`/`'iframe'`/`'unknown'` {@linkcode DetectedVideoSource} (there is no embed
 * URL for either) a compile-time error, never a runtime branch a caller has to remember to guard.
 * Each provider gets its own query-parameter builder rather than one shared option shape — see
 * {@linkcode YoutubeEmbedOptions}/{@linkcode VimeoEmbedOptions}'s own doc comments for the real
 * per-provider differences (`mute` vs `muted`, the `playlist` requirement for looping) that a
 * single shared shape would silently paper over.
 *
 * @example
 * ```ts
 * const detected = detectVideoSource('https://youtu.be/abcdefghijk')
 * if (detected.type === 'provider') {
 *   buildProviderEmbedUrl(detected, { autoplay: true, muted: true, loop: true })
 *   // → 'https://www.youtube.com/embed/abcdefghijk?autoplay=1&mute=1&loop=1&playlist=abcdefghijk'
 * }
 * ```
 */
export function buildProviderEmbedUrl(
  source: Extract<DetectedVideoSource, { type: 'provider'; provider: 'youtube' }>,
  options?: YoutubeEmbedOptions,
): string
/** Vimeo overload — see the primary signature's own doc above. */
export function buildProviderEmbedUrl(
  source: Extract<DetectedVideoSource, { type: 'provider'; provider: 'vimeo' }>,
  options?: VimeoEmbedOptions,
): string
/** Implementation signature — dispatches to the real per-provider builder. See the primary
 * signature's own doc above for the full contract. */
export function buildProviderEmbedUrl(
  source: Extract<DetectedVideoSource, { type: 'provider' }>,
  options?: YoutubeEmbedOptions | VimeoEmbedOptions,
): string {
  switch (source.provider) {
    case 'youtube':
      return buildYoutubeEmbedUrl(source.id, options as YoutubeEmbedOptions | undefined)
    case 'vimeo':
      return buildVimeoEmbedUrl(source.id, options as VimeoEmbedOptions | undefined)
  }
}
