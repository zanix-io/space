'use comet'
import { useEffect } from 'react'
import { defineComet } from './define-comet.ts'
import { attachFormDraftPersistence } from './form-draft-persistence.ts'
import type { FormDraftPersistenceOptions } from './form-draft-persistence.ts'
import type { CometBoundaryComponent, CometProps } from 'typings/comet.ts'

/**
 * Ready-made Comet wiring {@linkcode attachFormDraftPersistence} into React's own `useEffect` —
 * the default a consumer app reaches for unless it needs to compose the hook-free primitive
 * itself (e.g. alongside a React-controlled sub-widget, see `restoreDraftValue`/
 * `persistDraftValue`). Renders nothing; every `FormDraftPersistenceOptions` field is a plain
 * JSON-serializable value, so it crosses the Comet boundary as ordinary props like any other.
 *
 * ```tsx
 * import { FormDraftPersistence } from '@zanix/space/comet/react'
 *
 * <FormDraftPersistence
 *   formId="new-trigger"
 *   storageKey="triggers/new"
 *   hasServerValues={ctx.submitted !== undefined}
 * />
 * ```
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
 * `import { FormDraftPersistence } from '@zanix/space/comet/react'` (a NAMED import: this
 * subpath's own barrel carries more than one ready-made Comet, so it has no single default of its
 * own — see `mod-react.ts`'s own module doc).
 *
 * `as`-annotated, not left to inference: `defineComet`'s own generic return type is too complex
 * for JSR's fast-check publish step to infer through a bare default-export expression (the same
 * "no-slow-types" constraint any generic factory call hits at a package's own public export
 * boundary) — this re-states nothing `defineComet`'s real return type doesn't already guarantee.
 */
export default defineComet(FormDraftPersistence, import.meta.url) as CometBoundaryComponent<
  FormDraftPersistenceOptions & CometProps
>
