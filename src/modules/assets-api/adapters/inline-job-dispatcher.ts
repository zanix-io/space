/**
 * The default `JobDispatcher` — runs the real transform→store→repository-update chain
 * SYNCHRONOUSLY inside `dispatch()`. Makes the vertical slice genuinely runnable with zero queue
 * infra, at the honest cost of a blocking request — see `../ports/job-dispatcher.ts`'s own doc for
 * how a future `AsyncMqJobDispatcher` (real `@zanix/asyncmq` `registerJob`/`runJob`) swaps in with
 * zero change to `AssetService`/controllers/this file's own consumers.
 *
 * This is the ONE place a profile-specific transform request gets interpreted — via the
 * `runTransformation` callback `AssetService` supplies at construction time — never by importing
 * `VoiceAudioTransformOptions`/anything audio-specific into this file's own type signatures. Writes
 * the real `'pending' -> 'processing' -> 'completed'|'failed'` sequence through the repository, so
 * the state model is exercised for real even though every transition happens within one call.
 *
 * @module
 */

import { generateUUID } from '@zanix/helpers'
import type { AssetRepository } from '../ports/asset-repository.ts'
import type { AssetTransformationJobInput, JobDispatcher } from '../ports/job-dispatcher.ts'
import type { AssetVariant } from '../typings.ts'

/** Construction options for `createInlineJobDispatcher`. */
export interface InlineJobDispatcherOptions {
  /** The METADATA port this dispatcher writes the pending→processing→completed/failed sequence through. */
  repository: AssetRepository
  /** Interprets one job's own `transformRequest` for real — the ONLY place that shape is known.
   * Supplied by `AssetService`, the layer that actually knows what `{kind:'audio',
   * profile:'voice', ...}` means. */
  runTransformation(input: AssetTransformationJobInput): Promise<AssetVariant>
}

/** Implements `JobDispatcher` by running the transform→store→repository-update chain synchronously
 * inside `dispatch()` — see this module's own top-level doc. */
export function createInlineJobDispatcher(options: InlineJobDispatcherOptions): JobDispatcher {
  const { repository, runTransformation } = options

  return {
    async dispatch(input: AssetTransformationJobInput): Promise<{ jobId: string }> {
      const jobId = generateUUID()
      await repository.update(input.assetId, { status: 'processing' })

      try {
        const variant = await runTransformation(input)
        const asset = await repository.findById(input.assetId)
        const variants = [...(asset?.variants ?? []), variant]
        await repository.update(input.assetId, { status: 'completed', variants })
      } catch (error) {
        // Deliberately swallowed here — see `JobDispatcher.dispatch`'s own doc: a transformation
        // failure is recorded on the record itself, never rejected back through dispatch(), the
        // same contract a real queue-backed dispatcher has (enqueueing succeeds independently of
        // whatever a worker later does with the job).
        await repository.update(input.assetId, {
          status: 'failed',
          error: { message: error instanceof Error ? error.message : String(error) },
        })
      }

      return { jobId }
    },
  }
}
