// Installs a renderer, exactly as a real app does: `@zanix/space` itself ships none, so a test
// that renders (this file's second test, below) must import the entry point it is testing
// against.
import '../../../../mod-react.ts'
import { assert, assertEquals } from '@std/assert'
import { join, relative } from '@std/path'
import { bootstrapServers, ProgramModule, webServerManager } from '@zanix/server'
import { getTemporaryFolder } from '@zanix/helpers'
import { createSpaceDevEngine } from 'modules/bundler/dev-engine.ts'
import { loadRoutes } from 'modules/router/mod.ts'

const TMP_ROOT = getTemporaryFolder(import.meta.url)
const isRouteEntry = (id: string) => id.endsWith('/page.tsx') || id.endsWith('page.tsx')

Deno.test(
  'nativeRuntimeModulesPlugin: a "@zanix/server" import ssrLoadModule evaluates is the exact ' +
    'same, reference-identical ProgramModule instance the native process already holds — never a ' +
    'second, Vite-transformed copy of its own. Fast and HTTP-free: this alone is what closes ' +
    "`zanix space dev`'s module-identity bug (see native-runtime-modules.ts's own doc); the " +
    'second test below is the end-to-end proof this identity is what actually lets a real ' +
    '@Page(...)-decorated route dispatch correctly.',
  async () => {
    const root = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      // A plain, real file on disk — this engine's whole `ssrLoadModule` pipeline (Vite's SSR
      // transform, then `RealImportEvaluator`'s real native `import()`) only ever runs against a
      // real file, exactly like a real route/Comet/layout file would.
      await Deno.writeTextFile(
        join(root, 'probe.ts'),
        `export { ProgramModule } from '@zanix/server'\n`,
      )

      const engine = await createSpaceDevEngine({ root, isRouteEntry })
      try {
        const mod = await engine.ssrLoadModule('/probe.ts')
        assert(
          mod.ProgramModule === ProgramModule,
          'ssrLoadModule\'s own "@zanix/server" import must resolve to the exact native ' +
            'ProgramModule instance (===), not a structurally-identical but reference-different ' +
            'duplicate — see native-runtime-modules.ts for the mechanism (a synthetic ' +
            '`znxruntime://` external id, decoded back to a plain native `import()` by ' +
            'ssr-module-evaluator.ts) this proves actually took effect.',
        )
      } finally {
        await engine.close()
      }
    } finally {
      await Deno.remove(root, { recursive: true })
    }
  },
)

Deno.test(
  'nativeRuntimeModulesPlugin end-to-end: a real dev engine ssrLoadModule-loading a page ' +
    'decorated with @Page(...) registers a route the real, native @zanix/server instance actually ' +
    "dispatches — a genuine HTTP request gets a real 200 with the page's own rendered content, " +
    'not a 404',
  async () => {
    const root = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      // A real page.tsx ON DISK, imported by its OWN `import { Page, SpacePageController } from
      // 'modules/router/mod.ts'` — the same internal alias every other router test in this repo
      // uses (see `src/@tests/support/fixtures/inferred-routes/inferred/page.tsx`) — never a
      // class defined natively in this test file and merely re-exported: that would prove nothing
      // about `ssrLoadModule`'s own module identity, since nothing would have actually gone
      // through the dev engine's SSR pipeline/`RealImportEvaluator` at all. This repo IS
      // `@zanix/space` itself, so it has no `'@zanix/space'` bare specifier of its own to import
      // by name the way a real consuming app's route file does, which means this one fixture's own
      // `import ... from 'modules/router/mod.ts'` is itself Vite-transformed (not externalized) —
      // its OWN `Page`/`SpacePageController` end up as a genuine second, SSR-side copy, same as
      // the ORIGINAL bug for `@zanix/space` specifically. An EXPLICIT `@Page(path)` is used, never
      // the pathless form, BECAUSE of that: an explicit path registers immediately, synchronously,
      // purely through real `@zanix/server` primitives (`Get`/`Post`/`SsrController`, see
      // `page-decorator.ts`'s own `registerPage`) — never touching `pendingPages`/
      // `resolvePendingPage` (page-scoped state private to whichever copy of `page-decorator.ts`
      // ran, which a pathless page's own deferred registration DOES depend on, and which this
      // in-repo setup cannot share — seeing that split for `@zanix/space` itself needs a real
      // consuming app, never this package's own test suite). What's actually shared here is the
      // ONE bare specifier this fixture's own (duplicate) `page-decorator.ts` copy still needs
      // resolved through `ssrLoadModule` to register anywhere real — `'@zanix/server'` — exactly
      // what `nativeRuntimeModulesPlugin` intercepts, regardless of which file (this package's own
      // or a consuming app's) issues the import. The fast, no-HTTP test above already proves that
      // exact mechanism directly; this test proves what it actually buys: a real route, reachable
      // over real HTTP, registered via a real `@Page(...)`-decorated class evaluated through the
      // real dev engine.
      const pageFilePath = join(root, 'page.tsx')
      await Deno.writeTextFile(
        pageFilePath,
        [
          // Installs the renderer INSIDE this fixture's own SSR-side module graph too — the same
          // reason this test FILE itself imports it natively at the top. Necessary because this
          // fixture's own `modules/router/mod.ts` import (below) is, itself, Vite-transformed
          // (never one of `nativeRuntimeModulesPlugin`'s own intercepted specifiers — only
          // `'@zanix/server'`/`'@zanix/space'`/`'react'`/`'react-dom'` are), so it resolves to a
          // genuine second copy of every renderer-agnostic router module, `page-renderer-registry.ts`
          // included, entirely separate from the NATIVE copy this test file's own top-level import
          // installs into. Importing the SAME real absolute file here (Vite/`@deno/vite-plugin`
          // dedupes a module graph by resolved file id) makes this fixture's own duplicate world
          // internally self-consistent — the registry `handleGet` reads from is the SAME one this
          // import writes to. `react`/`react-dom`, nested inside `mod-react.ts`'s own import graph,
          // stay genuinely shared with the native process regardless (still real, native-runtime
          // specifiers, matched by text — see `native-runtime-modules.ts`'s own doc for why that's
          // independent of which file issues the import).
          `import '${import.meta.resolve('../../../../mod-react.ts')}'`,
          "import { Page, SpacePageController } from 'modules/router/mod.ts'",
          '',
          'function View() {',
          '  return <p>native-runtime-modules-identity-ok</p>',
          '}',
          '',
          "@Page('native-runtime-modules-identity-check')",
          'export default class IdentityCheckPage extends SpacePageController {',
          '  public override component = View',
          '}',
          '',
        ].join('\n'),
      )

      const engine = await createSpaceDevEngine({ root, isRouteEntry })
      try {
        await loadRoutes(root, {
          // Backed by the REAL dev engine's `ssrLoadModule` — the exact wiring
          // `dev-engine-registry.ts`'s `getDevImportModule()` supplies to `loadRoutes()` in a real
          // `zanix space dev` process (`define-space-app.ts`), not a hand-rolled stand-in.
          importModule: (filePath) => engine.ssrLoadModule(`/${relative(root, filePath)}`),
        })

        const servers = await bootstrapServers({ ssr: { port: 20612 } })
        try {
          const res = await fetch(
            'http://localhost:20612/native-runtime-modules-identity-check',
          )
          assertEquals(res.status, 200)
          const html = await res.text()
          assert(html.includes('native-runtime-modules-identity-ok'), html)
        } finally {
          await webServerManager.stop(servers)
        }
      } finally {
        await engine.close()
      }
    } finally {
      await Deno.remove(root, { recursive: true })
    }
  },
)
