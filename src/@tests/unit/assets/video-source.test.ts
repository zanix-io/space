import { assertEquals } from '@std/assert'
import {
  buildProviderEmbedUrl,
  type DetectedVideoSource,
  detectVideoSource,
} from 'modules/assets/video-source.ts'

// --- detectVideoSource: YouTube --------------------------------------------------------------

Deno.test(
  'detectVideoSource: a youtube.com watch URL resolves to provider youtube with its id',
  () => {
    assertEquals(detectVideoSource('https://www.youtube.com/watch?v=AawFtdp0LRw'), {
      type: 'provider',
      provider: 'youtube',
      id: 'AawFtdp0LRw',
      src: 'https://www.youtube.com/watch?v=AawFtdp0LRw',
    })
  },
)

Deno.test(
  'detectVideoSource: a youtu.be short URL resolves to provider youtube with its id',
  () => {
    assertEquals(detectVideoSource('https://youtu.be/abcdefghijk'), {
      type: 'provider',
      provider: 'youtube',
      id: 'abcdefghijk',
      src: 'https://youtu.be/abcdefghijk',
    })
  },
)

Deno.test(
  'detectVideoSource: a youtube.com/embed URL (with trailing query) still resolves its id',
  () => {
    const result = detectVideoSource('https://www.youtube.com/embed/AawFtdp0LRw?autoplay=1')
    assertEquals(result.type, 'provider')
    assertEquals(
      (result as Extract<DetectedVideoSource, { type: 'provider' }>).id,
      'AawFtdp0LRw',
    )
  },
)

Deno.test(
  'detectVideoSource: a scheme-less/www-less youtu.be URL still resolves (optional scheme)',
  () => {
    const result = detectVideoSource('youtu.be/abcdefghijk')
    assertEquals(result.type, 'provider')
  },
)

// --- detectVideoSource: Vimeo -----------------------------------------------------------------

Deno.test('detectVideoSource: a vimeo.com URL resolves to provider vimeo with its id', () => {
  assertEquals(detectVideoSource('https://vimeo.com/123456'), {
    type: 'provider',
    provider: 'vimeo',
    id: '123456',
    src: 'https://vimeo.com/123456',
  })
})

// --- generic providers collapse to 'iframe' (Facebook/Instagram/Twitter/TikTok) ----------------

Deno.test(
  'detectVideoSource: a Facebook video URL is NOT a first-class provider — collapses to iframe',
  () => {
    assertEquals(detectVideoSource('https://www.facebook.com/video.php?v=123456789'), {
      type: 'iframe',
      src: 'https://www.facebook.com/video.php?v=123456789',
    })
  },
)

Deno.test('detectVideoSource: an Instagram post URL collapses to iframe', () => {
  assertEquals(detectVideoSource('https://www.instagram.com/p/abc123'), {
    type: 'iframe',
    src: 'https://www.instagram.com/p/abc123',
  })
})

Deno.test('detectVideoSource: a Twitter/X status URL collapses to iframe', () => {
  assertEquals(detectVideoSource('https://twitter.com/user/status/123456789'), {
    type: 'iframe',
    src: 'https://twitter.com/user/status/123456789',
  })
})

Deno.test('detectVideoSource: a TikTok video URL collapses to iframe', () => {
  assertEquals(detectVideoSource('https://www.tiktok.com/@user/video/123456789'), {
    type: 'iframe',
    src: 'https://www.tiktok.com/@user/video/123456789',
  })
})

// --- detectVideoSource: file extensions ---------------------------------------------------------

Deno.test('detectVideoSource: an .mp4 URL resolves to file with its real MIME type', () => {
  assertEquals(detectVideoSource('https://example.com/video.mp4'), {
    type: 'file',
    mimeType: 'video/mp4',
    src: 'https://example.com/video.mp4',
  })
})

Deno.test('detectVideoSource: a .webm URL resolves to file with its real MIME type', () => {
  assertEquals(detectVideoSource('https://example.com/video.webm').type, 'file')
})

