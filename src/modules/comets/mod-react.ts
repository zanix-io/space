/**
 * `@zanix/space/comet/react` — ready-made, React-only Comets built on top of this package's
 * hook-free comet primitives (`@zanix/space/comet`). Always a NAMED import — this subpath carries
 * more than one Comet, so there is no single "the" default the way one author's own comet file has
 * (`import { FormDraftPersistence, SubmitGuard } from '@zanix/space/comet/react'`). Import one
 * directly when the default behavior is enough; compose the underlying primitive yourself (inside
 * your own `'use comet'` file) when it isn't — see `@zanix/space/comet`'s own
 * `attachFormDraftPersistence`/`restoreDraftValue`/`persistDraftValue`/`attachSubmitGuard` doc for
 * that case.
 *
 * Does not install React's page renderer — that's still `@zanix/space/react`'s own job, imported
 * once from an app's main module regardless of whether this subpath is ever used.
 *
 * @module
 */
export { default as FormDraftPersistence } from './form-draft-persistence-react.tsx'
export type { DraftStorageKind, FormDraftPersistenceOptions } from './form-draft-persistence.ts'
export { default as SubmitGuard } from './submit-guard-react.tsx'
export type { SubmitGuardOptions } from './submit-guard.ts'
export { default as ScrollRestoration } from './scroll-restoration-react.tsx'
export type { ScrollRestorationOptions } from './scroll-restoration.ts'
export { default as UnsavedChangesGuard } from './unsaved-changes-guard-react.tsx'
export type { UnsavedChangesGuardOptions } from './unsaved-changes-guard.ts'
export { default as NetworkStatus } from './network-status-react.tsx'
export type { NetworkStatusOptions } from './network-status.ts'
export { default as ManagedForm } from './managed-form-react.tsx'
export type { ManagedFormOptions } from './managed-form.ts'
