import type { SsrModuleChangedEvent } from 'modules/bundler/dev-engine.ts'
import { ProgramModule, Socket, ZanixWebSocket } from '@zanix/server'
import { SPACE_DEV_SOCKET_ROUTE } from './dev-socket-route.ts'

// `ZanixWebSocket` (reexported from this module's own `mod.ts`) itself references
// `HandlerGenericClass` (already an accepted `deno doc --lint` finding elsewhere in this package,
// via `ZanixSsrController`'s own identical base) and `RegistryContainer`. Chasing
// `RegistryContainer` further (it references `BaseContainer`, which itself references yet another
// type on one of its own methods) would mean reexporting `@zanix/server`'s generic internal
// plumbing from `@zanix/space`'s own public surface for no benefit to a consumer of this package —
// accepted as a structural limit, same criterion already applied to `spacePlugin` → `Plugin`
// (`space-plugin.ts`'s own doc comment).

export { SPACE_DEV_SOCKET_ROUTE }

/** `RegistryContainer` key `SpaceDevSocket` uses to track its own currently-open connections. */
const CONNECTIONS_REGISTRY_KEY = 'zanix-space-dev-sockets'

/**
 * The real notification channel `zanix space dev` pushes over — never Vite's own client HMR
 * WebSocket (that one is never exposed to the browser at all, see `createSpaceDevEngine`'s own
 * doc), and never a bespoke `Deno.upgradeWebSocket` handler either. This is the same
 * `ZanixWebSocket`/`@Socket` primitive any application handler uses — see `docs/handlers.md`'s
 * "Tracking connections and pushing messages proactively" section in `@zanix/server`, which this
 * class follows directly: `this.registry`'s array helpers (`push`/`array`, backed by
 * `RegistryContainer`) track open connections, since `ZanixWebSocket` itself gives no built-in
 * way to reach a connection except in reply to its own incoming message.
 *
 * Meant to share its listener with the app's own `'ssr'` server via an explicit, matching port
 * (see `docs/handlers.md`'s "Sharing a port with an unanchored server") — so the browser can
 * connect same-origin, no separate port/CORS configuration needed.
 *
 * A dev-server orchestrator registers this once at boot (alongside `bootstrapServers({ ssr, socket })`)
 * and calls {@linkcode broadcastSsrModuleChanged} from `SpaceDevEngine`'s own
 * `onSsrModuleChanged` callback — this class never talks to Vite directly.
 */
@Socket(SPACE_DEV_SOCKET_ROUTE)
export class SpaceDevSocket extends ZanixWebSocket {
  /** Tracks this connection in the shared registry so {@linkcode broadcastSsrModuleChanged} can reach it later. */
  protected override onopen(): void {
    this.registry.push(CONNECTIONS_REGISTRY_KEY, this)
  }

  /** Removes this connection from the shared registry, so a later broadcast never targets it. */
  protected override onclose(): void {
    const remaining = this.registry
      .array<SpaceDevSocket>(CONNECTIONS_REGISTRY_KEY)
      .filter((socket) => socket !== this)
    this.registry.set(CONNECTIONS_REGISTRY_KEY, remaining)
  }

  /** Sends `payload` to this one connection, serialized as JSON. */
  public push(payload: unknown): void {
    this.socket.send(JSON.stringify(payload))
  }
}

/**
 * Sends an `ssr-module-changed` notification to every currently-connected {@linkcode SpaceDevSocket}
 * — the real, browser-facing counterpart of `SpaceDevEngine`'s `onSsrModuleChanged` callback
 * (`@zanix/space`'s own bundler module, which only reports the event; it has no notion of
 * WebSockets or connected clients itself). Callable from anywhere — a Vite plugin hook has no
 * `this` bound to any socket instance — via `ProgramModule.registry`, the same shared container
 * `SpaceDevSocket`'s own `this.registry` resolves to.
 *
 * A no-op if no browser is currently connected (an empty array, never an error). A connection
 * that fails to `send` (e.g. its underlying socket died without a clean close handshake ever
 * reaching `onclose`) is skipped, not left to break delivery to every OTHER connection — a
 * single stale entry must never turn one dev-server file change into a total notification outage.
 */
export function broadcastSsrModuleChanged(event: SsrModuleChangedEvent): void {
  const sockets = ProgramModule.registry.array<SpaceDevSocket>(
    CONNECTIONS_REGISTRY_KEY,
  )
  const payload = { kind: 'ssr-module-changed', ...event }
  for (const socket of sockets) {
    try {
      socket.push(payload)
    } catch {
      // Swallowed deliberately — see this function's own doc.
    }
  }
}