Deno.test(
  'detectVideoSource: a relative path with a recognized video extension resolves to file',
  () => {
    assertEquals(detectVideoSource('/videos/clip.mp4'), {
      type: 'file',
      mimeType: 'video/mp4',
      src: '/videos/clip.mp4',
    })
  },
)

Deno.test(
  'detectVideoSource: a query string after the extension does not break file classification',
  () => {
    const result = detectVideoSource('https://cdn.example.com/clip.mp4?token=abc123&x=1')
    assertEquals(result.type, 'file')
    assertEquals(
      (result as Extract<DetectedVideoSource, { type: 'file' }>).mimeType,
      'video/mp4',
    )
  },
)

Deno.test(
  'detectVideoSource: a fragment after the extension does not break file classification',
  () => {
    const result = detectVideoSource('https://cdn.example.com/clip.mp4#t=10')
    assertEquals(result.type, 'file')
  },
)

for (
  const [extension, mimeType] of [
    ['ogv', 'video/ogg'],
    ['mov', 'video/quicktime'],
    ['mkv', 'video/x-matroska'],
    ['flv', 'video/x-flv'],
    ['wmv', 'video/x-ms-wmv'],
    ['m4v', 'video/x-m4v'],
    ['mpeg', 'video/mpeg'],
    ['mpg', 'video/mpeg'],
    ['3gp', 'video/3gpp'],
    ['3g2', 'video/3gpp2'],
    ['avi', 'video/x-msvideo'],
  ] as const
) {
  Deno.test(
    `detectVideoSource: a .${extension} file (legacy allowlist) resolves to file/${mimeType}`,
    () => {
      assertEquals(detectVideoSource(`clip.${extension}`), {
        type: 'file',
        mimeType,
        src: `clip.${extension}`,
      })
    },
  )
}

Deno.test(
  'detectVideoSource: an absolute .m3u8 URL resolves to unknown, never iframe or file',
  () => {
    // No HLS segmentation/manifest generation ever existed behind this (legacy dead code, not
    // ported — see this module's own doc comment), and @zanix/space has no HLS player either. A
    // raw manifest is neither a playable file nor an embeddable web page, so 'unknown' is the only
    // classification that doesn't imply a playback path this package can't actually deliver.
    const result = detectVideoSource('https://example.com/stream.m3u8')
    assertEquals(result, { type: 'unknown', src: 'https://example.com/stream.m3u8' })
  },
)

Deno.test('detectVideoSource: a relative/bare .m3u8 path also resolves to unknown', () => {
  assertEquals(detectVideoSource('stream.m3u8'), { type: 'unknown', src: 'stream.m3u8' })
  assertEquals(detectVideoSource('/videos/stream.m3u8'), {
    type: 'unknown',
    src: '/videos/stream.m3u8',
  })
})

Deno.test('detectVideoSource: a query string/fragment after .m3u8 still resolves unknown', () => {
  const result = detectVideoSource('https://example.com/stream.m3u8?token=abc#t=10')
  assertEquals(result.type, 'unknown')
})

Deno.test('detectVideoSource: .m3u8 detection is case-insensitive, matching the file table', () => {
  assertEquals(detectVideoSource('https://example.com/stream.M3U8').type, 'unknown')
})

Deno.test('detectVideoSource: a non-video file extension is never misclassified as file', () => {
  assertEquals(detectVideoSource('https://example.com/logo.png').type, 'iframe')
})

// --- detectVideoSource: generic URL fallback + unknown -------------------------------------------

Deno.test(
  'detectVideoSource: an unrecognized https URL with no video extension resolves to iframe',
  () => {
    assertEquals(detectVideoSource('https://example.com/unknown'), {
      type: 'iframe',
      src: 'https://example.com/unknown',
    })
  },
)

Deno.test(
  'detectVideoSource: a plain http URL also resolves to iframe — fixes the legacy https-only bug',
  () => {
    assertEquals(detectVideoSource('http://example.com/unknown'), {
      type: 'iframe',
      src: 'http://example.com/unknown',
    })
  },
)

Deno.test('detectVideoSource: a non-URL string with an unrecognized extension is unknown', () => {
  assertEquals(detectVideoSource('video.unknown'), { type: 'unknown', src: 'video.unknown' })
})

