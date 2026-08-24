/**
 * The HTTP surface for the Asset API — a thin `ZanixController` adapter over `AssetService`. Never
 * touches ffmpeg/sharp/filesystem/storage backends directly (see `src/@tests/unit/assets-api/
 * controller.test.ts`'s own import-boundary check) — every real operation goes through `service`.
 * Guards default to deny-all (see `guards/deny-all-guard.ts`'s own doc) — passing a real `guards`
 * list is how an integrator opts these routes into real access control.
 *
 * `ZanixController`, not `ZanixSsrController` — this is a genuine JSON REST resource API, the same
 * shape Templates/Triggers/DLQ-style admin APIs already use in this ecosystem, not a page/byte
 * route (`@zanix/space`'s own `modules/assets/register-assets.ts` uses `ZanixSsrController` for
 * that different, byte-serving concern).
 *
 * @module
 */

import type { HandlerContext } from '@zanix/server'
import { Controller, Get, Guard, Post, ZanixController } from '@zanix/server'
import type { MiddlewareGuard } from '@zanix/server'
import { HttpError } from '@zanix/errors'
import type { AssetService } from '../asset-service.ts'
import { readUploadedAssetFromRequest } from '../upload.ts'
import { denyAllGuard } from './guards/deny-all-guard.ts'
import { AssetIdParamsRTO, VideoUploadQueryRTO, VoiceUploadQueryRTO } from './rtos/assets.rto.ts'

/** Options for {@link createAssetsController}. */
export interface AssetsControllerOptions {
  /** The composed `AssetService` every route delegates to — see this module's own top-level doc. */
  service: AssetService
  /** Route prefix, e.g. `'assets'` (default) for `/assets/*`. */
  prefix?: string
  /**
   * Per-operation-group guards. Each group defaults to `[denyAllGuard]` when omitted or empty —
   * never to "no guard at all." `write` gates every `POST` route (`/assets/audio`,
   * `/assets/image`, `/assets/video`); `read` gates every `GET` route.
   */
  guards?: {
    write?: MiddlewareGuard[]
    read?: MiddlewareGuard[]
  }
}

/** Combines a guard list into ONE guard: runs each in order, short-circuiting on the first
 * denial. Empty/omitted lists fall back to `[denyAllGuard]` — the concrete mechanism behind
 * `AssetsControllerOptions.guards`'s own "never public by accident" contract. */
function combineGuards(guards: MiddlewareGuard[] | undefined): MiddlewareGuard {
  const list = guards && guards.length > 0 ? guards : [denyAllGuard]
  return async (context, ...args) => {
    for (const guard of list) {
      // deno-lint-ignore no-await-in-loop
      const result = await guard(context, ...args)
      if (result.response) return result
    }
    return {}
  }
}

/** The instance shape {@link createAssetsController} builds. */
export interface AssetsControllerInstance extends ZanixController {
  /** `POST /assets/audio` — uploads a `.wav` and transcodes it via the voice profile. */
  createVoiceAsset(
    ctx: HandlerContext<{ search: VoiceUploadQueryRTO }>,
  ): Promise<Record<string, unknown>>
  /** `POST /assets/image` — uploads a jpeg/png/webp and optimizes it in place. */
  createImageAsset(ctx: HandlerContext): Promise<Record<string, unknown>>
  /** `POST /assets/video` — uploads an mp4/webm and transcodes it at `breakpoint` (default
   * `'mlg'`). */
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
  const { service, prefix = 'assets' } = options
  const writeGuard = combineGuards(options.guards?.write)
  const readGuard = combineGuards(options.guards?.read)

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
      })
      return { ...record }
    }

    @Post('image')
    @Guard(writeGuard)
    public async createImageAsset(ctx: HandlerContext): Promise<Record<string, unknown>> {
      const upload = readUploadedAssetFromRequest(ctx.req)
      const record = await service.createAsset({
        upload,
        transformRequest: { kind: 'image' },
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
          },
        },
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
  }

  return _AssetsController
}
