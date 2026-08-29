// Installs a renderer, exactly as a real app does: `@zanix/space` itself ships none, so a
// test that renders must import the entry point it is testing against.
import '../../../../mod-react.ts'
import { assert, assertEquals } from '@std/assert'
import { bootstrapServers, ProgramModule, webServerManager } from '@zanix/server'
import { loadRoutes } from 'modules/router/mod.ts'
import {
  broadcastClientCssChanged,
  broadcastClientModuleChanged,
  broadcastFullReloadNeeded,
  broadcastSsrModuleChanged,
  SPACE_DEV_SOCKET_ROUTE,
} from 'modules/dev/mod.ts'

// `CONNECTIONS_REGISTRY_KEY` in `space-dev-socket.ts` is a private, unexported constant — its
// literal value is reproduced here, the only way to reach the same shared connections registry
// directly from outside that module.
const CONNECTIONS_REGISTRY_KEY = 'zanix-space-dev-sockets'

Deno.test(
  'SpaceDevSocket: shares a port with ssr and broadcasts a real message to a connected client',
  async () => {
    // Gives the `'ssr'` type at least one real route, so the listener actually starts — and
    // proves this is the SAME listener the socket shares (a real page request over the same
    // port, at the end).
    await loadRoutes('src/@tests/support/fixtures/redundant-reload-routes')

    // `finalize: false` — this file runs a second test below, sharing the SAME decorator-based
    // `@Socket` registration for `SpaceDevSocket` (it only registers once, when this module was
    // first imported — nothing re-runs that decorator later). The default `finalize: true` wipes
    // that registration once this call's own boot sequence finishes, which would leave the next
    // test's `bootstrapServers({ socket: {...} })` with zero socket routes to bind at all. See
    // `docs/handlers.md → Applications → Boot sessions` in `@zanix/server` for why this only
    // matters for a multi-call sequence, never a single standalone call.
    const port = 21001
    const servers = await bootstrapServers(
      { ssr: { port }, socket: { port } },
      { finalize: false },
    )
    try {
      const ws = new WebSocket(
        `ws://localhost:${port}/socket/${SPACE_DEV_SOCKET_ROUTE}`,
      )
      await new Promise((resolve) => (ws.onopen = resolve))

      const received = new Promise<string>((resolve) => {
        ws.onmessage = (event) => resolve(event.data)
      })

      broadcastSsrModuleChanged({
        file: '/routes/products/page.tsx',
        changeType: 'update',
        affectedRoutes: ['/routes/products/page.tsx'],
        isComet: false,
      })

      const message = JSON.parse(await received)
      assertEquals(message, {
        kind: 'ssr-module-changed',
        file: '/routes/products/page.tsx',
        changeType: 'update',
        isComet: false,
        affectedRoutes: ['/routes/products/page.tsx'],
      })

      // Same port, a real page request — confirms this is genuine port sharing (the multiplexer
      // dispatching by first URL segment), not two coincidentally-adjacent listeners.
      const pageRes = await fetch(`http://localhost:${port}`)
      assertEquals(pageRes.status, 200)

      // Waited out, not fire-and-forget: `ProgramModule.registry` (where `SpaceDevSocket` tracks
      // open connections) is process-wide, not scoped to this one `bootstrapServers()` call — an
      // unawaited close here would leave a dead connection behind for a LATER test in this same
      // file to trip over.
      const closed = new Promise((resolve) => ws.addEventListener('close', resolve))
      ws.close()
      await closed
    } finally {
      await webServerManager.stop(servers)
    }
  },
)

Deno.test(
  'SpaceDevSocket: broadcastClientCssChanged delivers a client-css-changed message over the same channel',
  async () => {
    // `finalize: false` — same reasoning as the first test above: this file still has one more
    // test after this one relying on `SpaceDevSocket`'s own decorator-time `@Socket` registration
    // staying alive. The default `finalize: true` would wipe it here, leaving that next test's own
    // `bootstrapServers({ socket: {...} })` with zero socket routes to bind — its `new
    // WebSocket(...)` would then hang forever waiting for an `onopen` that never fires, since a
    // route-less socket listener never actually starts (confirmed the hard way: this test
    // originally used the default finalize, and it broke exactly that next test).
    const port = 21003
    const servers = await bootstrapServers({ socket: { port } }, {
      finalize: false,
    })
    try {
      const ws = new WebSocket(
        `ws://localhost:${port}/socket/${SPACE_DEV_SOCKET_ROUTE}`,
      )
      await new Promise((resolve) => (ws.onopen = resolve))

      const received = new Promise<string>((resolve) => {
        ws.onmessage = (event) => resolve(event.data)
      })

      broadcastClientCssChanged(['/app.css?direct'])

      const message = JSON.parse(await received)
      assertEquals(message, {
        kind: 'client-css-changed',
        urls: ['/app.css?direct'],
      })

      const closed = new Promise((resolve) => ws.addEventListener('close', resolve))
      ws.close()
      await closed
    } finally {
      await webServerManager.stop(servers)
    }
  },
)