Deno.test('detectVideoSource: a bare non-URL, non-extension string resolves to unknown', () => {
  assertEquals(detectVideoSource('not a video source at all'), {
    type: 'unknown',
    src: 'not a video source at all',
  })
})

Deno.test('detectVideoSource: an empty string resolves to unknown', () => {
  assertEquals(detectVideoSource(''), { type: 'unknown', src: '' })
})

Deno.test('detectVideoSource: a whitespace-only string resolves to unknown (trimmed)', () => {
  assertEquals(detectVideoSource('   '), { type: 'unknown', src: '' })
})

Deno.test('detectVideoSource: leading/trailing whitespace around a valid source is trimmed', () => {
  assertEquals(detectVideoSource('  https://vimeo.com/123456  '), {
    type: 'provider',
    provider: 'vimeo',
    id: '123456',
    src: 'https://vimeo.com/123456',
  })
})

Deno.test(
  'detectVideoSource: a non-http(s) scheme (e.g. ftp) never qualifies as embeddable',
  () => {
    assertEquals(detectVideoSource('ftp://example.com/file'), {
      type: 'unknown',
      src: 'ftp://example.com/file',
    })
  },
)

// `isEmbeddableUrl` restricts the generic fallback to `http:`/`https:` ONLY — these are the
// schemes that matter most to get right, since this is the src eventually handed to an <iframe>
// (see the IFrame component that consumes DetectedVideoSource downstream). `new URL()` happily
// parses all four of these, so the protocol check is load-bearing, not incidental.
Deno.test('detectVideoSource: a javascript: URL never qualifies as embeddable', () => {
  assertEquals(detectVideoSource('javascript:alert(1)'), {
    type: 'unknown',
    src: 'javascript:alert(1)',
  })
})

Deno.test('detectVideoSource: a data: URL never qualifies as embeddable', () => {
  const src = 'data:text/html,<script>alert(1)</script>'
  assertEquals(detectVideoSource(src), { type: 'unknown', src })
})

Deno.test('detectVideoSource: a file: URL never qualifies as embeddable', () => {
  assertEquals(detectVideoSource('file:///etc/passwd'), {
    type: 'unknown',
    src: 'file:///etc/passwd',
  })
})

Deno.test('detectVideoSource: a structurally invalid URL resolves to unknown, never throws', () => {
  assertEquals(detectVideoSource('://broken'), { type: 'unknown', src: '://broken' })
})

// --- buildProviderEmbedUrl: youtube --------------------------------------------------------------

Deno.test('buildProviderEmbedUrl: youtube with no options returns the bare embed URL', () => {
  const source = detectVideoSource('https://youtu.be/abcdefghijk')
  if (source.type !== 'provider' || source.provider !== 'youtube') throw new Error('setup failed')
  assertEquals(buildProviderEmbedUrl(source), 'https://www.youtube.com/embed/abcdefghijk')
})

Deno.test(
  'buildProviderEmbedUrl: youtube autoplay+muted set the real youtube "mute" parameter',
  () => {
    const source = detectVideoSource('https://youtu.be/abcdefghijk')
    if (source.type !== 'provider' || source.provider !== 'youtube') {
      throw new Error('setup failed')
    }
    const url = buildProviderEmbedUrl(source, { autoplay: true, muted: true })
    assertEquals(url, 'https://www.youtube.com/embed/abcdefghijk?autoplay=1&mute=1')
  },
)

Deno.test(
  'buildProviderEmbedUrl: youtube loop also adds playlist=<id> — fixes the legacy no-op bug',
  () => {
    const source = detectVideoSource('https://youtu.be/abcdefghijk')
    if (source.type !== 'provider' || source.provider !== 'youtube') {
      throw new Error('setup failed')
    }
    const url = buildProviderEmbedUrl(source, { loop: true })
    assertEquals(url, 'https://www.youtube.com/embed/abcdefghijk?loop=1&playlist=abcdefghijk')
  },
)

