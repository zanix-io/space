import { assert, assertEquals } from '@std/assert'
import { bootstrapServers, webServerManager } from '@zanix/server'
import { createNotFoundHandler, loadRoutes } from 'modules/router/mod.ts'
import { ORBIT_FRAGMENT_HEADER, ORBIT_OUTLET_ATTR } from 'modules/router/orbit-protocol.ts'
import { stripHydrationComments } from '../../support/strip-hydration-comments.ts'

Deno.test(
  'not-found end to end: a matched route renders normally, an unmatched one renders the ' +
    "app's not-found.tsx wrapped in the same root layout, with a real 404 status",
  async () => {
    await loadRoutes('src/@tests/support/fixtures/not-found-routes')

    // `finalize: false` — this file runs three of these against the same route fixture; the
    // default `finalize: true` would wipe the route registry after this call, and `loadRoutes`
    // re-importing the same fixture module is a cache-hit no-op (its `@Page()` decorator already
    // ran once), so a later test in this file would find no routes registered at all. See
    // `bootstrapServers`'s own doc on `finalize` for why this only matters for a multi-call
    // sequence, never a single standalone call.
    const servers = await bootstrapServers({
      ssr: { port: 20701, onError: createNotFoundHandler() },
    }, { finalize: false })

    try {
      const okRes = await fetch('http://localhost:20701/not-found-fixture')
      assertEquals(okRes.status, 200)
      const okHtml = stripHydrationComments(await okRes.text())
      assert(okHtml.includes('data-testid="app-shell"'), okHtml)
      assert(okHtml.includes('home'), okHtml)

      const missingRes = await fetch('http://localhost:20701/this-route-does-not-exist')
      assertEquals(missingRes.status, 404)
      const missingHtml = stripHydrationComments(await missingRes.text())
      assert(missingHtml.includes('data-testid="app-shell"'), missingHtml)
      assert(missingHtml.includes('data-testid="custom-not-found"'), missingHtml)
      assert(missingHtml.includes('nothing here'), missingHtml)
    } finally {
      await webServerManager.stop(servers)
    }
  },
)

Deno.test(
  'not-found end to end: an Orbit navigation to a missing route still gets the full document ' +
    'when attachRequestToErrors is not enabled (the safe default)',
  async () => {
    await loadRoutes('src/@tests/support/fixtures/not-found-routes')

    // `finalize: false` — see the first test in this file for why.
    const servers = await bootstrapServers({
      ssr: { port: 20703, onError: createNotFoundHandler() },
    }, { finalize: false })

    try {
      const res = await fetch('http://localhost:20703/this-route-does-not-exist', {
        headers: { [ORBIT_FRAGMENT_HEADER]: '1' },
      })
      assertEquals(res.status, 404)
      const html = stripHydrationComments(await res.text())
      assert(html.startsWith('<!DOCTYPE html>'), html)
      assert(html.includes('data-testid="app-shell"'), html)
      assert(html.includes('data-testid="custom-not-found"'), html)
    } finally {
      await webServerManager.stop(servers)
    }
  },
)

Deno.test(
  'not-found end to end: an Orbit navigation to a missing route gets just the outlet fragment ' +
    'once attachRequestToErrors is enabled',
  async () => {
    await loadRoutes('src/@tests/support/fixtures/not-found-routes')

    const servers = await bootstrapServers({
      ssr: { port: 20704, onError: createNotFoundHandler(), attachRequestToErrors: true },
    })

    try {
      const res = await fetch('http://localhost:20704/this-route-does-not-exist', {
        headers: { [ORBIT_FRAGMENT_HEADER]: '1' },
      })
      assertEquals(res.status, 404)
      const html = stripHydrationComments(await res.text())
      assert(!html.includes('<!DOCTYPE html>'), html)
      assert(!html.includes('<html'), html)
      assert(!html.includes('data-testid="app-shell"'), html)
      assert(html.includes(`${ORBIT_OUTLET_ATTR}=""`), html)
      assert(html.includes('data-testid="custom-not-found"'), html)

      // A plain, non-Orbit request still gets the full document even with the flag enabled — the
      // flag only makes the request *available* to `onError`, it never forces fragment rendering.
      const fullRes = await fetch('http://localhost:20704/this-route-does-not-exist')
      const fullHtml = stripHydrationComments(await fullRes.text())
      assert(fullHtml.startsWith('<!DOCTYPE html>'), fullHtml)
    } finally {
      await webServerManager.stop(servers)
    }
  },
)
