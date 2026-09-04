/**
 * `@zanix/space/comet/react` — ready-made, React-only Comets built on top of this package's
 * hook-free comet primitives (`@zanix/space/comet`). Import a Comet from here directly when the
 * default behavior is enough; compose the underlying primitive yourself (inside your own
 * `'use comet'` file) when it isn't — see `@zanix/space/comet`'s own `attachFormDraftPersistence`/
 * `restoreDraftValue`/`persistDraftValue` doc for that case.
 *
 * Does not install React's page renderer — that's still `@zanix/space/react`'s own job, imported
 * once from an app's main module regardless of whether this subpath is ever used.
 *
 * @module
 */
export { FormDraftPersistence } from './form-draft-persistence-react.tsx'
export { default } from './form-draft-persistence-react.tsx'
export type { DraftStorageKind, FormDraftPersistenceOptions } from './form-draft-persistence.ts'
