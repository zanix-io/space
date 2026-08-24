import { assert, assertEquals } from '@std/assert'
import { bootstrapServers, webServerManager } from '@zanix/server'
import { getTemporaryFolder } from '@zanix/helpers'
import { registerPwa } from 'modules/pwa/register-pwa.ts'
import { setPwaBuildOutput } from 'modules/pwa/pwa-registry.ts'
import { iconRoute, MANIFEST_ROUTE, SW_ROUTE } from 'modules/pwa/web-manifest.ts'

const TMP_ROOT = getTemporaryFolder(import.meta.url)

/**
 * Real `bootstrapServers()` + real `fetch()`, not a direct `handleGet` call — this is the one
 * place that actually proves `registerFixedRoute`'s manual `Get(path)(method)` +
 * `SsrController()(Target)` application (the same mechanism `Page()`'s own `registerPage` uses
 * internally, generalized to a method named `serve`) really registers a working route through
 * `@zanix/server`'s real dispatch, not just that the code compiles.
 *
 * `setPwaBuildOutput` (not `registerPwa`'s own config) is what tells `registerPwa` where to find
 * icons/sw.js — the exact mechanism this whole file exists to exercise; see `pwa-registry.ts`'s
 * own doc for the full reasoning (fixed, unhashed routes → a build-output DIRECTORY is enough,
 * never a source-to-hashed-URL manifest the way comets/CSS need).
 */
Deno.test(
  'registerPwa: serves a real manifest.webmanifest and a real icon file over HTTP',
  async () => {
    const root = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      await Deno.mkdir(`${root}/icons`, { recursive: true })
      await Deno.writeFile(
        `${root}/icons/icon-192.png`,
        new Uint8Array([1, 2, 3, 4]),
      )
      await Deno.writeTextFile(
        `${root}/sw.js`,
        "self.addEventListener('install', () => {})\n",
      )
      setPwaBuildOutput(root)

      registerPwa({
        name: 'Storefront',
        themeColor: '#2563eb',
        icon: './icon-source.png',
        iconSizes: [192, 512],
      })

      const servers = await bootstrapServers({ ssr: { port: 20901 } })
      try {
        const manifestRes = await fetch(
          `http://localhost:20901${MANIFEST_ROUTE}`,
        )
        assertEquals(manifestRes.status, 200)
        assertEquals(
          manifestRes.headers.get('content-type'),
          'application/manifest+json',
        )
        const manifest = await manifestRes.json()
        assertEquals(manifest.name, 'Storefront')
        assertEquals(manifest.theme_color, '#2563eb')

        const iconRes = await fetch(`http://localhost:20901${iconRoute(192)}`)
        assertEquals(iconRes.status, 200)
        assertEquals(iconRes.headers.get('content-type'), 'image/png')
        const iconBytes = new Uint8Array(await iconRes.arrayBuffer())
        assertEquals(iconBytes, new Uint8Array([1, 2, 3, 4]))

        // 512 was declared in iconSizes but no file was written for it on disk.
        const missingIconRes = await fetch(
          `http://localhost:20901${iconRoute(512)}`,
        )
        assertEquals(missingIconRes.status, 404)

        const swRes = await fetch(`http://localhost:20901${SW_ROUTE}`)
        assertEquals(swRes.status, 200)
        assertEquals(
          swRes.headers.get('content-type'),
          'application/javascript',
        )
        assertEquals(
          await swRes.text(),
          "self.addEventListener('install', () => {})\n",
        )
      } finally {
        await webServerManager.stop(servers)
      }
    } finally {
      setPwaBuildOutput(undefined)
      await Deno.remove(root, { recursive: true })
    }
  },
)

Deno.test(
  'registerPwa: with no iconSizes given, defaults to [192, 512] for route registration too',
  async () => {
    const root = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      await Deno.mkdir(`${root}/icons`, { recursive: true })
      await Deno.writeFile(
        `${root}/icons/icon-512.png`,
        new Uint8Array([9, 9]),
      )
      setPwaBuildOutput(root)

      registerPwa({ name: 'Defaults App', icon: './icon-source.png' })

      const servers = await bootstrapServers({ ssr: { port: 20902 } })
      try {
        const res = await fetch(`http://localhost:20902${iconRoute(512)}`)
        assertEquals(res.status, 200)
        assert((await res.arrayBuffer()).byteLength === 2)
      } finally {
        await webServerManager.stop(servers)
      }
    } finally {
      setPwaBuildOutput(undefined)
      await Deno.remove(root, { recursive: true })
    }
  },
)

/**
 * Regression coverage for a confirmed raw-native-error leak: `registerFileRoute` used to rethrow
 * any non-`NotFound` `Deno.errors.*` completely unwrapped — whose `.message` routinely embeds the
 * real, absolute `filePath` on disk (confirmed via a real repro: `Deno.readFile()` on a directory
 * throws `Is a directory (os error 21): readfile '<the real path>'`). `@zanix/server`'s own
 * `getPublicErrorResponse` allowlists `message` by default, so that raw path used to reach any
 * real HTTP client hitting this route. Fixed by wrapping into `InternalError` — this proves the
 * response actually carries the new, safe `code` and never the real filesystem path, not just
 * that "some error" is thrown.
 */
Deno.test(
  'registerPwa: a non-NotFound native read failure on a served file responds 500 with the wrapped code, never the raw filesystem path',
  async () => {
    const root = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      // A directory where the icon file is expected — a real, deterministic, cross-platform way
      // to trigger `Deno.errors.IsADirectory` (never `NotFound`, which already 404s correctly).
      await Deno.mkdir(`${root}/icons/icon-192.png`, { recursive: true })
      setPwaBuildOutput(root)

      registerPwa({ name: 'Broken Icon App', icon: './icon-source.png', iconSizes: [192] })

      const servers = await bootstrapServers({ ssr: { port: 20904 } })
      try {
        const res = await fetch(`http://localhost:20904${iconRoute(192)}`)
        assertEquals(res.status, 500)
        const body = await res.json()
        assertEquals(body.code, 'SPACE_PWA_FILE_READ_FAILED')
        // The real absolute path (`root`, part of a Deno temp dir) must never appear in what the
        // client receives — only in `meta`/`cause`, neither of which is exposed by default.
        assertEquals(JSON.stringify(body).includes(root), false)
      } finally {
        await webServerManager.stop(servers)
      }
    } finally {
      setPwaBuildOutput(undefined)
      await Deno.remove(root, { recursive: true })
    }
  },
)

Deno.test(
  'registerPwa: with no build output registered at all, neither icon nor sw.js routes exist',
  async () => {
    setPwaBuildOutput(undefined)
    registerPwa({ name: 'No Build Yet App', icon: './icon-source.png' })

    const servers = await bootstrapServers({ ssr: { port: 20903 } })
    try {
      // Not registered at all → @zanix/server's own generic NOT_FOUND, not this module's 404.
      const iconRes = await fetch(`http://localhost:20903${iconRoute(192)}`)
      assertEquals(iconRes.status, 404)

      const swRes = await fetch(`http://localhost:20903${SW_ROUTE}`)
      assertEquals(swRes.status, 404)

      // /manifest.webmanifest alone still works — it needs no built file at all.
      const manifestRes = await fetch(
        `http://localhost:20903${MANIFEST_ROUTE}`,
      )
      assertEquals(manifestRes.status, 200)
    } finally {
      await webServerManager.stop(servers)
    }
  },
)
