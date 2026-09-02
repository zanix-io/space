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
 * internally; this function has no renderer-specific logic of its own.
 *
 * Falls back to a real reload — same as the `catch` branch below — when NO `accept()` was ever
 * registered for that url, rather than silently doing nothing. A missing callback isn't only "a
 * module that never used `import.meta.hot`" (every Comet gets one automatically via either
 * renderer's own Fast-Refresh/Prefresh transform, so that case doesn't really arise here in
 * practice): it's also what a Comet whose OWN static import chain failed on its very first load
 * looks like — a rejected static import aborts that module's evaluation before its own
 * `import.meta.hot.accept(...)` call ever runs (e.g. the exact shape a `'server-only'` violation,
 * `dev-engine.ts`'s own `transformClientAsset` check, leaves behind), permanently leaving `cb`
 * unset for that url. Without this fallback, every LATER edit to that same file (even a genuine
 * fix) kept silently doing nothing forever — confirmed as a real, reproduced dev session getting
 * stuck exactly this way, needing a manual full refresh to recover, contradicting this whole
 * file's own "never silently stuck on stale code" philosophy just as much as the two failure
 * modes documented below already do.
 *
 * This hand-written client guards against three specific failure modes, without changing its shape,
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
 * - A missing `cb` ALSO falls back to a reload now, not a silent return — see this function's own
 *   doc above for the real, reproduced failure mode this closes (a Comet whose own first load
 *   failed before it ever reached its own `accept()` registration).
 */
export function buildViteHotClientScript(): string {
  return `
window.__spaceHotAccept = window.__spaceHotAccept || {};
window.__spaceStyleSheets = window.__spaceStyleSheets || new Map();
// Vite's own CSS transform (\`cssPlugin\`'s dev-serve handler, \`vite@8.2.1\`'s own
// \`dist/node/chunks/node.js\`) unconditionally rewrites EVERY real CSS/CSS-Modules import a
// CLIENT-environment module reaches (a Comet's own \`*.module.css\`, a plain \`*.css\` side-effect
// import, ...) into generated JS that imports exactly these two names from \`/@vite/client\` and
// calls the first one at module top level, on every load, first load included -- not only on a
// later HMR update. Never optional, never behind a config flag: this is dev-serve mode's ONLY
// mechanism for actually applying a CSS Modules import's styles to the page (a real \`<link>\` tag
// is a PRODUCTION build's job, via \`cssPlugin\`'s own manifest -- see that file's own doc). Without
// these two exports, the browser's own native ES module loader rejects the whole generated module
// outright (\`SyntaxError: ... does not provide an export named 'removeStyle'\`), which aborts
// hydration for every Comet reachable from it -- confirmed as a real, previously unexercised gap:
// no Comet in this ecosystem imported a real CSS/CSS-Modules file until now, so this hand-written
// replacement's own doc never needed to account for Vite's CSS-specific rewrite, only its generic
// \`import.meta.hot\` one. Implemented the same way Vite's own real client does: a single
// \`<style data-vite-dev-id>\` element per module id, created once and its \`textContent\` replaced
// in place on every later call (never a second element per id) -- \`removeStyle\` (registered via
// \`import.meta.hot.prune\` below, never called by this file itself) is what a real HMR update to a
// CSS Modules file uses to drop a NO-LONGER-imported module's own leftover element.
// Reads the CURRENT page's real CSP nonce off an element the server actually rendered with one --
// never a value this script invents or caches at module-eval time. Every Space page under a
// nonce-based CSP renders at least one nonced element before ANY module import can even start
// running (\`BUILTIN_CSS\`'s own \`<style nonce>\` in \`<head>\`, this app's own bootstrap
// \`<script nonce>\`, ...) -- \`[nonce]\` (not \`script[nonce]\`) matches either shape, renderer-
// agnostic, same as this whole file. Real browsers deliberately hide a nonce's CONTENT ATTRIBUTE
// from \`getAttribute\`/\`outerHTML\` for security once the element is inserted -- only the element's
// own \`.nonce\` IDL property still returns the real value, and only for an element the PARSER
// actually inserted from real HTML (never one built via \`createElement\`, which starts with an
// empty nonce until explicitly assigned) -- confirmed against real Chromium/Firefox nonce
// semantics, not assumed. Queried fresh on every call rather than cached once: computing it lazily
// is self-healing if this ever somehow runs before any nonced element exists yet, at no real cost
// (this is not a hot path -- once per unique CSS Modules id, plus rare HMR updates).
function __spaceGetCspNonce() {
  var nonced = document.querySelector('[nonce]');
  return nonced ? nonced.nonce : '';
}
function __spaceUpdateStyle(id, css) {
  var style = window.__spaceStyleSheets.get(id);
  if (!style) {
    style = document.createElement('style');
    style.setAttribute('type', 'text/css');
    style.setAttribute('data-vite-dev-id', id);
    // Assigned BEFORE \`appendChild\` below, deliberately -- a nonce-based CSP evaluates a \`<style>\`
    // element the INSTANT it enters the document; setting \`.nonce\` any later (even synchronously
    // right after) is already too late and the browser blocks it regardless of what the nonce
    // value eventually becomes. Confirmed as a real, reported failure: without this, EVERY style
    // this function ever inserted was blocked outright (\`Applying inline style violates ... 'style-
    // src'\`), reported against the SHA-256 hash of an EMPTY string -- proof CSP evaluated the
    // element right at \`appendChild\`, before \`textContent\` below ever ran, not evidence the CSS
    // content itself was the problem.
    style.nonce = __spaceGetCspNonce();
    document.head.appendChild(style);
    window.__spaceStyleSheets.set(id, style);
  }
  style.textContent = css;
}
function __spaceRemoveStyle(id) {
  var style = window.__spaceStyleSheets.get(id);
  if (!style) return;
  style.remove();
  window.__spaceStyleSheets.delete(id);
}
export { __spaceUpdateStyle as updateStyle, __spaceRemoveStyle as removeStyle };
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
  if (!cb) {
    console.warn('[space] no hot-accept registered, reloading:', url);
    location.reload();
    return;
  }
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
