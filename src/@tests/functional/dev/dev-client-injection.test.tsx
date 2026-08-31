// Installs a renderer, exactly as a real app does: `@zanix/space` itself ships none, so a
// test that renders must import the entry point it is testing against.
import '../../../../mod-react.ts'
import { assert, assertFalse } from '@std/assert'
import { join, resolve } from '@std/path'
import { bootstrapServers, webServerManager } from '@zanix/server'
import { loadRoutes } from 'modules/router/mod.ts'
import { setDevClientEnabled, SPACE_DEV_SOCKET_ROUTE } from 'modules/dev/mod.ts'
import { setGlobalCssPaths } from 'modules/render/css-manifest.ts'

const FIXTURE_DIR = 'src/@tests/support/fixtures/inferred-routes'
// Resolved to an ABSOLUTE path — the injected `routeFilePath` must match `SsrModuleChangedEvent.
// affectedRoutes`' own format (always absolute, from Vite's module graph), which
// `handleSsrModuleChanged` (`dev-client-script.ts`) compares it against directly. A relative path
// here was a real, confirmed bug: the comparison silently never matched, so `location.reload()`
// never fired on the page's own SSR change — see `render-page-react.tsx`'s own identical comment.
const FIXTURE_PAGE_PATH = resolve(join(FIXTURE_DIR, 'inferred', 'page.tsx'))

Deno.test(
  "renderToResponse: injects the dev client script, with this page's own routeFilePath, when enabled",
  async () => {
    await loadRoutes(FIXTURE_DIR)
    setDevClientEnabled(true)
    try {
      // `finalize: false` — this file's second test reuses the SAME fixture; the default
      // `finalize: true` would wipe this page's route registration right after this call, and
      // since its `@Page()` decorator only ran once (at import time), nothing would re-register
      // it for that later test. See `not-found-integration.test.tsx`'s own identical comment for
      // the full reasoning (same root cause, confirmed the same way).
      const servers = await bootstrapServers({ ssr: { port: 21101 } }, {
        finalize: false,
      })
      try {
        const res = await fetch('http://localhost:21101/inferred')
        const html = await res.text()

        assert(html.includes(`/socket/${SPACE_DEV_SOCKET_ROUTE}`), html)
        assert(html.includes(JSON.stringify(FIXTURE_PAGE_PATH)), html)

        // The Fast Refresh preamble must ALSO be present, as a real `type="module"` script, and
        // appear BEFORE the dev client script in document order — same gate, but registered first
        // so `window.$RefreshReg$`/`$RefreshSig$` exist before any later module script could need
        // them (see `dev-fast-refresh-preamble.ts`'s own doc for the full ordering reasoning).
        const preambleIndex = html.indexOf('injectIntoGlobalHook')
        const socketIndex = html.indexOf(`/socket/${SPACE_DEV_SOCKET_ROUTE}`)
        assert(preambleIndex !== -1, html)
        assert(preambleIndex < socketIndex, html)
        assert(
          /<script type="module"[^>]*>[^<]*injectIntoGlobalHook/.test(html),
          `expected the preamble script to be type="module":\n${html}`,
        )
      } finally {
        await webServerManager.stop(servers)
      }
    } finally {
      setDevClientEnabled(false)
    }
  },
)

Deno.test(
  'renderToResponse: never injects the dev client script when disabled (the default)',
  async () => {
    await loadRoutes(FIXTURE_DIR)

    // `finalize: false` — this file's LAST test still reuses this same fixture. Same reasoning
    // as this file's first test above.
    const servers = await bootstrapServers({ ssr: { port: 21102 } }, {
      finalize: false,
    })
    try {
      const res = await fetch('http://localhost:21102/inferred')
      const html = await res.text()

      assertFalse(html.includes(SPACE_DEV_SOCKET_ROUTE), html)
      assertFalse(html.includes('injectIntoGlobalHook'), html)
    } finally {
      await webServerManager.stop(servers)
    }
  },
)

Deno.test(
  'renderToResponse: links globalCss via resolveDevCssHrefs when dev mode is enabled',
  async () => {
    await loadRoutes(FIXTURE_DIR)
    setGlobalCssPaths(['./styles/app.css'])
    setDevClientEnabled(true)
    try {
      // Same `finalize: false` reasoning as this file's first test above.
      const servers = await bootstrapServers({ ssr: { port: 21103 } }, {
        finalize: false,
      })
      try {
        const res = await fetch('http://localhost:21103/inferred')
        const html = await res.text()

        assert(html.includes('href="/styles/app.css?direct"'), html)
      } finally {
        await webServerManager.stop(servers)
      }
    } finally {
      setDevClientEnabled(false)
      setGlobalCssPaths(undefined)
    }
  },
)