Deno.test('buildProviderEmbedUrl: youtube controls:false sends controls=0', () => {
  const source = detectVideoSource('https://youtu.be/abcdefghijk')
  if (source.type !== 'provider' || source.provider !== 'youtube') throw new Error('setup failed')
  assertEquals(
    buildProviderEmbedUrl(source, { controls: false }),
    'https://www.youtube.com/embed/abcdefghijk?controls=0',
  )
})

Deno.test(
  'buildProviderEmbedUrl: youtube controls:true (the default) adds no controls param',
  () => {
    const source = detectVideoSource('https://youtu.be/abcdefghijk')
    if (source.type !== 'provider' || source.provider !== 'youtube') {
      throw new Error('setup failed')
    }
    assertEquals(
      buildProviderEmbedUrl(source, { controls: true }),
      'https://www.youtube.com/embed/abcdefghijk',
    )
  },
)

// --- buildProviderEmbedUrl: vimeo ----------------------------------------------------------------

Deno.test('buildProviderEmbedUrl: vimeo with no options returns the bare player URL', () => {
  const source = detectVideoSource('https://vimeo.com/123456')
  if (source.type !== 'provider' || source.provider !== 'vimeo') throw new Error('setup failed')
  assertEquals(buildProviderEmbedUrl(source), 'https://player.vimeo.com/video/123456')
})

Deno.test(
  'buildProviderEmbedUrl: vimeo muted sends "muted" — fixes the legacy mute/muted bug',
  () => {
    const source = detectVideoSource('https://vimeo.com/123456')
    if (source.type !== 'provider' || source.provider !== 'vimeo') {
      throw new Error('setup failed')
    }
    assertEquals(
      buildProviderEmbedUrl(source, { muted: true }),
      'https://player.vimeo.com/video/123456?muted=1',
    )
  },
)

Deno.test('buildProviderEmbedUrl: vimeo controls:false sends controls=0', () => {
  const source = detectVideoSource('https://vimeo.com/123456')
  if (source.type !== 'provider' || source.provider !== 'vimeo') throw new Error('setup failed')
  assertEquals(
    buildProviderEmbedUrl(source, { controls: false }),
    'https://player.vimeo.com/video/123456?controls=0',
  )
})

Deno.test(
  'buildProviderEmbedUrl: vimeo loop never adds a playlist param (youtube-only requirement)',
  () => {
    const source = detectVideoSource('https://vimeo.com/123456')
    if (source.type !== 'provider' || source.provider !== 'vimeo') {
      throw new Error('setup failed')
    }
    assertEquals(
      buildProviderEmbedUrl(source, { loop: true }),
      'https://player.vimeo.com/video/123456?loop=1',
    )
  },
)

Deno.test(
  'buildProviderEmbedUrl: vimeo background is vimeo-only, with no youtube equivalent',
  () => {
    const source = detectVideoSource('https://vimeo.com/123456')
    if (source.type !== 'provider' || source.provider !== 'vimeo') {
      throw new Error('setup failed')
    }
    assertEquals(
      buildProviderEmbedUrl(source, { background: true }),
      'https://player.vimeo.com/video/123456?background=1',
    )
  },
)

Deno.test(
  'buildProviderEmbedUrl: multiple vimeo options combine into one query string, in call order',
  () => {
    const source = detectVideoSource('https://vimeo.com/123456')
    if (source.type !== 'provider' || source.provider !== 'vimeo') {
      throw new Error('setup failed')
    }
    const url = buildProviderEmbedUrl(source, { autoplay: true, muted: true, loop: true })
    assertEquals(url, 'https://player.vimeo.com/video/123456?autoplay=1&muted=1&loop=1')
  },
)

// --- discriminated union narrowing (compile-time contract) ---------------------------------------

Deno.test(
  'DetectedVideoSource: a file/iframe/unknown source narrows away id and provider entirely',
  () => {
    const file = detectVideoSource('clip.mp4')
    const iframe = detectVideoSource('https://example.com/unknown')
    const unknown = detectVideoSource('not a source')
    assertEquals('id' in file, false)
    assertEquals('provider' in iframe, false)
    assertEquals('id' in unknown, false)
  },
)
