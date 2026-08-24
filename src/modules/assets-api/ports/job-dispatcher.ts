/**
 * The DISPATCH port — decides WHEN/HOW the real transform→store→repository-update chain for one
 * asset actually runs. Deliberately opaque to profile/codec concepts: `transformRequest` is typed
 * `unknown` here on purpose — this file never imports `VoiceAudioTransformOptions` or anything
 * from `modules/media/audio/`. `AssetTransformRequest` (the REAL shape) lives in `../typings.ts`;
 * only `AssetService` and a dispatcher's own concrete implementation ever need to know it.
 *
 * `AssetTransformationJobInput` is deliberately JSON-serializable data, never a closure — even
 * though today's only real implementation (`../adapters/inline-job-dispatcher.ts`) runs everything
 * synchronously in the same process, this shape is what lets a FUTURE `AsyncMqJobDispatcher` hand
 * the exact same input to `@zanix/asyncmq`'s `registerJob`/`runJob` (a real queue, a separate
 * worker process) with zero change to this port or to `AssetService`.
 *
 * @module
 */

import type { AssetKind } from '../typings.ts'

/** JSON-serializable description of one transformation job — see this module's own top-level doc
 * for why it's never a closure. */
export interface AssetTransformationJobInput {
  /** Id of the `AssetRecord` this job transforms and updates. */
  assetId: string
  /** Logical storage key of the SOURCE bytes this job transforms — see `../keys.ts`. */
  sourceKey: string
  /** The asset's kind, used to pick the real transform pipeline for `transformRequest`. */
  kind: AssetKind
  /** Opaque, JSON-serializable transform request — see this module's own doc. */
  transformRequest: unknown
}

/** The DISPATCH port a real deployment implements — see this module's own top-level doc. */
export interface JobDispatcher {
  /**
   * Never rejects because of a downstream transformation failure — exactly like a real queue's own
   * `dispatch`/`enqueue` call, which only ever fails for an ENQUEUE-time problem (the queue itself
   * unreachable), never for what a worker does with the job afterward. A transformation failure is
   * always recorded as `AssetRecord.status === 'failed'` via the repository instead — callers query
   * `AssetService.getAsset()` to observe it, the same way they would against a real async worker.
   */
  dispatch(input: AssetTransformationJobInput): Promise<{ jobId: string }>
}
