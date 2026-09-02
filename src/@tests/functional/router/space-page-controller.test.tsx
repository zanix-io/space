// Installs a renderer, exactly as a real app does: `@zanix/space` itself ships none, so a
// test that renders must import the entry point it is testing against.
import '../../../../mod-react.ts'
import { assert, assertEquals, assertMatch, assertRejects } from '@std/assert'
import { HttpError } from '@zanix/errors'
import type { Session } from '@zanix/server'
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

class SessionPage extends SpacePageController {
  public override component = Greeting
  public override loader = (ctx: { session?: Session }) => ({
    name: ctx.session?.id,
  })
}

class CspNoncePage extends SpacePageController {
  public override component = Greeting
  public override loader = (ctx: { cspNonce?: string }) => ({
    name: ctx.cspNonce,
  })
}

class CspDisabledPage extends SpacePageController {
  public static override headers = { csp: false as const }
  public override component = Greeting
  public override loader = (ctx: { cspNonce?: string }) => ({
    name: ctx.cspNonce,
  })
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

Deno.test(
  'SpacePageController.handleGet: loader receives a page-level @Guard-resolved session off ' +
    'ctx.locals.session',
  async () => {
    const session: Session = { id: 'guard-user', type: 'user', rateLimit: 100 }
    const ctx = mockHandlerContext({ locals: { session } })
    const page = new SessionPage(ctx)

    const response = await page.handleGet(ctx)

    const html = await response.text()
    assertMatch(stripHydrationComments(html), /Hello, guard-user/)
  },
)

Deno.test(
  'SpacePageController.handleGet: loader falls back to ctx.session when no @Guard set locals.session',
  async () => {
    const session: Session = { id: 'earlier-user', type: 'user', rateLimit: 100 }
    const ctx = mockHandlerContext({ session })
    const page = new SessionPage(ctx)

    const response = await page.handleGet(ctx)

    const html = await response.text()
    assertMatch(stripHydrationComments(html), /Hello, earlier-user/)
  },
)

Deno.test(
  'SpacePageController.handleGet: loader prefers ctx.locals.session over an earlier ctx.session',
  async () => {
    const earlier: Session = { id: 'earlier-user', type: 'user', rateLimit: 100 }
    const fresher: Session = { id: 'guard-user', type: 'user', rateLimit: 100 }
    const ctx = mockHandlerContext({ session: earlier, locals: { session: fresher } })
    const page = new SessionPage(ctx)

    const response = await page.handleGet(ctx)

    const html = await response.text()
    assertMatch(stripHydrationComments(html), /Hello, guard-user/)
  },
)

Deno.test(
  "SpacePageController.handleGet: loader receives this request's own REAL CSP nonce off " +
    "ctx.cspNonce — the exact same value this response's own <style nonce>/<script nonce> carry, " +
    'not a stale snapshot taken before cspGuard ever ran. Real, confirmed regression this pins: ' +
    'toPageContext() builds pageCtx (snapshotting ctx.locals[CSP_NONCE_LOCALS_KEY]) BEFORE ' +
    'resolvePageChrome ever calls cspGuard for this request, so a naive read always saw undefined ' +
    "here — caught live in a real browser as a Comet's own <style nonce> rendered with no nonce " +
    'attribute at all, blocked outright by CSP. handleGet must reassign pageCtx.cspNonce AFTER ' +
    'resolvePageChrome resolves, from the SAME nonce it already returns — never a second, ' +
    'independent read.',
  async () => {
    const ctx = mockHandlerContext()
    const page = new CspNoncePage(ctx)

    const response = await page.handleGet(ctx)

    const html = await response.text()
    // Zero-config CSP generates a fresh nonce per request — nothing to hardcode. Pulled from the
    // SAME response's own <style nonce="..."> (BUILTIN_CSS, always rendered) as the independent
    // source of truth for "what nonce did this request actually get".
    const [, realNonce] = html.match(/<style nonce="([^"]+)"/) ?? []
    assert(realNonce, html)
    // A real nonce is base64 (`+`/`/` included) — escaped before building a RegExp from it, or
    // those characters would be read as regex quantifiers/alternation instead of literal text.
    const escapedNonce = realNonce.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    assertMatch(stripHydrationComments(html), new RegExp(`Hello, ${escapedNonce}`))
  },
)

Deno.test(
  'SpacePageController.handleGet: ctx.cspNonce is undefined when a page disables CSP via ' +
    "headers: { csp: false } — never a crash, never a stray '', and no nonce attribute anywhere " +
    'in the document at all',
  async () => {
    const ctx = mockHandlerContext()
    const page = new CspDisabledPage(ctx)

    const response = await page.handleGet(ctx)

    const html = await response.text()
    assertMatch(stripHydrationComments(html), /Hello, stranger/)
    assert(!html.includes('nonce='), html)
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
