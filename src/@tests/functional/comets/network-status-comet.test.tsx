// Installs a renderer, exactly as a real app does: `@zanix/space` itself ships none, so a test
// that renders must import the entry point it is testing against.
import '../../../../mod-react.ts'
import '../../../../mod-preact.ts'
import { assert } from '@std/assert'
import { createElement } from 'preact'
import NetworkStatusReact from 'modules/comets/network-status-react.tsx'
import NetworkStatusPreact from 'modules/comets/network-status-preact.tsx'
import { setCometManifest } from 'modules/comets/comet-manifest.ts'
import { setActiveRenderer } from 'modules/router/active-renderer.ts'
import { renderToResponse as renderToResponseReact } from 'modules/render/render-to-response.tsx'
import { renderToResponse as renderToResponsePreact } from 'modules/render/render-to-response-preact.ts'
import { stripHydrationComments } from '../../support/strip-hydration-comments.ts'

/**
 * A logic-only Comet (`NetworkStatus` always renders `null`) still has to go through the exact
 * same boundary-rendering path as a visible one, under both renderers — `useEffect` never runs
 * during either renderer's own SSR pass, so nothing here needs a real `navigator`/DOM at all.
 *
 * @module
 */

console.error = () => {}

function reset() {
  setCometManifest(undefined)
  setActiveRenderer('react')
}

Deno.test(
  'NetworkStatus (react): renders a real Comet boundary with no visible content, props round-trip as JSON',
  async () => {
    try {
      const html = stripHydrationComments(
        await (
          await renderToResponseReact(
            <NetworkStatusReact targetId='app' attribute='data-net' comet='visible' />,
          )
        ).text(),
      )

      assert(html.includes('data-comet-export="NetworkStatus"'), html)
      assert(html.includes('data-comet-strategy="visible"'), html)
      assert(
        html.includes(
          'data-comet-props="{&quot;targetId&quot;:&quot;app&quot;,&quot;attribute&quot;:&quot;data-net&quot;}"',
        ),
        html,
      )
    } finally {
      reset()
    }
  },
)

Deno.test(
  'NetworkStatus (react): renders with zero props too',
  async () => {
    try {
      const html = stripHydrationComments(
        await (await renderToResponseReact(<NetworkStatusReact />)).text(),
      )

      assert(html.includes('data-comet-export="NetworkStatus"'), html)
      assert(html.includes('data-comet-props="{}"'), html)
    } finally {
      reset()
    }
  },
)

Deno.test(
  'NetworkStatus (preact): renders a real Comet boundary through preact-render-to-string, same ' +
    'contract as the React ready-made Comet',
  async () => {
    try {
      setActiveRenderer('preact')
      const html = stripHydrationComments(
        await (
          await renderToResponsePreact(
            createElement(NetworkStatusPreact as never, { comet: 'idle' }),
          )
        ).text(),
      )

      assert(html.includes('data-comet-export="NetworkStatus"'), html)
      assert(html.includes('data-comet-strategy="idle"'), html)
    } finally {
      reset()
    }
  },
)
