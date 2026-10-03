// Installs a renderer, exactly as a real app does: `@zanix/space` itself ships none, so a test
// that renders must import the entry point it is testing against.
import '../../../../mod-react.ts'
import '../../../../mod-preact.ts'
import { assert, assertEquals, assertFalse } from '@std/assert'
import { createElement } from 'preact'
import FormDraftPersistenceReact from 'modules/comets/form-draft-persistence-react.tsx'
import FormDraftPersistencePreact from 'modules/comets/form-draft-persistence-preact.tsx'
import { setCometManifest } from 'modules/comets/comet-manifest.ts'
import { setActiveRenderer } from 'modules/router/active-renderer.ts'
import { renderToResponse as renderToResponseReact } from 'modules/render/render-to-response.tsx'
import { renderToResponse as renderToResponsePreact } from 'modules/render/render-to-response-preact.ts'
import { stripHydrationComments } from '../../support/strip-hydration-comments.ts'

/**
 * A logic-only Comet (`FormDraftPersistence` always renders `null`) still has to go through the
 * exact same boundary-rendering path as a visible one — this pins that down under both renderers,
 * rather than assuming a `null`-returning component is somehow exempt. `useEffect` never runs
 * during either renderer's own SSR pass, so nothing here needs to touch `document`/storage at all.
 *
 * @module
 */

console.error = () => {}

function reset() {
  setCometManifest(undefined)
  setActiveRenderer('react')
}

Deno.test(
  'FormDraftPersistence (react): renders a real Comet boundary with no visible content, props round-trip as JSON',
  async () => {
    try {
      const html = stripHydrationComments(
        await (
          await renderToResponseReact(
            <FormDraftPersistenceReact
              formId='new-trigger'
              storageKey='triggers/new'
              hasServerValues={false}
              excludeFields={['controlled']}
              comet='visible'
            />,
          )
        ).text(),
      )

      assert(html.includes('data-comet-export="FormDraftPersistence"'), html)
      assert(html.includes('data-comet-strategy="visible"'), html)
      assert(
        html.includes(
          'data-comet-props="{&quot;formId&quot;:&quot;new-trigger&quot;,' +
            '&quot;storageKey&quot;:&quot;triggers/new&quot;,&quot;hasServerValues&quot;:false,' +
            '&quot;excludeFields&quot;:[&quot;controlled&quot;]}"',
        ),
        html,
      )
    } finally {
      reset()
    }
  },
)

Deno.test(
  'FormDraftPersistence (preact): renders a real Comet boundary through preact-render-to-string, ' +
    'same contract as the React ready-made Comet',
  async () => {
    try {
      setActiveRenderer('preact')
      const html = stripHydrationComments(
        await (
          await renderToResponsePreact(
            createElement(FormDraftPersistencePreact as never, {
              formId: 'new-trigger',
              storageKey: 'triggers/new',
              hasServerValues: true,
              comet: 'idle',
            }),
          )
        ).text(),
      )

      assert(html.includes('data-comet-export="FormDraftPersistence"'), html)
      assert(html.includes('data-comet-strategy="idle"'), html)
      assertFalse(html.includes('undefined'), html)
    } finally {
      reset()
    }
  },
)

const MARKER = '<span hidden="" data-draft-restoring="new-trigger"></span>'
// Preact serializes a boolean attribute bare, React as `hidden=""`.
const MARKER_PREACT = '<span hidden data-draft-restoring="new-trigger"></span>'

Deno.test(
  'FormDraftPersistence (react): a render that follows a failed submit is server-rendered with the restoring marker',
  async () => {
    try {
      const html = stripHydrationComments(
        await (
          await renderToResponseReact(
            <FormDraftPersistenceReact
              formId='new-trigger'
              storageKey='triggers/new'
              hasServerValues={false}
              returnedFromFailure
              awaitValues={['triggers/new/product']}
            />,
          )
        ).text(),
      )

      assert(html.includes(MARKER), html)
      assert(html.includes('&quot;awaitValues&quot;:[&quot;triggers/new/product&quot;]'), html)
    } finally {
      reset()
    }
  },
)

Deno.test(
  'FormDraftPersistence (react): no marker unless the render follows a failed submit and shows no server values',
  async () => {
    try {
      for (
        const props of [
          { hasServerValues: false },
          { hasServerValues: false, returnedFromFailure: false },
          { hasServerValues: true, returnedFromFailure: true },
        ]
      ) {
        const html = stripHydrationComments(
          // deno-lint-ignore no-await-in-loop
          await (
            // deno-lint-ignore no-await-in-loop
            await renderToResponseReact(
              <FormDraftPersistenceReact
                formId='new-trigger'
                storageKey='triggers/new'
                {...props}
              />,
            )
          ).text(),
        )
        assertEquals(html.includes('data-draft-restoring'), false, html)
      }
    } finally {
      reset()
    }
  },
)

Deno.test(
  'FormDraftPersistence (preact): server-renders the same restoring marker, and only in the same cases',
  async () => {
    try {
      setActiveRenderer('preact')
      const render = async (props: Record<string, unknown>) =>
        stripHydrationComments(
          await (
            await renderToResponsePreact(
              createElement(FormDraftPersistencePreact as never, {
                formId: 'new-trigger',
                storageKey: 'triggers/new',
                ...props,
              }),
            )
          ).text(),
        )

      assert(
        (await render({ hasServerValues: false, returnedFromFailure: true })).includes(
          MARKER_PREACT,
        ),
      )
      assertFalse((await render({ hasServerValues: false })).includes('data-draft-restoring'))
      assertFalse(
        (await render({ hasServerValues: true, returnedFromFailure: true })).includes(
          'data-draft-restoring',
        ),
      )
    } finally {
      reset()
    }
  },
)
