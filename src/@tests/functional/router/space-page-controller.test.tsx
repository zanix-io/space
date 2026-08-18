// Installs a renderer, exactly as a real app does: `@zanix/space` itself ships none, so a
// test that renders must import the entry point it is testing against.
import '../../../../mod-react.ts'
import { assert, assertEquals, assertMatch, assertRejects } from '@std/assert'
import { HttpError } from '@zanix/errors'
import { SpacePageController } from 'modules/router/mod.ts'
import { mockHandlerContext } from 'modules/testing/mod.ts'
import { stripHydrationComments } from '../../support/strip-hydration-comments.ts'

console.error = () => {}

function Greeting({ name }: { name?: string }) {
  return <p>Hello, {name ?? 'stranger'}</p>
}

class GreetingPage extends SpacePageController<{ name: string }> {
  public override component = Greeting
  public override loader = (ctx: { params: { name: string } }) => ({
    name: ctx.params.name,
  })
}

class NoLoaderPage extends SpacePageController {
  public override component = Greeting
}

class ActionPage extends SpacePageController {
  public override component = Greeting
  public override action = async (
    ctx: { formData: () => Promise<FormData> },
  ) => {
    const formData = await ctx.formData()
    return new Response(`got ${formData.get('name')}`)
  }
}

Deno.test(
  'SpacePageController.handleGet: runs loader, renders component with its data',
  async () => {
    const ctx = mockHandlerContext({
      payload: { params: { name: 'Ana' }, search: {}, body: undefined },
    })
    const page = new GreetingPage(ctx)

    const response = await page.handleGet(ctx)

    assertEquals(response.status, 200)
    const html = await response.text()
    assertMatch(stripHydrationComments(html), /Hello, Ana/)
  },
)

Deno.test(
  'SpacePageController.handleGet: renders with undefined props with no loader',
  async () => {
    const ctx = mockHandlerContext()
    const page = new NoLoaderPage(ctx)

    const response = await page.handleGet(ctx)

    const html = await response.text()
    assertMatch(stripHydrationComments(html), /Hello, stranger/)
    assert(!html.includes('__ZANIX_SPACE_STATE__'))
  },
)

Deno.test('SpacePageController.handlePost: throws METHOD_NOT_ALLOWED with no action', async () => {
  const ctx = mockHandlerContext()
  const page = new NoLoaderPage(ctx)

  const error = await assertRejects(() => page.handlePost(ctx), HttpError)
  assertEquals((error as HttpError).status.code, 'METHOD_NOT_ALLOWED')
})

Deno.test('SpacePageController.handlePost: invokes action with formData access', async () => {
  const formData = new FormData()
  formData.set('name', 'Ana')
  const ctx = mockHandlerContext({
    req: new Request('http://localhost/', { method: 'POST', body: formData }),
  })
  const page = new ActionPage(ctx)

  const response = await page.handlePost(ctx)

  assertEquals(await response.text(), 'got Ana')
})
