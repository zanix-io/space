// Installs a renderer, exactly as a real app does: `@zanix/space` itself ships none, so a test
// that renders must import the entry point it is testing against.
import '../../../../mod-react.ts'
import '../../../../mod-preact.ts'
import { assert, assertFalse } from '@std/assert'
import { createElement } from 'preact'
import ManagedFormReact from 'modules/comets/managed-form-react.tsx'
import ManagedFormPreact from 'modules/comets/managed-form-preact.tsx'
import { setCometManifest } from 'modules/comets/comet-manifest.ts'
import { setActiveRenderer } from 'modules/router/active-renderer.ts'
import { renderToResponse as renderToResponseReact } from 'modules/render/render-to-response.tsx'
import { renderToResponse as renderToResponsePreact } from 'modules/render/render-to-response-preact.ts'
import { stripHydrationComments } from '../../support/strip-hydration-comments.ts'

/**
 * A logic-only Comet (`ManagedForm` always renders `null`) still has to go through the exact same
 * boundary-rendering path as a visible one, under both renderers — `useEffect` never runs during
 * either renderer's own SSR pass, so nothing here needs a real `<form>` at all.
 *
 * @module
 */

console.error = () => {}

function reset() {
  setCometManifest(undefined)
  setActiveRenderer('react')
}

Deno.test(
  'ManagedForm (react): renders a real Comet boundary with no visible content, props round-trip as JSON',
  async () => {
    try {
      const html = stripHydrationComments(
        await (
          await renderToResponseReact(
            <ManagedFormReact
              formId='new-trigger'
              draft={{ storageKey: 'triggers/new', hasServerValues: false }}
              submitGuard
              unsavedChanges
              comet='visible'
            />,
          )
        ).text(),
      )

      assert(html.includes('data-comet-export="ManagedForm"'), html)
      assert(html.includes('data-comet-strategy="visible"'), html)
      assert(
        html.includes(
          'data-comet-props="{&quot;formId&quot;:&quot;new-trigger&quot;,' +
            '&quot;draft&quot;:{&quot;storageKey&quot;:&quot;triggers/new&quot;,' +
            '&quot;hasServerValues&quot;:false},&quot;submitGuard&quot;:true,' +
            '&quot;unsavedChanges&quot;:true}"',
        ),
        html,
      )
    } finally {
      reset()
    }
  },
)

Deno.test(
  'ManagedForm (react): renders with just formId — every behavior left disabled',
  async () => {
    try {
      const html = stripHydrationComments(
        await (await renderToResponseReact(<ManagedFormReact formId='plain' />)).text(),
      )

      assert(html.includes('data-comet-export="ManagedForm"'), html)
      assert(html.includes('data-comet-props="{&quot;formId&quot;:&quot;plain&quot;}"'), html)
    } finally {
      reset()
    }
  },
)

Deno.test(
  'ManagedForm (preact): renders a real Comet boundary through preact-render-to-string, same ' +
    'contract as the React ready-made Comet',
  async () => {
    try {
      setActiveRenderer('preact')
      const html = stripHydrationComments(
        await (
          await renderToResponsePreact(
            createElement(ManagedFormPreact as never, {
              formId: 'new-trigger',
              submitGuard: true,
              comet: 'idle',
            }),
          )
        ).text(),
      )

      assert(html.includes('data-comet-export="ManagedForm"'), html)
      assert(html.includes('data-comet-strategy="idle"'), html)
    } finally {
      reset()
    }
  },
)

const MARKER = '<span hidden="" data-draft-restoring="new-trigger"></span>'
// Preact serializes a boolean attribute bare, React as `hidden=""`.
const MARKER_PREACT = '<span hidden data-draft-restoring="new-trigger"></span>'

Deno.test(
  'ManagedForm (react): the restoring marker is server-rendered only when its draft follows a failed submit',
  async () => {
    try {
      const render = async (draft?: Record<string, unknown>) =>
        stripHydrationComments(
          await (
            await renderToResponseReact(
              <ManagedFormReact
                formId='new-trigger'
                draft={draft as never}
                submitGuard
              />,
            )
          ).text(),
        )

      assert(
        (await render({
          storageKey: 'triggers/new',
          hasServerValues: false,
          returnedFromFailure: true,
        })).includes(MARKER),
      )
      assertFalse(
        (await render({ storageKey: 'triggers/new', hasServerValues: false })).includes(
          'data-draft-restoring',
        ),
      )
      assertFalse((await render()).includes('data-draft-restoring'))
    } finally {
      reset()
    }
  },
)

Deno.test(
  'ManagedForm (preact): server-renders the same restoring marker, and only in the same cases',
  async () => {
    try {
      setActiveRenderer('preact')
      const render = async (draft?: Record<string, unknown>) =>
        stripHydrationComments(
          await (
            await renderToResponsePreact(
              createElement(ManagedFormPreact as never, { formId: 'new-trigger', draft }),
            )
          ).text(),
        )

      assert(
        (await render({
          storageKey: 'triggers/new',
          hasServerValues: false,
          returnedFromFailure: true,
        })).includes(MARKER_PREACT),
      )
      assertFalse(
        (await render({
          storageKey: 'triggers/new',
          hasServerValues: true,
          returnedFromFailure: true,
        })).includes('data-draft-restoring'),
      )
      assertFalse((await render()).includes('data-draft-restoring'))
    } finally {
      reset()
    }
  },
)
