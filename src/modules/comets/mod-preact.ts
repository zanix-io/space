/**
 * `@zanix/space/comet/preact` — identical to `@zanix/space/comet/react`, wiring the same
 * ready-made Comets against `preact/hooks` instead. See that subpath's own module doc for the
 * full contract.
 *
 * @module
 */
export { default as FormDraftPersistence } from './form-draft-persistence-preact.tsx'
export type { DraftStorageKind, FormDraftPersistenceOptions } from './form-draft-persistence.ts'
export { default as SubmitGuard } from './submit-guard-preact.tsx'
export type { SubmitGuardOptions } from './submit-guard.ts'
export { default as ScrollRestoration } from './scroll-restoration-preact.tsx'
export type { ScrollRestorationOptions } from './scroll-restoration.ts'
export { default as UnsavedChangesGuard } from './unsaved-changes-guard-preact.tsx'
export type { UnsavedChangesGuardOptions } from './unsaved-changes-guard.ts'
export { default as NetworkStatus } from './network-status-preact.tsx'
export type { NetworkStatusOptions } from './network-status.ts'
