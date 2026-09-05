'use comet'
import { useEffect } from 'react'
import { defineComet } from './define-comet.ts'
import { attachManagedForm } from './managed-form.ts'
import type { ManagedFormOptions } from './managed-form.ts'
import type { CometBoundaryComponent, CometProps } from 'typings/comet.ts'

/**
 * Ready-made Comet wiring {@linkcode attachManagedForm} into React's own `useEffect` — the default
 * a consumer app reaches for to enable more than one form behavior without a separate
 * `<XyzGuard formId={id} />` per one. Renders nothing; every `ManagedFormOptions` field is a plain
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
 * />
 * ```
 */
export function ManagedForm(props: ManagedFormOptions): null {
  useEffect(() => attachManagedForm(props), [
    props.formId,
    props.draft,
    props.submitGuard,
    props.unsavedChanges,
  ])
  return null
}

/**
 * {@linkcode ManagedForm}, wrapped as a real Comet boundary — import this directly:
 * `import { ManagedForm } from '@zanix/space/comet/react'` (a NAMED import — see
 * `mod-react.ts`'s own module doc for why this subpath has no single default). See
 * `form-draft-persistence-react.tsx`'s own comment on this same `as` clause — identical
 * no-slow-types reasoning.
 */
export default defineComet(ManagedForm, import.meta.url) as CometBoundaryComponent<
  ManagedFormOptions & CometProps
>
