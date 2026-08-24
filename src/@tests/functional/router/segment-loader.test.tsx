import { assert } from '@std/assert'
// Side-effect only — installs the React renderer, exactly `import '@zanix/space/react'` from an
// app's own main module. `handleGet` throws `'No renderer is installed'` without it; other
// functional router tests in this same file batch get this for free only when a sibling file
// (`loading-routes`'s own fixture) happens to import it first — explicit here rather than relying
// on that ordering accident.
import '../../../../mod-react.ts'
import { loadRoutes } from 'modules/router/mod.ts'
import { mockHandlerContext } from 'modules/testing/mod.ts'
import { stripHydrationComments } from '../../support/strip-hydration-comments.ts'
import SegmentLoaderFixturePage from '../../support/fixtures/segment-loader-routes/[id]/page.tsx'

// Same static-import convention `page-composition.test.tsx` already establishes: this import
// resolves to the exact same module instance `loadRoutes()` itself imports, so the class below is
// the very one `loadRoutes()` populates via `setPageTree()`.

Deno.test(
  "SpacePageController.handleGet: a layout's own loader resolves and reaches it as `data` — " +
    'both the root layout and a nested one, each with its own loader',
  async () => {
    await loadRoutes('src/@tests/support/fixtures/segment-loader-routes')

    const ctx = mockHandlerContext({
      payload: { params: { id: 'p-42' }, search: {}, body: undefined },
    })
    const page = new SegmentLoaderFixturePage(ctx)
    const response = await page.handleGet(ctx)

    assert(response.status === 200, `expected 200, got ${response.status}`)
    const html = stripHydrationComments(await response.text())

    assert(html.includes('data-testid="root-layout"'), html)
    assert(html.includes('data-root-source="root"'), html)
    assert(html.includes('data-testid="nested-layout"'), html)
    assert(html.includes('data-nested-id="p-42"'), html)
    assert(html.includes('data-testid="fixture-page"'), html)
  },
)

Deno.test(
  "SpacePageController.handleGet: a nested layout's own loader receives THIS request's real " +
    'route params — a different id produces a different rendered value, not a cached/stale one',
  async () => {
    await loadRoutes('src/@tests/support/fixtures/segment-loader-routes')

    const ctx = mockHandlerContext({
      payload: { params: { id: 'p-other' }, search: {}, body: undefined },
    })
    const page = new SegmentLoaderFixturePage(ctx)
    const response = await page.handleGet(ctx)

    const html = stripHydrationComments(await response.text())
    assert(html.includes('data-nested-id="p-other"'), html)
    assert(!html.includes('data-nested-id="p-42"'), html)
  },
)

// Real-Preact-renderer coverage of the SAME segment-loader mechanism (root + nested layout, each
// with its own `loader`, `data` reaching each correctly) lives in `request-dedupe.test.tsx`'s own
// Preact test instead of being duplicated here — that fixture's own layouts already exercise this
// exact mechanism (segment-level `loader` → `data`), on top of dedup, through a real Preact render.
// A separate attempt here would need its own non-JSX fixture (JSX in this package's own tree always
// compiles against its fixed `jsxImportSource: 'react'`, so a JSX-authored fixture can never
// validly exercise Preact — see `define-comet.ts`'s own doc for the identical reasoning behind
// `getCometElementFactory`), and building that twice for the same underlying mechanism isn't worth
// the duplication.
