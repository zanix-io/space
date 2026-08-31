// deno-coverage-ignore-file
// A `Deno.test`-wrapped script, run only as its own `deno test` subprocess (never discovered by
// this repo's own `deno.jsonc` test glob — it doesn't end in `.test.ts`) — see
// `error-boundary-hydration-marker.test.tsx`'s own doc for why: `react-dom/server`'s dev-vs-
// production branch is a module-load-time decision, so a genuine production-mode assertion needs a
// real, isolated process, never `Deno.env.set` in the same one. `Deno.test` wraps it (rather than
// running as a plain top-level script via `deno run`) because a bare `deno run` of this exact
// render hung indefinitely in this sandbox for reasons that didn't reproduce reliably enough to
// chase down, while the identical render inside `Deno.test` — the shape every OTHER test in this
// package already uses — does not.
import '@zanix/space/react'
import { loadRoutes } from 'modules/router/mod.ts'
import { mockHandlerContext } from 'modules/testing/mod.ts'
import LayoutErrorFixturePage from '../fixtures/layout-error-routes/page.tsx'

console.error = () => {}

Deno.test('render layout-error fixture', async () => {
  await loadRoutes('src/@tests/support/fixtures/layout-error-routes')
  const ctx = mockHandlerContext()
  const response = await new LayoutErrorFixturePage(ctx).handleGet(ctx)
  // Written to a file, never `console.log`ed — `deno test`'s own default reporter wraps a test's
  // stdout in a "------- output -------" banner (plus ANSI color codes), which the parent test
  // spawning this subprocess would otherwise have to parse back out. `OUTPUT_FILE` is set by that
  // parent test (`error-boundary-hydration-marker.test.tsx`).
  const outputFile = Deno.env.get('OUTPUT_FILE')
  if (!outputFile) throw new Error('OUTPUT_FILE env var not set')
  await Deno.writeTextFile(outputFile, await response.text())
})
