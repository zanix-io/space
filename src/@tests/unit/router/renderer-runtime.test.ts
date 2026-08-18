// Installs both renderers, exactly as `renderer-invariant.test.ts` does: this file's own cleanup
// needs a REAL runtime to restore afterward (see below), for both kinds, regardless of which one
// was actually active before this test ran.
import '../../../../mod-react.ts'
import '../../../../mod-preact.ts'
import { assertEquals } from '@std/assert'
import { installPreactRuntime } from '../../../../mod-preact.ts'
import { installReactRuntime } from '../../../../mod-react.ts'
import {
  getInstalledRenderer,
  installRendererRuntime,
  resetRendererRuntime,
} from 'modules/router/renderer-runtime.ts'
import type { RendererRuntime } from 'modules/router/renderer-runtime.ts'

// A plain stub — none of these three functions need to actually render anything for this test,
// they only need to be callable references `installRendererRuntime` can store.
const STUB_RUNTIME: RendererRuntime = {
  renderPage: () => Promise.resolve(new Response('stub-page')),
  renderNotFound: () => Promise.resolve(new Response('stub-not-found')),
  createElement: () => null,
}

Deno.test(
  'installRendererRuntime/getInstalledRenderer/resetRendererRuntime: install reflects ' +
    'immediately, reset drops it back to the undefined state a fresh process starts in',
  () => {
    // `installedRenderer` and the page/not-found renderer registries are all module-level
    // singletons shared with the rest of the suite — captured so the real state can be restored
    // below, whichever kind actually happens to be active when this test runs.
    const previous = getInstalledRenderer()

    try {
      installRendererRuntime('preact', STUB_RUNTIME)
      assertEquals(getInstalledRenderer(), 'preact')

      resetRendererRuntime()
      assertEquals(getInstalledRenderer(), undefined)
    } finally {
      // `installRendererRuntime` above overwrote the single page-renderer/not-found-renderer slots
      // (shared across both kinds) and the preact-keyed Comet element factory with stubs. Both
      // real runtimes are idempotent to reinstall (`@zanix/space/react`/`@zanix/space/preact`'s own
      // doc), so this restores every registry to a real implementation regardless of which kind
      // ends up installed last, and then re-asserts whatever kind was actually active before.
      installReactRuntime()
      installPreactRuntime()
      if (previous === 'react') installReactRuntime()
      else if (previous === undefined) resetRendererRuntime()
    }
  },
)
