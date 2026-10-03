import type { SpaceChildren } from 'typings/renderable.ts'
import { getCometElementFactory } from './element-factory.ts'
import type { CometElementFactory } from './element-factory.ts'
import { buildDraftProbeScript, DRAFT_PROBE_ATTR } from './draft-probe.ts'
import type { FormDraftPersistenceOptions } from './form-draft-persistence.ts'

/** What {@linkcode DraftProbe} takes. */
export type DraftProbeProps = {
  /** The `id` of the `<form>` the page renders, the same `formId` its `ManagedForm` or
   * `FormDraftPersistence` receives. */
  formId: string
  /** The form's own `draft` options (`ManagedForm`) or its props (`FormDraftPersistence`): the
   * probe reads `storageKey`, `storage`, `awaitValues`, `hasServerValues` and
   * `returnedFromFailure`. */
  draft: Pick<
    FormDraftPersistenceOptions,
    'storageKey' | 'storage' | 'awaitValues' | 'hasServerValues' | 'returnedFromFailure'
  >
  /** The request's CSP nonce (`ctx.cspNonce`). It is a prop of this server component and never of
   * a Comet, because a Comet's props are written into the page for the browser to read, which would
   * hand the nonce to any script that runs there. Omit it on a page with no nonce-based CSP. */
  nonce?: string
}

/**
 * Renders the inline script that marks a form as restoring before the first paint when it has an
 * unsent draft saved in the browser (see `draft-probe.ts`), so a stylesheet can show a skeleton
 * exactly then and never on a clean form. Place it anywhere on the page, before the form's own
 * comet; it is a server component, not a Comet, and renders nothing visible.
 *
 * ```tsx
 * <form id='new-trigger' method='post'>{/* ... *\/}</form>
 * <DraftProbe formId='new-trigger' draft={draft} nonce={ctx.cspNonce} />
 * <ManagedForm formId='new-trigger' draft={draft} />
 * ```
 *
 * ```css
 * @media (scripting: enabled) {
 *   :root:has([data-draft-restoring='new-trigger']) #new-trigger {
 *     opacity: 0.4;
 *     pointer-events: none;
 *   }
 * }
 * ```
 *
 * Renders nothing when the page already carries the submitted values (`hasServerValues`), or when
 * it follows a failed submit (`returnedFromFailure`): the form's own comet renders the mark
 * itself then, from the server.
 *
 * The script runs again on an Orbit navigation, because the client revives a fragment's inline
 * scripts with the active nonce.
 */
export function DraftProbe(props: DraftProbeProps): SpaceChildren {
  const { formId, draft, nonce } = props
  if (draft.hasServerValues || draft.returnedFromFailure === true) return null
  const h = getCometElementFactory() as (
    ...args: Parameters<CometElementFactory>
  ) => SpaceChildren
  return h('script', {
    ...(nonce !== undefined && { nonce }),
    [DRAFT_PROBE_ATTR]: formId,
    dangerouslySetInnerHTML: {
      __html: buildDraftProbeScript({
        formId,
        storageKeys: [draft.storageKey, ...(draft.awaitValues ?? [])],
        storage: draft.storage,
      }),
    },
  })
}
