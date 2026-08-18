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
