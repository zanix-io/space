/**
 * Hand-written `/@vite/client` replacement — shared infrastructure, NOT renderer-specific.
 * `spacePlugin()`'s `react()` branch (Rolldown's native `oxc.jsx` transform, `refresh: true`) emits
 * the EXACT SAME shape of `import.meta.hot` usage `@prefresh/vite`'s Babel pass does for Preact —
 * ```
 * import { createHotContext as __vite__createHotContext } from "/@vite/client";
 * import.meta.hot = __vite__createHotContext("/counter.tsx");
 * ...
 * import.meta.hot.accept((nextExports) => {
 *   const invalidateMessage = RefreshRuntime.validateRefreshBoundaryAndEnqueueUpdate(...)
 *   if (invalidateMessage) import.meta.hot.invalidate(invalidateMessage)
 * })
 * ```
 * — so this module, and the real `/@vite/client` request it replaces, are needed by EITHER
 * renderer's dev session, not just Preact's. `import.meta.hot` itself only exists because Vite's own
 * `importAnalysis` transform (always active, part of `transformRequest`) auto-injects that import at
 * the top of any module that references it, for both renderers alike.
 *
 * The REAL `/@vite/client` (Vite's own, several-hundred-line HMR runtime) is not usable as-is for
 * this engine: its own `accept()` registrations live in a private module closure this package has no
 * way to reach from a separately-injected script, and on first use it opens a WebSocket to whatever
 * HMR endpoint Vite itself was configured for — which this engine never binds
 * (`createSpaceDevEngine`'s own doc: `Deno.serve()` is the only real listener, Vite's own dev
 * middleware/socket are never mounted). Hand-written here instead, same reasoning
 * `dev-fast-refresh-preamble.ts` already established for React's own preamble: small and stable.
 *
 * This module is served AS `/@vite/client`'s own response body (see
 * {@linkcode looksLikeViteHotClientRequest}/{@linkcode createViteHotClientHandler}) — never imported
 * directly by any file in this package itself. `window.__spaceApplyClientUpdate`, not a private
 * module-scoped closure, is what makes the registry reachable from `dev-client-script.ts`'s own
 * `client-module-changed` handler (a plain, non-`module` `<script>`, which can call a global but
 * can't `import` a named binding from this one).
 *
 * @module
 */

/** Real request path Vite's own `importAnalysis` transform hardcodes for any module referencing
 * `import.meta.hot` — not configurable, and matches `vite@8.2.1`'s own source; this package treats
 * it as a fixed constant rather than something resolved dynamically. */
export const VITE_CLIENT_REQUEST_PATH = '/@vite/client'

/**
 * Whether `pathname` is the one request {@linkcode createViteHotClientHandler} needs to intercept
 * BEFORE `createDevAssetHandler`'s own generic forwarding reaches it — that generic path would
 * otherwise forward this exact request to Vite's own real `/@vite/client` transform instead, see
 * this module's own doc for why that's not usable here.
 */
export function looksLikeViteHotClientRequest(pathname: string): boolean {
  return pathname === VITE_CLIENT_REQUEST_PATH
}

