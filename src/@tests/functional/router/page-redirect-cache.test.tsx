// Installs a renderer, exactly as a real app does: `@zanix/space` itself ships none, so a
// test that renders must import the entry point it is testing against.
import '../../../../mod-react.ts'
import { assert, assertEquals } from '@std/assert'
import { SpacePageController } from 'modules/router/mod.ts'
import { mockHandlerContext } from 'modules/testing/mod.ts'

function View({ value }: { value?: string }) {
  return <p>{value ?? 'no-value'}</p>
}

Deno.test(
  'SpacePageController.handleGet: an unconditional redirect short-circuits before loader/component run',
  async () => {
    let loaderCalls = 0
    class RedirectPage extends SpacePageController {
      public static override redirect = { to: '/target' }
      public override component = View
      public override loader = () => {
        loaderCalls++
        return { value: 'unused' }
      }
    }

    const ctx = mockHandlerContext()
    const response = await new RedirectPage(ctx).handleGet(ctx)

    assertEquals(response.status, 301)
    assertEquals(response.headers.get('location'), 'http://localhost/target')
    assertEquals(loaderCalls, 0)
    await response.body?.cancel()
  },
)

Deno.test(
  'SpacePageController.handleGet: redirect honors an explicit status code',
  async () => {
    class RedirectPage extends SpacePageController {
      public static override redirect = { to: '/target', code: 307 as const }
      public override component = View
    }

    const response = await new RedirectPage(mockHandlerContext()).handleGet(
      mockHandlerContext(),
    )

    assertEquals(response.status, 307)
    await response.body?.cancel()
  },
)

Deno.test(
  'SpacePageController.handleGet: a redirect condition that returns false falls through to a normal render',
  async () => {
    class ConditionalRedirectPage extends SpacePageController {
      public static override redirect = {
        to: '/target',
        condition: () => false,
      }
      public override component = View
      public override loader = () => ({ value: 'rendered' })
    }

    const ctx = mockHandlerContext()
    const response = await new ConditionalRedirectPage(ctx).handleGet(ctx)

    assertEquals(response.status, 200)
    assert((await response.text()).includes('rendered'))
  },
)

Deno.test(
  'SpacePageController.handleGet: cacheControl sets Cache-Control and a stable ETag',
  async () => {
    class CachedPage extends SpacePageController {
      public static override cacheControl = 'public, max-age=60'
      public override component = View
      public override loader = () => ({ value: 'cached' })
    }

    const ctx = mockHandlerContext()
    const response = await new CachedPage(ctx).handleGet(ctx)

    assertEquals(response.status, 200)
    assertEquals(response.headers.get('cache-control'), 'public, max-age=60')
    const etag = response.headers.get('etag')
    assert(etag && etag.length > 0)
    await response.body?.cancel()
  },
)

Deno.test(
  'SpacePageController.handleGet: a matching If-None-Match short-circuits to a bodyless 304',
  async () => {
    class CachedPage extends SpacePageController {
      public static override cacheControl = 'public, max-age=60'
      public override component = View
      public override loader = () => ({ value: 'cached' })
    }

    const first = await new CachedPage(mockHandlerContext()).handleGet(
      mockHandlerContext(),
    )
    const etag = first.headers.get('etag')
    assert(etag)
    await first.body?.cancel()

    const secondCtx = mockHandlerContext({
      req: new Request('http://localhost/', {
        headers: { 'if-none-match': etag },
      }),
    })
    const second = await new CachedPage(secondCtx).handleGet(secondCtx)

    assertEquals(second.status, 304)
    assertEquals(second.headers.get('etag'), etag)
    assertEquals(await second.text(), '')
  },
)

Deno.test(
  'SpacePageController.handleGet: a stale If-None-Match still renders the full page',
  async () => {
    class CachedPage extends SpacePageController {
      public static override cacheControl = 'public, max-age=60'
      public override component = View
      public override loader = () => ({ value: 'cached' })
    }

    const ctx = mockHandlerContext({
      req: new Request('http://localhost/', {
        headers: { 'if-none-match': '"stale"' },
      }),
    })
    const response = await new CachedPage(ctx).handleGet(ctx)

    assertEquals(response.status, 200)
    assert((await response.text()).includes('cached'))
  },
)

Deno.test(
  'SpacePageController.handleGet: cacheControl as a function derives its value from loader data and ctx',
  async () => {
    class SessionCachedPage extends SpacePageController {
      public static override cacheControl = (
        _data: unknown,
        ctx: { session?: unknown },
      ) => (ctx.session ? 'private, no-cache' : 'no-store')
      public override component = View
      public override loader = () => ({ value: 'session-aware' })
    }

    const anonymousCtx = mockHandlerContext()
    const anonymousResponse = await new SessionCachedPage(anonymousCtx).handleGet(anonymousCtx)
    assertEquals(anonymousResponse.headers.get('cache-control'), 'no-store')
    await anonymousResponse.body?.cancel()

    const sessionCtx = mockHandlerContext({
      // deno-lint-ignore no-explicit-any
      session: { userId: 'u1' } as any,
    })
    const sessionResponse = await new SessionCachedPage(sessionCtx).handleGet(sessionCtx)
    assertEquals(sessionResponse.headers.get('cache-control'), 'private, no-cache')
    await sessionResponse.body?.cancel()
  },
)

Deno.test(
  'SpacePageController.handleGet: cacheControl as a function returning undefined disables caching for that response',
  async () => {
    class ConditionallyCachedPage extends SpacePageController {
      public static override cacheControl = () => undefined
      public override component = View
      public override loader = () => ({ value: 'uncached' })
    }

    const ctx = mockHandlerContext()
    const response = await new ConditionallyCachedPage(ctx).handleGet(ctx)

    assertEquals(response.status, 200)
    assertEquals(response.headers.get('cache-control'), null)
    assertEquals(response.headers.get('etag'), null)
    assert((await response.text()).includes('uncached'))
  },
)

Deno.test(
  'SpacePageController.handleGet: a matching If-None-Match still short-circuits to 304 under the function form',
  async () => {
    class SessionCachedPage extends SpacePageController {
      public static override cacheControl = () => 'private, no-cache'
      public override component = View
      public override loader = () => ({ value: 'session-aware' })
    }

    const first = await new SessionCachedPage(mockHandlerContext()).handleGet(
      mockHandlerContext(),
    )
    const etag = first.headers.get('etag')
    assert(etag)
    await first.body?.cancel()

    const secondCtx = mockHandlerContext({
      req: new Request('http://localhost/', {
        headers: { 'if-none-match': etag },
      }),
    })
    const second = await new SessionCachedPage(secondCtx).handleGet(secondCtx)

    assertEquals(second.status, 304)
    assertEquals(second.headers.get('etag'), etag)
    assertEquals(second.headers.get('cache-control'), 'private, no-cache')
    assertEquals(await second.text(), '')
  },
)
