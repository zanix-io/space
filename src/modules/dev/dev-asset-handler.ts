import type { SpaceDevEngine } from 'modules/bundler/dev-engine.ts'

/** Real source-file extensions this handler transforms through Vite — deliberately narrow (not
 * "anything with a dot"), so a request for something else entirely (a real page route with a
 * literal `.` in it, an unrelated static file a different handler owns) never gets misrouted
 * here. */
const ASSET_EXTENSIONS = ['.css', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.json']

/** Vite's own special request paths — none of them carry a recognizable file extension
 * (`/@vite/client`), or live outside the project root entirely (`/@fs/...`, for Vite's own
 * client runtime files, confirmed real during this mechanism's own spike), so
 * {@linkcode ASSET_EXTENSIONS} alone would miss them. `/.vite/` covers the dependency
 * pre-optimizer's own output (`/.vite/deps/react.js?v=...`), which a Comet's transformed code
 * imports directly. Real path PREFIXES only — each one owns everything beneath it. */
const VITE_SPECIAL_PREFIXES = ['/@vite/', '/@fs/', '/@id/', '/.vite/']

/** Vite's own single-file virtual modules — exact matches, never a prefix (unlike
 * {@linkcode VITE_SPECIAL_PREFIXES}: each of these is one fixed path with nothing beneath it, so
 * `startsWith` would risk matching an unrelated longer path by accident). `/@react-refresh` is
 * `@vitejs/plugin-react`'s own React Fast Refresh runtime — every Comet transformed with
 * `spacePlugin()`'s own `react()` wired in imports it by this exact specifier (confirmed via a
 * real, disposable spike reading the actual transform output before this was relied on here). */
const VITE_EXACT_VIRTUAL_MODULES = ['/@react-refresh']

/**
 * Whether `pathname` looks like something {@linkcode createDevAssetHandler}'s handler should
 * transform through Vite, as opposed to a real page route or an unrelated request. A heuristic,
 * not a route table: real page routes (`routes/**\/page.tsx`) resolve to clean, extension-less
 * URLs (`/products/1`) by convention, so a simple extension/prefix check is enough to tell the
 * two apart without needing to consult `@zanix/server`'s own route registry at all.
 */
export function looksLikeDevAssetRequest(pathname: string): boolean {
  if (VITE_EXACT_VIRTUAL_MODULES.includes(pathname)) return true
  if (VITE_SPECIAL_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return true
  return ASSET_EXTENSIONS.some((ext) => pathname.endsWith(ext))
}

/**
 * Wraps a {@linkcode SpaceDevEngine} into a plain `(req) => Response | null` function — the real,
 * browser-facing counterpart of the engine's own `transformClientAsset`. Returns `null` for a
 * request {@linkcode looksLikeDevAssetRequest} doesn't recognize, so a caller (a future dev-server
 * orchestrator's own top-level `Deno.serve()` handler) can try this FIRST and fall through to the
 * real SSR/`@zanix/server` request handling when it returns `null` — this function never touches
 * `@zanix/server`'s own route table, registers nothing, and is never reachable from any production
 * request path (see this module's own `mod.ts` — nothing under `modules/dev/` is imported by
 * `modules/render/`/`modules/router/`, on purpose, the same discipline that fixed a real
 * `@Socket`-decorator-leaking-into-production regression earlier in this framework's own history).
 *
 * A syntax/transform error (a real bug in the requested source file, not "file doesn't exist")
 * responds `500` with the error's own message as plain text — deliberately verbose: this only ever
 * runs in `znx space dev`, where surfacing exactly what broke is more useful than a generic
 * message, the same reasoning `deno doc`/Vite's own dev server already apply to their own error
 * output.
 */
export function createDevAssetHandler(
  engine: Pick<SpaceDevEngine, 'transformClientAsset'>,
): (req: Request) => Promise<Response | null> {
  return async function handleDevAsset(req: Request): Promise<Response | null> {
    const url = new URL(req.url)
    if (!looksLikeDevAssetRequest(url.pathname)) return null

    let asset
    try {
      asset = await engine.transformClientAsset(url.pathname + url.search)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return new Response(message, { status: 500, headers: { 'content-type': 'text/plain' } })
    }

    if (!asset) return new Response('Not found', { status: 404 })

    const headers: Record<string, string> = { 'content-type': asset.contentType }
    if (asset.etag) headers.etag = asset.etag
    return new Response(asset.code, { status: 200, headers })
  }
}