/**
 * The hand-written `/@vite/client` replacement itself — see this module's own doc for the full
 * reasoning. `createHotContext(id)`'s `accept(cb)` stores `cb` keyed by `id` (the importing module's
 * own url, e.g. `/comets/counter.tsx`) on `window.__spaceHotAccept`, a plain object any OTHER script
 * running on the same page (`dev-client-script.ts`'s own `handleClientModuleChanged`, via
 * `window.__spaceApplyClientUpdate` below) can reach.
 *
 * `on`/`off`/`send`/`prune`/`dispose`/`decline` are deliberate no-ops — neither renderer's own
 * transform needs them. `invalidate(message)` is NOT a no-op: React's own transform calls it when
 * `RefreshRuntime.validateRefreshBoundaryAndEnqueueUpdate` decides a module is no longer a valid
 * refresh boundary (e.g. it stopped exporting only components) — the real Vite client's own
 * `invalidate` falls back to a full reload in that case, and this one does the same, so an edit
 * that can't be granularly applied still ends up correct instead of silently stuck on stale code.
 * Preact's own transform never calls it, so this only ever fires for React in practice today —
 * harmless either way.
 *
 * `window.__spaceApplyClientUpdate(url)` is what `dev-client-script.ts` calls once a
 * `client-module-changed` message names `url` — re-imports it with a cache-busting query (the same
 * technique a real Vite client uses, and the same one `client-css-changed`'s own stylesheet swap
 * already relies on for `<link>` hrefs) and hands the fresh module namespace to whichever `accept()`
 * callback was registered for that exact url — React's own callback then runs
 * `RefreshRuntime.validateRefreshBoundaryAndEnqueueUpdate`/Preact's own runs `flushUpdates()`
 * internally; this function has no renderer-specific logic of its own. A silent no-op if nothing was
 * ever registered for that url (e.g. a module that doesn't use `import.meta.hot` at all).
 *
 * This hand-written client guards against two specific failure modes, without changing its shape,
 * message contract, or public API:
 * - The cache-busting token must be `t=<EXACTLY 13 digits>` — nothing appended, nothing else in the
 *   query. Vite's own source (`vite@8.2.1`, `dist/node/chunks/node.js`) shows why:
 *   `transformRequest()`'s very first line calls `removeTimestampQuery(url)`, whose regex is
 *   `/\bt=\d{13}&?\b/` — EXACTLY 13 digits, matched BEFORE `resolveId`/`load`/`transform` ever see
 *   the `id`. Vite's own real client (`client.mjs`) only ever builds this token as a bare
 *   server-side `Date.now()` (always 13 digits, nothing concatenated), so `removeTimestampQuery`
 *   always recognizes and strips it — the plugins (`@prefresh/vite`, `@vitejs/plugin-react`) and the
 *   transform's own `_jsxFileName`/`createHotContext(id)` embedding always see the CANONICAL,
 *   query-free id, even though the browser fetched a cache-busted URL. A monotonic in-page counter
 *   appended directly onto `Date.now()` (`Date.now() + '' + counter`, 14+ digits) would dodge a
 *   same-millisecond collision but no longer match `\d{13}` exactly, so `removeTimestampQuery`
 *   would never strip it, the query would survive all the way to the plugins, and BOTH renderers'
 *   own refresh-wrapping would be silently skipped for that request (`@prefresh/vite`'s
 *   `id.endsWith('.tsx')`-shaped check fails outright; React's own transform still wraps the
 *   module, but registers it under the query-suffixed id, which never matches the original mount's
 *   query-free id, so `RefreshRuntime` can't correlate the two) — for both renderers alike. Instead
 *   the token stays monotonic WITHOUT ever growing past 13 digits: `nextHmrTimestamp()` below
 *   returns `Math.max(Date.now(), lastHmrTimestamp + 1)` — real wall-clock time on every call that
 *   isn't a same-millisecond repeat, and a strictly incrementing 13-digit value (still real
 *   milliscale, since it never runs meaningfully ahead of `Date.now()` in practice) on a
 *   same-millisecond repeat, which is exactly what a same-millisecond collision needs without ever
 *   appending a digit onto the value Vite itself expects to match.
 * - The whole re-import + `accept()` callback invocation is wrapped in `try`/`catch`: a real syntax
 *   error in the edited file (the re-import itself rejects) or the `accept()` callback throwing
 *   synchronously (`RefreshRuntime.validateRefreshBoundaryAndEnqueueUpdate`, or Preact's own
 *   `flushUpdates()`, are both real functions this file doesn't control) would otherwise leave an
 *   unhandled promise rejection and apply nothing. Falling back to a real reload here follows the
 *   same philosophy `invalidate()` above already uses: a dev-only best-effort update failing to
 *   apply must still end up correct, never silently stuck on stale code.
 */
export function buildViteHotClientScript(): string {
  return `
window.__spaceHotAccept = window.__spaceHotAccept || {};
let __spaceLastHmrTimestamp = 0;
function __spaceNextHmrTimestamp() {
  const now = Date.now();
  __spaceLastHmrTimestamp = Math.max(now, __spaceLastHmrTimestamp + 1);
  return __spaceLastHmrTimestamp;
}
export function createHotContext(id) {
  return {
    accept: function (cb) { window.__spaceHotAccept[id] = cb; },
    on: function () {},
    off: function () {},
    send: function () {},
    prune: function () {},
    dispose: function () {},
    invalidate: function (message) {
      console.warn('[space] hot update could not be applied, reloading:', message);
      location.reload();
    },
    decline: function () {},
  };
}
export function injectQuery(url) { return url; }
window.__spaceApplyClientUpdate = async function (url) {
  var cb = window.__spaceHotAccept[url];
  if (!cb) return;
  try {
    // EXACTLY 13 digits, always -- Vite's own transformRequest() only strips a "?t=<digits>" query
    // (regex /\bt=\d{13}&?\b/, matched BEFORE any plugin sees the id) when it's exactly 13 digits;
    // anything else (an appended counter, a random suffix) survives to the plugins and silently
    // breaks Fast-Refresh/Prefresh registration -- see this function's own doc for the full
    // reasoning.
    var bumped = url + (url.indexOf('?') === -1 ? '?' : '&') + 't=' + __spaceNextHmrTimestamp();
    var mod = await import(/* @vite-ignore */ bumped);
    cb(mod);
  } catch (error) {
    console.warn('[space] hot update failed to apply, reloading:', url, error);
    location.reload();
  }
};
`.trim()
}

/**
 * Wraps {@linkcode buildViteHotClientScript} into a plain `(req) => Response | null` — same shape as
 * `createDevAssetHandler`, meant to be tried BEFORE it by a dev-server orchestrator whenever a dev
 * session's Comets can reference `import.meta.hot` — which is true for EITHER renderer this package
 * supports (see this module's own doc for the real transform evidence for both). Returns `null` for
 * anything else, so a caller can fall through to `createDevAssetHandler`/the real route table
 * unchanged — same composition pattern that function's own doc already establishes.
 */
export function createViteHotClientHandler(): (
  req: Request,
) => Response | null {
  return function handleViteHotClientRequest(req: Request): Response | null {
    const { pathname } = new URL(req.url)
    if (!looksLikeViteHotClientRequest(pathname)) return null
    return new Response(buildViteHotClientScript(), {
      status: 200,
      headers: { 'content-type': 'application/javascript; charset=utf-8' },
    })
  }
}