Deno.test(
  'SpaceDevSocket: broadcastClientModuleChanged delivers a client-module-changed message',
  async () => {
    // `finalize: false` — same reasoning as the two tests above: the `onclose` test right after
    // this one still relies on `SpaceDevSocket`'s own decorator-time `@Socket` registration staying
    // alive.
    const port = 21004
    const servers = await bootstrapServers({ socket: { port } }, {
      finalize: false,
    })
    try {
      const ws = new WebSocket(
        `ws://localhost:${port}/socket/${SPACE_DEV_SOCKET_ROUTE}`,
      )
      await new Promise((resolve) => (ws.onopen = resolve))

      const received = new Promise<string>((resolve) => {
        ws.onmessage = (event) => resolve(event.data)
      })

      broadcastClientModuleChanged(['/comets/counter.tsx'])

      const message = JSON.parse(await received)
      assertEquals(message, {
        kind: 'client-module-changed',
        urls: ['/comets/counter.tsx'],
      })

      const closed = new Promise((resolve) => ws.addEventListener('close', resolve))
      ws.close()
      await closed
    } finally {
      await webServerManager.stop(servers)
    }
  },
)

Deno.test(
  'SpaceDevSocket: broadcastFullReloadNeeded delivers a bare full-reload message',
  async () => {
    // `finalize: false` — same reasoning as the tests above: the `onclose` test right after this
    // one still relies on `SpaceDevSocket`'s own decorator-time `@Socket` registration staying
    // alive.
    const port = 21005
    const servers = await bootstrapServers({ socket: { port } }, {
      finalize: false,
    })
    try {
      const ws = new WebSocket(
        `ws://localhost:${port}/socket/${SPACE_DEV_SOCKET_ROUTE}`,
      )
      await new Promise((resolve) => (ws.onopen = resolve))

      const received = new Promise<string>((resolve) => {
        ws.onmessage = (event) => resolve(event.data)
      })

      broadcastFullReloadNeeded()

      const message = JSON.parse(await received)
      assertEquals(message, { kind: 'full-reload' })

      const closed = new Promise((resolve) => ws.addEventListener('close', resolve))
      ws.close()
      await closed
    } finally {
      await webServerManager.stop(servers)
    }
  },
)

Deno.test(
  'broadcast*: a connection whose own push throws is skipped, without breaking delivery to the ' +
    'others — real transport bypassed entirely, a manufactured registry entry stands in for a ' +
    'connection whose underlying socket died without a clean close handshake ever reaching onclose',
  () => {
    const received: unknown[] = []
    const deadConnection = {
      push: () => {
        throw new Error('simulated dead connection')
      },
    }
    const goodConnection = {
      push: (payload: unknown) => received.push(payload),
    }
    // deno-lint-ignore no-explicit-any -- a manufactured stand-in, never a real SpaceDevSocket
    ProgramModule.registry.set(CONNECTIONS_REGISTRY_KEY, [deadConnection, goodConnection] as any)
    try {
      broadcastSsrModuleChanged({
        file: '/routes/products/page.tsx',
        changeType: 'update',
        affectedRoutes: [],
        isComet: false,
      })
      broadcastClientCssChanged(['/app.css?direct'])
      broadcastClientModuleChanged(['/comets/counter.tsx'])
      broadcastFullReloadNeeded()

      assertEquals(received.length, 4)
      assertEquals((received[0] as { kind: string }).kind, 'ssr-module-changed')
      assertEquals((received[1] as { kind: string }).kind, 'client-css-changed')
      assertEquals((received[2] as { kind: string }).kind, 'client-module-changed')
      assertEquals((received[3] as { kind: string }).kind, 'full-reload')
    } finally {
      // deno-lint-ignore no-explicit-any
      ProgramModule.registry.set(CONNECTIONS_REGISTRY_KEY, [] as any)
    }
  },
)

Deno.test({
  name: 'SpaceDevSocket: onclose removes the connection, so a later broadcast never reaches it',
  // The client-side `ws.close()` in this test leaves an internal op Deno's test sanitizer never
  // observes settling (confirmed NOT a real hang: the identical sequence, run as a plain script
  // outside `deno test`, completes and prints its result normally) — a known category of
  // flakiness testing WebSocket close from the client side under `deno test`, not a bug in
  // `SpaceDevSocket`/`broadcastSsrModuleChanged` itself.
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    // No `ssr` server here — this test is about the socket's own connection lifecycle, not port
    // sharing (already covered above), and every route this fixture provides has already been
    // registered by the test above, so a plain `import()`-cache-hit reimport of it here would
    // never re-register anyway (see `loadRoutes`'s own doc on that constraint).
    const port = 21002
    const servers = await bootstrapServers({ socket: { port } })
    try {
      const ws = new WebSocket(
        `ws://localhost:${port}/socket/${SPACE_DEV_SOCKET_ROUTE}`,
      )
      await new Promise((resolve) => (ws.onopen = resolve))

      const closed = new Promise((resolve) => ws.addEventListener('close', resolve))
      ws.close()
      await closed
      // Let the server-side `onclose` handler (async relative to the client-side close event)
      // actually run before broadcasting.
      await new Promise((resolve) => setTimeout(resolve, 50))

      let received = false
      ws.onmessage = () => {
        received = true
      }

      broadcastSsrModuleChanged({
        file: '/routes/products/page.tsx',
        changeType: 'update',
        affectedRoutes: [],
        isComet: false,
      })

      // Nothing to await on a closed socket — a short grace period is the only way to observe
      // "never arrives," short enough to keep the test fast, long enough that a real delivery
      // would have shown up.
      await new Promise((resolve) => setTimeout(resolve, 100))
      assert(!received)
    } finally {
      await webServerManager.stop(servers)
    }
  },
})
