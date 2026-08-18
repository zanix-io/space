/** Minimal static-file + single-HTML-document server shared by all 4 variants — deliberately NOT
 * `@zanix/server`/`bootstrapServers` (this benchmark measures the CLIENT-side architecture
 * difference; a full server framework's own request pipeline is irrelevant overhead neither this
 * benchmark nor its results care about). */

function contentTypeFor(path: string): string {
  if (path.endsWith('.js')) return 'application/javascript; charset=utf-8'
  if (path.endsWith('.css')) return 'text/css; charset=utf-8'
  if (path.endsWith('.json')) return 'application/json; charset=utf-8'
  return 'application/octet-stream'
}

export interface VariantServerOptions {
  /** The full, already-rendered HTML document served at `/`. */
  html: string
  /** Directory built assets (`/assets/...`) are read from. */
  assetsRoot: string
}

export function serveVariant(options: VariantServerOptions): Deno.HttpServer {
  const { html, assetsRoot } = options
  return Deno.serve({ port: 0, onListen: () => {} }, async (req) => {
    const url = new URL(req.url)
    if (url.pathname === '/') {
      return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } })
    }
    try {
      const filePath = `${assetsRoot}${url.pathname}`
      const body = await Deno.readFile(filePath)
      return new Response(body, { headers: { 'content-type': contentTypeFor(filePath) } })
    } catch {
      // Chromium requests `/favicon.ico` on every top-level navigation, and this harness serves
      // only `/` and the built assets — so exactly one 404 per variant is expected, identical
      // across all four, and it is NOT counted in any JS/HTML transfer figure. Answering it here
      // keeps that fact visible in the run log instead of leaving an anonymous 404 that reads like
      // a broken asset.
      if (url.pathname === '/favicon.ico') {
        return new Response(null, { status: 204 })
      }
      return new Response('Not found', { status: 404 })
    }
  })
}

/** Finds the real, hashed built filename for a given entry name (e.g. `'client-entry'` →
 * `client-entry-B3x9dK1a.js`) — Vite hashes every JS-only entry's output filename by default, same
 * convention `buildSpaceClient`'s own real comet builds already produce. */
export async function findBuiltAsset(assetsDir: string, entryName: string): Promise<string> {
  for await (const entry of Deno.readDir(assetsDir)) {
    if (entry.isFile && entry.name.startsWith(`${entryName}-`) && entry.name.endsWith('.js')) {
      return `/assets/${entry.name}`
    }
  }
  throw new Error(`No built asset found for entry "${entryName}" in ${assetsDir}`)
}
