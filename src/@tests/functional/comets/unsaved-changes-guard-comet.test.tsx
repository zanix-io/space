// Installs a renderer, exactly as a real app does: `@zanix/space` itself ships none, so a test
// that renders must import the entry point it is testing against.
import '../../../../mod-react.ts'
import '../../../../mod-preact.ts'
import { assert } from '@std/assert'
import { createElement } from 'preact'
import UnsavedChangesGuardReact from 'modules/comets/unsaved-changes-guard-react.tsx'
import UnsavedChangesGuardPreact from 'modules/comets/unsaved-changes-guard-preact.tsx'
import { setCometManifest } from 'modules/comets/comet-manifest.ts'
import { setActiveRenderer } from 'modules/router/active-renderer.ts'
import { renderToResponse as renderToResponseReact } from 'modules/render/render-to-response.tsx'
import { renderToResponse as renderToResponsePreact } from 'modules/render/render-to-response-preact.ts'
import { stripHydrationComments } from '../../support/strip-hydration-comments.ts'

/**
 * A logic-only Comet (`UnsavedChangesGuard` always renders `null`) still has to go through the
 * exact same boundary-rendering path as a visible one, under both renderers — `useEffect` never
 * runs during either renderer's own SSR pass, so nothing here needs a real `<form>` at all.
 *
 * @module
 */

console.error = () => {}

function reset() {
  setCometManifest(undefined)
  setActiveRenderer('react')
}

Deno.test(
  'UnsavedChangesGuard (react): renders a real Comet boundary with no visible content, props round-trip as JSON',
  async () => {
    try {
      const html = stripHydrationComments(
        await (
          await renderToResponseReact(
            <UnsavedChangesGuardReact formId='new-trigger' comet='visible' />,
          )
        ).text(),
      )

      assert(html.includes('data-comet-export="UnsavedChangesGuard"'), html)
      assert(html.includes('data-comet-strategy="visible"'), html)
      assert(html.includes('data-comet-props="{&quot;formId&quot;:&quot;new-trigger&quot;}"'), html)
    } finally {
      reset()
    }
  },
)

Deno.test(
  'UnsavedChangesGuard (preact): renders a real Comet boundary through preact-render-to-string, ' +
    'same contract as the React ready-made Comet',
  async () => {
    try {
      setActiveRenderer('preact')
      const html = stripHydrationComments(
        await (
          await renderToResponsePreact(
            createElement(UnsavedChangesGuardPreact as never, {
              formId: 'new-trigger',
              comet: 'idle',
            }),
          )
        ).text(),
      )

      assert(html.includes('data-comet-export="UnsavedChangesGuard"'), html)
      assert(html.includes('data-comet-strategy="idle"'), html)
    } finally {
      reset()
    }
  },
)
