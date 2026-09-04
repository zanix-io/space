'use comet'
import { useEffect } from 'preact/hooks'
import { defineComet } from './define-comet.ts'
import { attachFormDraftPersistence } from './form-draft-persistence.ts'
import type { FormDraftPersistenceOptions } from './form-draft-persistence.ts'
import type { CometBoundaryComponent, CometProps } from 'typings/comet.ts'

/**
 * Identical to `@zanix/space/comet/react`'s `FormDraftPersistence`, wiring the same hook-free
 * {@linkcode attachFormDraftPersistence} into `preact/hooks`' own `useEffect` instead — see that
 * module's own doc for the full contract.
 */
export function FormDraftPersistence(props: FormDraftPersistenceOptions): null {
  useEffect(() => attachFormDraftPersistence(props), [
    props.formId,
    props.storageKey,
    props.hasServerValues,
    props.excludeFields,
    props.storage,
    props.debounceMs,
  ])
  return null
}

/**
 * {@linkcode FormDraftPersistence}, wrapped as a real Comet boundary — import this directly:
 * `import FormDraftPersistence from '@zanix/space/comet/preact'`. See
 * `form-draft-persistence-react.tsx`'s own comment on this same `as` clause — identical
 * no-slow-types reasoning, not a Preact-specific concern.
 */
export default defineComet(FormDraftPersistence, import.meta.url) as CometBoundaryComponent<
  FormDraftPersistenceOptions & CometProps
>
