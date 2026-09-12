/**
 * The HTTP surface for the Asset API — a thin `ZanixController` adapter over `AssetService`. Never
 * touches ffmpeg/sharp/filesystem/storage backends directly (see `src/@tests/unit/assets-api/
 * controller.test.ts`'s own import-boundary check) — every real operation goes through `service`.
 * Guards default to deny-all (see `guards/deny-all-guard.ts`'s own doc) — passing a real `guards`
 * list is how an integrator opts these routes into real access control. `resolveCallerId`
 * (`AssetsControllerOptions`'s own doc) is the separate, optional hook for per-asset ownership —
 * stamping `AssetRecord.ownerId` on write, enforced later via `guards/owner-scoped-guard.ts`.
 *
 * `ZanixController`, not `ZanixSsrController` — this is a genuine JSON REST resource API, the same
 * shape Templates/Triggers/DLQ-style admin APIs already use in this ecosystem, not a page/byte
 * route (`@zanix/space`'s own `modules/assets/register-assets.ts` uses `ZanixSsrController` for
 * that different, byte-serving concern).
 *
 * @module
 */

import type { HandlerContext } from '@zanix/server'
import { Controller, Delete, Get, Guard, Post, ZanixController } from '@zanix/server'
import type { MiddlewareGuard } from '@zanix/server'
import { HttpError } from '@zanix/errors'
import { readUploadedAssetFromRequest } from '../upload.ts'
import { denyAllGuard } from './guards/deny-all-guard.ts'
import { AssetIdParamsRTO, VideoUploadQueryRTO, VoiceUploadQueryRTO } from './rtos/assets.rto.ts'
import type { AssetsControllerOptions, ResolveCallerId } from './assets-controller-types.ts'

export type { AssetsControllerOptions, ResolveCallerId }

/** Combines a guard list into ONE guard: runs each in order, short-circuiting on the first
 * denial. Empty/omitted lists fall back to `[denyAllGuard]` — the concrete mechanism behind
 * `AssetsControllerOptions.guards`'s own "never public by accident" contract.
 *
 * Also merges `headers` from every guard that returns them, not just the one that (if any)
 * short-circuits — `@zanix/auth`'s own `rateLimitGuard`, a realistic entry in `guards.read`/
 * `guards.write`, attaches its `X-Znx-RateLimit-*` headers to a PASSING request too, not only to
 * the 429 it returns once the limit is hit. `@Guard(writeGuard)`'s own decorator (this function's
 * real caller) only ever sees ONE combined guard, so if this function discarded a passing guard's
 * headers here, `@zanix/server`'s own header-merging (which happens one layer up, across every
 * `@Guard(...)` on a method) would have nothing left of theirs to merge — later headers win on a
 * key collision, matching `@zanix/server`'s own `overwrite: true` merge order for guard headers. */
export function combineGuards(guards: MiddlewareGuard[] | undefined): MiddlewareGuard {
  const list = guards && guards.length > 0 ? guards : [denyAllGuard]
  return async (context, ...args) => {
    const headers: Record<string, string> = {}
    for (const guard of list) {
      // deno-lint-ignore no-await-in-loop
      const result = await guard(context, ...args)
      if (result.response) return result
      if (result.headers) Object.assign(headers, result.headers)
    }
    return Object.keys(headers).length > 0 ? { headers } : {}
  }
}

/** The instance shape {@link createAssetsController} builds. */
export interface AssetsControllerInstance extends ZanixController {
  /** `POST /assets/audio` — uploads a `.wav` and transcodes it via the voice profile. */
  createVoiceAsset(
    ctx: HandlerContext<{ search: VoiceUploadQueryRTO }>,
  ): Promise<Record<string, unknown>>
  /** `POST /assets/image` — uploads a jpeg/png/webp and optimizes it per this controller's own
   * `imageOptimizeOptions` (a fixed, operator-configured policy — see
   * `AssetsControllerOptions.imageOptimizeOptions`'s own doc), or in place with no resize when
   * that option is omitted. */
  createImageAsset(ctx: HandlerContext): Promise<Record<string, unknown>>
  /** `POST /assets/video` — uploads an mp4/webm and transcodes it at `breakpoint` (default
   * `'mlg'`). `?thumbnail=true` additionally extracts one still-frame thumbnail variant
   * (`kind: 'thumbnail'`) from the same upload — see `asset-service.ts`'s own
   * `runVideoTransformation` doc for the fixed frame/format policy this applies. */
  createVideoAsset(
    ctx: HandlerContext<{ search: VideoUploadQueryRTO }>,
  ): Promise<Record<string, unknown>>
  /** `GET /assets/:id` — the full asset record (metadata + variants). */
  getAsset(ctx: HandlerContext<{ params: AssetIdParamsRTO }>): Promise<Record<string, unknown>>
  /** `GET /assets/:id/status` — just `{id, status, error?}`. */
  getAssetStatus(
    ctx: HandlerContext<{ params: AssetIdParamsRTO }>,
  ): Promise<Record<string, unknown>>
  /** `GET /assets/:id/download?variant=<id>` — streams the original (no `variant`) or a specific
   * variant's real bytes. Returns a raw `Response` (never buffers the whole file to build a JSON
   * DTO), the same "handler may return a full `Response`, used as-is" contract `@zanix/server`
   * already defines. */
  downloadAsset(ctx: HandlerContext<{ params: AssetIdParamsRTO }>): Promise<Response>
  /** `DELETE /assets/:id` — removes the asset's own record and every stored byte object it owns
   * (original + variants). `404` when `id` doesn't already resolve to a real asset, same
   * not-found contract every other `:id` route here already has. */
  deleteAsset(ctx: HandlerContext<{ params: AssetIdParamsRTO }>): Promise<Record<string, unknown>>
}

