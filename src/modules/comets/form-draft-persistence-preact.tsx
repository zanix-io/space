'use comet'
import { createElement } from 'preact'
import type { VNode } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import { defineComet } from './define-comet.ts'
import { attachFormDraftPersistence } from './form-draft-persistence.ts'
import { startsRestoring, watchDraftRestoring } from './draft-restoring.ts'
import type { FormDraftPersistenceOptions } from './form-draft-persistence.ts'
import type { CometBoundaryComponent, CometProps } from 'typings/comet.ts'

/**
 * Identical to `@zanix/space/comet/react`'s `FormDraftPersistence`, wiring the same hook-free
 * {@linkcode attachFormDraftPersistence} into `preact/hooks`' own `useEffect` instead — see that
 * module's own doc for the full contract.
 */
export function FormDraftPersistence(props: FormDraftPersistenceOptions): VNode | null {
  const [restoring, setRestoring] = useState(startsRestoring(props))
  useEffect(() => {
    const detach = attachFormDraftPersistence(props)
    setRestoring(startsRestoring(props))
    const unwatch = watchDraftRestoring(props.formId, props, () => setRestoring(false))
    return () => {
      unwatch()
      detach()
    }
  }, [
    props.formId,
    props.storageKey,
    props.hasServerValues,
    props.returnedFromFailure,
    props.awaitValues,
    props.excludeFields,
    props.storage,
    props.debounceMs,
  ])
  return restoring
    ? createElement(
      'span',
      { hidden: true, 'data-draft-restoring': props.formId } as Record<string, unknown>,
    )
    : null
}

/**
 * {@linkcode FormDraftPersistence}, wrapped as a real Comet boundary — import this directly:
 * `import { FormDraftPersistence } from '@zanix/space/comet/preact'` (a NAMED import — see
 * `mod-react.ts`'s own module doc for why this subpath has no single default). See
 * `form-draft-persistence-react.tsx`'s own comment on this same `as` clause — identical
 * no-slow-types reasoning, not a Preact-specific concern.
 */
export default defineComet(FormDraftPersistence, import.meta.url) as CometBoundaryComponent<
  FormDraftPersistenceOptions & CometProps
>
