import type { SpaceDevEngine } from 'modules/bundler/dev-engine.ts'

/** Real source-file extensions this handler transforms through Vite — deliberately narrow (not
 * "anything with a dot"), so a request for something else entirely (a real page route with a
 * literal `.` in it, an unrelated static file a different handler owns) never gets misrouted
 * here. */
const ASSET_EXTENSIONS = [
  '.css',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.json',
]

/** Vite's own special request paths — none of them carry a recognizable file extension
 * (`/@vite/client`), or live outside the project root entirely (`/@fs/...`, for Vite's own
 * client runtime files), so {@linkcode ASSET_EXTENSIONS} alone would miss them. `/.vite/` covers
 * the dependency pre-optimizer's own output (`/.vite/deps/react.js?v=...`), which a Comet's
 * transformed code imports directly. Real path PREFIXES only — each one owns everything beneath
 * it. */
const VITE_SPECIAL_PREFIXES = ['/@vite/', '/@fs/', '/@id/', '/.vite/']

/** Vite's own single-file virtual modules — exact matches, never a prefix (unlike
 * {@linkcode VITE_SPECIAL_PREFIXES}: each of these is one fixed path with nothing beneath it, so
 * `startsWith` would risk matching an unrelated longer path by accident). `/@react-refresh` is
 * `@vitejs/plugin-react`'s own React Fast Refresh runtime — every Comet transformed with
 * `spacePlugin()`'s own `react()` wired in imports it by this exact specifier. */
const VITE_EXACT_VIRTUAL_MODULES = ['/@react-refresh']

/** The Fetch Metadata request header a real browser sets to `'document'` for a top-level
 * navigation (typing a URL, clicking a link, `location.href`) — distinct from `'script'`/`'style'`/
 * etc. for a resource a page's own markup requested (`<script src>`, `<link rel="stylesheet">`).
 * {@linkcode createDevAssetHandler} reads this to tell apart a person navigating directly to a URL
 * {@linkcode looksLikeDevAssetRequest} misclassified as an asset (a page route happening to end in
 * one of {@linkcode ASSET_EXTENSIONS} — never how a real `@zanix/space` route looks by convention,
 * but nothing stops a person from typing one) from a genuinely broken asset reference a page's own
 * script/stylesheet tag requested. Not sent by every client (an older browser, a same-origin
 * `fetch()` that never sets it) — absent, or any value other than `'document'`, is treated the same
 * as today, never a regression from the header simply not being there. */
const SEC_FETCH_DEST_HEADER = 'sec-fetch-dest'
const DOCUMENT_FETCH_DEST = 'document'

/**
 * Whether `pathname` looks like something {@linkcode createDevAssetHandler}'s handler should
 * transform through Vite, as opposed to a real page route or an unrelated request. A heuristic,
 * not a route table: real page routes (`routes/**\/page.tsx`) resolve to clean, extension-less
 * URLs (`/products/1`) by convention, so a simple extension/prefix check is enough to tell the
 * two apart without needing to consult `@zanix/server`'s own route registry at all.
 */
export function looksLikeDevAssetRequest(pathname: string): boolean {
  if (VITE_EXACT_VIRTUAL_MODULES.includes(pathname)) return true
  if (VITE_SPECIAL_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return true
  }
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
 * `modules/render/`/`modules/router/`, by design, so dev-only constructs, including anything
 * decorator-based like `@Socket`, can never leak into a production request path).
 *
 * A syntax/transform error (a real bug in the requested source file, not "file doesn't exist")
 * responds `500` with the error's own message as plain text — deliberately verbose: this only ever
 * runs in `znx space dev`, where surfacing exactly what broke is more useful than a generic
 * message, the same reasoning `deno doc`/Vite's own dev server already apply to their own error
 * output.
 *
 * A request Vite can't resolve to a real asset (`transformClientAsset` returns `null`) responds
 * `404` directly UNLESS it's a real top-level document navigation ({@linkcode DOCUMENT_FETCH_DEST}
 * via {@linkcode SEC_FETCH_DEST_HEADER}) — that one case falls through to the real route table
 * instead, so a person who ends up at a URL {@linkcode looksLikeDevAssetRequest} misclassified as an
 * asset (e.g. `/page.tsx` — real page routes never carry an extension, but nothing stops a person
 * from typing one) sees this app's own `not-found.tsx` like any other unmatched route, rather than a
 * bare, unstyled 404. A page's own `<script src>`/`<link rel="stylesheet">` requesting a genuinely
 * broken asset never sets `Sec-Fetch-Dest: document`, so it keeps getting the immediate, plain 404
 * above — never the full `not-found.tsx` document body, which the browser would otherwise try to
 * parse as the JS/CSS it actually asked for.
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
      return new Response(message, {
        status: 500,
        headers: { 'content-type': 'text/plain' },
      })
    }

    if (!asset) {
      if (req.headers.get(SEC_FETCH_DEST_HEADER) === DOCUMENT_FETCH_DEST) return null
      return new Response('Not found', { status: 404 })
    }

    const headers: Record<string, string> = {
      'content-type': asset.contentType,
    }
    if (asset.etag) headers.etag = asset.etag
    return new Response(asset.code, { status: 200, headers })
  }
}