/**
 * Builds the Asset API's own controller. A factory rather than a plain class because `@Controller`'s
 * `prefix` is decorator-time (static) config — same reasoning `@zanix/admin`'s
 * `createTemplatesController`/`createTriggersController` already establish — and because `service`/
 * `guards` are real runtime values this factory closes over rather than resolving via DI (this
 * subpath deliberately doesn't register an `@Interactor`; `AssetService` is a plain composed
 * object, not a DI-managed class).
 */
export function createAssetsController(
  options: AssetsControllerOptions,
): new (context: HandlerContext) => AssetsControllerInstance {
  const { service, prefix = 'assets', imageOptimizeOptions, resolveCallerId } = options
  const writeGuard = combineGuards(options.guards?.write)
  const readGuard = combineGuards(options.guards?.read)
  const deleteGuard = combineGuards(options.guards?.delete)

  @Controller({ prefix })
  class _AssetsController extends ZanixController {
    @Post('audio', { Search: VoiceUploadQueryRTO })
    @Guard(writeGuard)
    public async createVoiceAsset(
      ctx: HandlerContext<{ search: VoiceUploadQueryRTO }>,
    ): Promise<Record<string, unknown>> {
      const upload = readUploadedAssetFromRequest(ctx.req)
      const record = await service.createAsset({
        upload,
        transformRequest: {
          kind: 'audio',
          profile: 'voice',
          options: { format: ctx.payload.search.format },
        },
        ownerId: await resolveCallerId?.(ctx),
      })
      return { ...record }
    }

    @Post('image')
    @Guard(writeGuard)
    public async createImageAsset(ctx: HandlerContext): Promise<Record<string, unknown>> {
      const upload = readUploadedAssetFromRequest(ctx.req)
      const record = await service.createAsset({
        upload,
        transformRequest: imageOptimizeOptions
          ? { kind: 'image', options: imageOptimizeOptions }
          : { kind: 'image' },
        ownerId: await resolveCallerId?.(ctx),
      })
      return { ...record }
    }

    @Post('video', { Search: VideoUploadQueryRTO })
    @Guard(writeGuard)
    public async createVideoAsset(
      ctx: HandlerContext<{ search: VideoUploadQueryRTO }>,
    ): Promise<Record<string, unknown>> {
      const upload = readUploadedAssetFromRequest(ctx.req)
      const record = await service.createAsset({
        upload,
        transformRequest: {
          kind: 'video',
          options: {
            breakpoint: ctx.payload.search.breakpoint,
            format: ctx.payload.search.format,
            // Omitted entirely (never a literal `false`) unless the caller explicitly opted in —
            // matches every other knob here (`breakpoint`/`format` are `undefined`, not a default
            // value, when the caller doesn't send them), and keeps `runVideoTransformation`'s own
            // `requestOptions.thumbnail` check a plain truthiness test with no `=== true` needed.
            ...(ctx.payload.search.thumbnail === 'true' ? { thumbnail: true } : {}),
          },
        },
        ownerId: await resolveCallerId?.(ctx),
      })
      return { ...record }
    }

    @Get(':id', { Params: AssetIdParamsRTO })
    @Guard(readGuard)
    public async getAsset(
      ctx: HandlerContext<{ params: AssetIdParamsRTO }>,
    ): Promise<Record<string, unknown>> {
      const record = await service.getAsset(ctx.payload.params.id)
      if (!record) {
        throw new HttpError('NOT_FOUND', { meta: { source: 'zanix', id: ctx.payload.params.id } })
      }
      return { ...record }
    }

    @Get(':id/status', { Params: AssetIdParamsRTO })
    @Guard(readGuard)
    public async getAssetStatus(
      ctx: HandlerContext<{ params: AssetIdParamsRTO }>,
    ): Promise<Record<string, unknown>> {
      const record = await service.getAsset(ctx.payload.params.id)
      if (!record) {
        throw new HttpError('NOT_FOUND', { meta: { source: 'zanix', id: ctx.payload.params.id } })
      }
      return { id: record.id, status: record.status, error: record.error }
    }

    @Get(':id/download', { Params: AssetIdParamsRTO })
    @Guard(readGuard)
    public async downloadAsset(
      ctx: HandlerContext<{ params: AssetIdParamsRTO }>,
    ): Promise<Response> {
      const variantId = new URL(ctx.req.url).searchParams.get('variant') ?? undefined
      const download = await service.downloadVariant(ctx.payload.params.id, variantId)
      if (!download) {
        throw new HttpError('NOT_FOUND', { meta: { source: 'zanix', id: ctx.payload.params.id } })
      }
      return new Response(download.stream, {
        headers: {
          'Content-Type': download.contentType,
          'Content-Length': String(download.size),
        },
      })
    }

    @Delete(':id', { Params: AssetIdParamsRTO })
    @Guard(deleteGuard)
    public async deleteAsset(
      ctx: HandlerContext<{ params: AssetIdParamsRTO }>,
    ): Promise<Record<string, unknown>> {
      const record = await service.getAsset(ctx.payload.params.id)
      if (!record) {
        throw new HttpError('NOT_FOUND', { meta: { source: 'zanix', id: ctx.payload.params.id } })
      }
      await service.deleteAsset(ctx.payload.params.id)
      return {}
    }
  }

  return _AssetsController
}
