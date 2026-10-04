'use comet'
import { createElement, useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import { defineComet } from './define-comet.ts'
import { attachManagedForm } from './managed-form.ts'
import { startsRestoring, watchDraftRestoring } from './draft-restoring.ts'
import type { ManagedFormOptions } from './managed-form.ts'
import type { CometBoundaryComponent, CometProps } from 'typings/comet.ts'

/** `ManagedFormOptions` minus `intercept` — see {@linkcode ManagedForm}'s own doc for why. */
export type ManagedFormComponentProps = Omit<ManagedFormOptions, 'intercept'>

/**
 * Ready-made Comet wiring {@linkcode attachManagedForm} into React's own `useEffect` — the default
 * a consumer app reaches for to enable more than one form behavior without a separate
 * `<XyzGuard formId={id} />` per one. Renders nothing, except the same hidden
 * `<span data-draft-restoring="{formId}">` marker `FormDraftPersistence` renders while a render that
 * follows a failed submit restores its `draft`. Every `ManagedFormOptions` field is a plain
 * JSON-serializable value, so it crosses the Comet boundary as ordinary props like any other. The
 * `<form>` itself stays ordinary, server-rendered markup — see `managed-form.ts`'s own doc for why
 * this can't render it.
 *
 * ```tsx
 * import { ManagedForm } from '@zanix/space/comet/react'
 *
 * <form id="new-trigger" method="post">{/* ... *\/}</form>
 * <ManagedForm
 *   formId="new-trigger"
 *   draft={{ storageKey: 'triggers/new', hasServerValues: ctx.submitted !== undefined }}
 *   submitGuard
 *   unsavedChanges
 *   focusFirstInvalid
 *   clearInvalidOnInput
 * />
 * ```
 *
 * `focusFirstInvalid` moves the focus to the first control the server rendered as
 * `aria-invalid="true"` (see {@linkcode ManagedFormOptions.focusFirstInvalid}); `clearInvalidOnInput` clears a control's
 * error as soon as the visitor edits it (see {@linkcode ManagedFormOptions.clearInvalidOnInput});
 * `validateInline` validates in the browser with the page's own messages (see
 * {@linkcode ManagedFormOptions.validateInline}).
 *
 * **Never accepts `intercept`** — `ManagedFormOptions.intercept` is a real function, and this
 * component's own props cross the server/client boundary as plain JSON (`defineComet`'s own
 * `stringifyForWire` call), the same reason no ready-made Comet in this package accepts a callback
 * prop. Compose `attachManagedForm({ ..., intercept })` directly inside your own `'use comet'` file
 * instead when you need it — see `managed-form.ts`'s own `intercept` doc.
 */
export function ManagedForm(props: ManagedFormComponentProps): ReactElement | null {
  const { draft } = props
  const [restoring, setRestoring] = useState(draft !== undefined && startsRestoring(draft))
  useEffect(() => {
    const detach = attachManagedForm(props)
    setRestoring(draft !== undefined && startsRestoring(draft))
    const unwatch = draft && watchDraftRestoring(props.formId, draft, () => setRestoring(false))
    return () => {
      unwatch?.()
      detach()
    }
  }, [
    props.formId,
    props.draft,
    props.submitGuard,
    props.unsavedChanges,
    props.focusFirstInvalid,
    props.clearInvalidOnInput,
    props.validateInline,
  ])
  return restoring
    ? createElement('span', { hidden: true, 'data-draft-restoring': props.formId })
    : null
}

/**
 * {@linkcode ManagedForm}, wrapped as a real Comet boundary — import this directly:
 * `import { ManagedForm } from '@zanix/space/comet/react'` (a NAMED import — see
 * `mod-react.ts`'s own module doc for why this subpath has no single default). See
 * `form-draft-persistence-react.tsx`'s own comment on this same `as` clause — identical
 * no-slow-types reasoning.
 */
export default defineComet(ManagedForm, import.meta.url) as CometBoundaryComponent<
  ManagedFormComponentProps & CometProps
>
