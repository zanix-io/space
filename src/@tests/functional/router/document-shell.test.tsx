import { assert, assertEquals } from '@std/assert'
import { loadRoutes, SpacePageController } from 'modules/router/mod.ts'
import { mockHandlerContext } from 'modules/testing/mod.ts'
import { stripHydrationComments } from '../../support/strip-hydration-comments.ts'
import HtmlLayoutFixturePage from '../../support/fixtures/html-layout-routes/page.tsx'

function Greeting() {
  return <p>hi</p>
}

class NoLayoutPage extends SpacePageController {
  public override component = Greeting
}

Deno.test(
  'SpacePageController.handleGet: with no root layout, wraps the page in a default HTML document',
  async () => {
    const ctx = mockHandlerContext()
    const page = new NoLayoutPage(ctx)

    const response = await page.handleGet(ctx)
    const html = stripHydrationComments(await response.text())

    assert(html.startsWith('<!DOCTYPE html>'), html)
    assert(html.includes('<html lang="en">'), html)
    assert(html.includes('charSet="utf-8"'), html)
    assert(html.includes('name="viewport"'), html)
    assert(html.includes('<body>'), html)
    assert(html.includes('<p>hi</p>'), html)
  },
)

Deno.test(
  "SpacePageController.handleGet: a page's own root layout.tsx providing <html> is trusted as-is, never double-wrapped",
  async () => {
    await loadRoutes('src/@tests/support/fixtures/html-layout-routes')

    const ctx = mockHandlerContext()
    const page = new HtmlLayoutFixturePage(ctx)

    const response = await page.handleGet(ctx)
    const html = stripHydrationComments(await response.text())

    assert(html.startsWith('<!DOCTYPE html>'), html)
    // Exactly one <html> tag — the root layout's own, never the default shell's on top of it.
    assertEquals(html.match(/<html[ >]/g)?.length, 1, html)
    assert(html.includes('<html lang="es">'), html)
    assert(html.includes('<title>Fixture app</title>'), html)
    assert(html.includes('data-testid="root-html-layout-body"'), html)
    assert(html.includes('home with custom html layout'), html)
  },
)
