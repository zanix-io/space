// Installs a renderer, exactly as a real app does: `@zanix/space` itself ships none, so a
// test that renders must import the entry point it is testing against.
import '../../../../mod-react.ts'
import { assert, assertEquals } from '@std/assert'
import { bootstrapServers, Guard, webServerManager } from '@zanix/server'
import { Page, SpacePageController } from 'modules/router/mod.ts'
import { csrfGuard } from 'modules/middleware/mod.ts'

function CheckoutView({ csrfToken }: { csrfToken?: string }) {
  return (
    <form method='post'>
      <input type='hidden' name='_csrf' value={csrfToken} />
      <button type='submit'>Pay</button>
    </form>
  )
}

@Page({ path: 'csrf-guard/checkout', headers: false })
@Guard(csrfGuard())
class CheckoutPage extends SpacePageController {
  public override loader = (ctx: { csrfToken?: string }) => ({
    csrfToken: ctx.csrfToken,
  })
  public override component = CheckoutView
  public override action = () => Promise.resolve(new Response('paid'))
}
void CheckoutPage

Deno.test(
  'csrfGuard end to end: the token rendered into the page matches the issued cookie, a POST ' +
    'without it is rejected, and the SAME token submitted back is accepted',
  async () => {
    const servers = await bootstrapServers({ ssr: { port: 20501 } })
    try {
      const getRes = await fetch('http://localhost:20501/csrf-guard/checkout')
      const setCookie = getRes.headers.get('set-cookie')
      assert(setCookie, 'expected csrfGuard to issue a Set-Cookie on GET')
      const cookieToken = setCookie.match(/X-Znx-Csrf=([^;]+)/)?.[1]
      assert(cookieToken, 'expected to extract the csrf cookie value')

      const html = await getRes.text()
      const renderedToken = html.match(/name="_csrf" value="([^"]+)"/)?.[1]
      assert(
        renderedToken,
        'expected to extract the rendered form field value',
      )
      assertEquals(renderedToken, cookieToken)

      // No cookie, no field: rejected.
      const withoutToken = await fetch(
        'http://localhost:20501/csrf-guard/checkout',
        {
          method: 'POST',
          body: new FormData(),
        },
      )
      assertEquals(withoutToken.status, 403)
      await withoutToken.body?.cancel()

      // The cookie the browser would have stored, PLUS the token the page itself rendered —
      // exactly what a real, unmodified form submission produces.
      const formData = new FormData()
      formData.set('_csrf', renderedToken)
      const withToken = await fetch(
        'http://localhost:20501/csrf-guard/checkout',
        {
          method: 'POST',
          headers: { cookie: `X-Znx-Csrf=${cookieToken}` },
          body: formData,
        },
      )
      assertEquals(withToken.status, 200)
      assertEquals(await withToken.text(), 'paid')
    } finally {
      await webServerManager.stop(servers)
    }
  },
)
