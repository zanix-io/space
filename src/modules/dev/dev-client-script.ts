import { SPACE_DEV_SOCKET_ROUTE } from './dev-socket-route.ts'

/** Options for {@linkcode buildDevClientScript}. */
export interface DevClientScriptOptions {
  /**
   * This page's own source file path, exactly as `loadRoutes()`/`scanPageFiles` know it (see
   * `PageTree.filePath`) — compared against an incoming `ssr-module-changed` message's own
   * `affectedRoutes` to decide whether THIS page needs to reload, not every page open in every
   * tab of a dev session. `undefined` for a response with no known page identity (e.g.
   * `createNotFoundHandler`'s own render) — such a response always reloads on any SSR change,
   * since it has no specific route to compare against.
   */
  routeFilePath?: string
}

/**
 * Generates the dev-only client script `renderToResponse` injects when
 * `isDevClientEnabled()` is true — never emitted, imported, or executed outside that gate, so a
 * production response (`isDevClientEnabled()` false, the only state a plain `deno run mod.ts` boot
 * ever leaves it in) carries none of this. Connects to {@linkcode SpaceDevSocket} (same-origin,
 * `location.host`, computed in the browser so no server-resolved URL needs to be embedded) and
 * handles two notification kinds over that one connection:
 *
 * - `ssr-module-changed`: a full `location.reload()` when `affectedRoutes` includes this page's own
 *   `routeFilePath` — the same choice Fresh, Astro, and Hono's own dev-server integrations
 *   converged on independently for SSR/server-side changes (see this framework's own design notes
 *   on `zanix space dev`): granular HMR for a server-rendered response risks tearing a response
 *   that already started streaming, and a full reload is simple, correct, and fast enough for a
 *   change that only just happened.
 * - `client-css-changed`: swaps every `<link rel="stylesheet">` whose `href` (path, ignoring query)
 *   matches one of the changed `urls` to a fresh, cache-busted `href` — no reload, the same
 *   no-flash stylesheet swap a real Vite dev server does for CSS. Only covers `globalCss` links
 *   (see `dev-engine.ts`'s own `onClientCssChanged` doc for why a Comet's own local CSS import
 *   isn't included here).
 * - `client-module-changed`: forwards each changed url to `window.__spaceApplyClientUpdate`, IF a
 *   page has one — that global only exists once `dev-vite-hot-client.ts`'s own `/@vite/client`
 *   replacement has actually been loaded, which requires a dev-server orchestrator to (a) enable
 *   `devClient` on the response (`render-page-react.tsx`/`render-page-preact.ts` both already do,
 *   unconditionally, whenever `isDevClientEnabled()` — this was never renderer-specific) and (b)
 *   serve `createViteHotClientHandler()`'s own response for `/@vite/client`, ahead of
 *   `createDevAssetHandler`'s generic forwarding. A page whose orchestrator hasn't wired (b) yet has
 *   no such global — this branch is then a deliberate no-op there (`typeof` guard, never a
 *   `ReferenceError`), the exact same "does nothing" outcome a Comet-only edit already produced
 *   before this message kind existed. See `dev-vite-hot-client.ts`'s own doc for what that function
 *   actually does (a cache-busted re-import + whichever renderer's own real `accept()` callback was
 *   registered for that module — React's own `RefreshRuntime`-driven one or Preact's own
 *   `@prefresh/vite`-driven one, this script never distinguishes between them).
 *
 * A pure function — no I/O of its own, easy to unit-test (`new Function(source)` confirms valid
 * JS syntax, the same technique `buildServiceWorkerSource` already uses).
 *
 * @param options - See {@linkcode DevClientScriptOptions}.
 */
export function buildDevClientScript(
  options: DevClientScriptOptions = {},
): string {
  const { routeFilePath } = options

  return `
(function () {
  var routeFilePath = ${JSON.stringify(routeFilePath ?? null)}
  var protocol = location.protocol === 'https:' ? 'wss' : 'ws'
  var socket = new WebSocket(protocol + '://' + location.host + '/socket/${SPACE_DEV_SOCKET_ROUTE}')

  function handleSsrModuleChanged(message) {
    var affectedRoutes = message.affectedRoutes || []
    if (!routeFilePath || affectedRoutes.indexOf(routeFilePath) !== -1) {
      location.reload()
    }
  }

  function handleClientCssChanged(message) {
    var urls = message.urls || []
    var links = document.querySelectorAll('link[rel="stylesheet"]')
    for (var i = 0; i < links.length; i++) {
      var link = links[i]
      var linkPath = link.getAttribute('href').split('?')[0]
      for (var j = 0; j < urls.length; j++) {
        if (urls[j].split('?')[0] === linkPath) {
          link.href = linkPath + '?direct&t=' + Date.now()
          break
        }
      }
    }
  }

  function handleClientModuleChanged(message) {
    // Bare identifier, not window.__spaceApplyClientUpdate -- same reasoning as location/document/
    // WebSocket above: resolves via the global scope chain in a real browser without ever throwing
    // if it was never defined (only typeof is safe for that; a plain "if (__spaceApplyClientUpdate)"
    // would throw a ReferenceError on a page whose dev-server orchestrator hasn't served
    // dev-vite-hot-client.ts's own /@vite/client replacement yet -- true for either renderer until
    // that's wired.
    if (typeof __spaceApplyClientUpdate !== 'function') return
    var urls = message.urls || []
    for (var i = 0; i < urls.length; i++) {
      __spaceApplyClientUpdate(urls[i])
    }
  }

  socket.onmessage = function (event) {
    var message
    try {
      message = JSON.parse(event.data)
    } catch (error) {
      return
    }
    if (message.kind === 'ssr-module-changed') handleSsrModuleChanged(message)
    else if (message.kind === 'client-css-changed') handleClientCssChanged(message)
    else if (message.kind === 'client-module-changed') handleClientModuleChanged(message)
  }
})();
`.trim()
}