/**
 * Sends a `client-css-changed` notification to every currently-connected {@linkcode SpaceDevSocket}
 * — the real, browser-facing counterpart of `SpaceDevEngine`'s `onClientCssChanged` callback
 * (`@zanix/space`'s own bundler module, which only reports the event). `urls` are the exact
 * `?direct` hrefs `dev-css-hrefs.ts`'s `resolveDevCssHrefs` already put on the page's own
 * `<link rel="stylesheet">` tags — `dev-client-script.ts`'s own browser-side handler matches
 * against them directly, no separate id/manifest lookup needed on either side.
 *
 * Same no-op-when-nobody's-connected and skip-a-dead-socket behavior as
 * {@linkcode broadcastSsrModuleChanged} — see that function's own doc for why.
 */
export function broadcastClientCssChanged(urls: string[]): void {
  const sockets = ProgramModule.registry.array<SpaceDevSocket>(
    CONNECTIONS_REGISTRY_KEY,
  )
  const payload = { kind: 'client-css-changed', urls }
  for (const socket of sockets) {
    try {
      socket.push(payload)
    } catch {
      // Swallowed deliberately — see this function's own doc.
    }
  }
}

/**
 * Sends a `client-module-changed` notification to every currently-connected
 * {@linkcode SpaceDevSocket} — the real, browser-facing counterpart of `SpaceDevEngine`'s
 * `onClientModuleChanged` callback (`@zanix/space`'s own bundler module, which only reports the
 * event). `urls` are the same Vite module-graph urls `dev-vite-hot-client.ts`'s own
 * `createHotContext(id)` registered an `accept()` callback under — `dev-client-script.ts`'s own
 * `handleClientModuleChanged` matches against them directly, no separate id/manifest lookup needed.
 * Genuinely renderer-agnostic, not just in name — React's own `oxc.jsx`-based refresh transform and
 * Preact's own `@prefresh/vite` transform both register through the exact same `createHotContext`.
 *
 * Same as {@linkcode broadcastClientCssChanged} — a connected page whose dev-server orchestrator
 * hasn't served `dev-vite-hot-client.ts`'s own `/@vite/client` replacement yet (for either renderer)
 * simply has nothing registered to call and this message is a silent no-op there; see
 * `dev-client-script.ts`'s own doc for that guard.
 *
 * Same no-op-when-nobody's-connected and skip-a-dead-socket behavior as
 * {@linkcode broadcastSsrModuleChanged} — see that function's own doc for why.
 */
export function broadcastClientModuleChanged(urls: string[]): void {
  const sockets = ProgramModule.registry.array<SpaceDevSocket>(
    CONNECTIONS_REGISTRY_KEY,
  )
  const payload = { kind: 'client-module-changed', urls }
  for (const socket of sockets) {
    try {
      socket.push(payload)
    } catch {
      // Swallowed deliberately — see this function's own doc.
    }
  }
}

/**
 * Sends a `full-reload` notification to every currently-connected {@linkcode SpaceDevSocket} —
 * the real, browser-facing counterpart of `SpaceDevEngine`'s `onFullReloadNeeded` callback
 * (`@zanix/space`'s own bundler module, which only reports the event). Relays a REAL, previously
 * unreachable signal: Vite's own dependency optimizer calls `environment.hot.send({ type:
 * 'full-reload' })` internally whenever it needs to re-run mid-session (discovers a dependency it
 * didn't know about during its first scan) — real Vite's own dev server relies on its own
 * WebSocket/HMR channel to relay this to the browser, so the page reloads onto the now-settled,
 * consistent dependency set. This engine never binds that channel to anything real (`Deno.serve()`
 * is the only real listener — see `createSpaceDevEngine`'s own doc), so without this bridge, that
 * signal went nowhere: a real, confirmed incident (a mid-session re-optimize left a page holding a
 * STALE version-hash reference for one dependency, loading a second, duplicate module instance of
 * it — confirmed for `@prefresh/core`, silently breaking Preact Fast-Refresh, no error, no
 * automatic recovery, exactly the "not silently stuck" failure real Vite's own full-reload
 * already exists to prevent).
 *
 * Deliberately its own message `kind`, not reused from `ssr-module-changed`/`client-module-changed`
 * — this is a Vite-internal recovery signal, unrelated to any specific file changing, so it never
 * carries `affectedRoutes`/`urls` the way those two do; `dev-client-script.ts`'s own handler
 * reloads unconditionally, the same "no route/comet identity to compare against" case
 * `routeFilePath: undefined` already covers for `ssr-module-changed`.
 *
 * Same no-op-when-nobody's-connected and skip-a-dead-socket behavior as
 * {@linkcode broadcastSsrModuleChanged} — see that function's own doc for why.
 */
export function broadcastFullReloadNeeded(): void {
  const sockets = ProgramModule.registry.array<SpaceDevSocket>(
    CONNECTIONS_REGISTRY_KEY,
  )
  const payload = { kind: 'full-reload' }
  for (const socket of sockets) {
    try {
      socket.push(payload)
    } catch {
      // Swallowed deliberately — see this function's own doc.
    }
  }
}
