import { assert, assertEquals, assertRejects } from '@std/assert'
import { ZanixController, ZanixSsrController } from '@zanix/server'
import type { GuardContext } from '@zanix/server'
import { HttpError } from '@zanix/errors'
import { createAssetsController } from 'modules/assets-api/controllers/assets.controller.ts'
import { denyAllGuard } from 'modules/assets-api/controllers/guards/deny-all-guard.ts'
import { mockHandlerContext } from 'modules/testing/mock-handler-context.ts'
import type { AssetService, CreateAssetCommand } from 'modules/assets-api/asset-service.ts'
import type {
  AssetIdParamsRTO,
  VideoUploadQueryRTO,
  VoiceUploadQueryRTO,
} from 'modules/assets-api/controllers/rtos/assets.rto.ts'
import type { AssetRecord } from 'modules/assets-api/typings.ts'

/** A minimal `AssetService` whose every method throws if actually called — used to prove a guard
 * rejected a request BEFORE the service was ever reached (see
 * `src/@tests/functional/assets-api/voice-upload.test.ts` for the real, end-to-end deny-by-default
 * proof against a live server; this file only covers what's testable without booting one). */
function createUnreachableAssetService(): AssetService {
  const fail = (): never => {
    throw new Error('AssetService must never be invoked when a guard denies the request')
  }
  return { createAsset: fail, getAsset: fail, downloadVariant: fail }
}

Deno.test(
  'createAssetsController: returns a class extending ZanixController, never ZanixSsrController',
  () => {
    const ControllerClass = createAssetsController({ service: createUnreachableAssetService() })
    assert(
      ControllerClass.prototype instanceof ZanixController,
      'the Asset API is a JSON REST resource — it must use the same base Templates/Triggers/DLQ-' +
        'style repos use',
    )
    assert(
      !(ControllerClass.prototype instanceof ZanixSsrController),
      "ZanixSsrController is @zanix/space's own page/byte-serving base (register-assets.ts) — " +
        'the wrong shape for a JSON REST resource API',
    )
  },
)

Deno.test(
  'denyAllGuard: always returns a FORBIDDEN response, never lets a request through',
  async () => {
    // `denyAllGuard` never actually reads its context — a minimal stand-in is enough here.
    const result = await denyAllGuard({} as GuardContext)
    assert(result.response, 'denyAllGuard must always short-circuit with a real response')
    assertEquals(result.response.status, 403)
  },
)

// --- route methods, called directly (bypasses the router/guards, same "not testable through the
// HTTP surface at this level" boundary the ffmpeg-backed functional suites cover instead) --------

const allowAllGuard = () => Promise.resolve({})

/** A real, streamable upload body — `readUploadedAssetFromRequest` needs a live
 * `ReadableStream`+`Content-Type`, same as a real HTTP request would carry. */
function uploadRequest(contentType: string): Request {
  return new Request('http://localhost/assets/x', {
    method: 'POST',
    headers: { 'content-type': contentType },
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]))
        controller.close()
      },
    }),
    duplex: 'half',
  } as RequestInit)
}

function fakeRecord(overrides: Partial<AssetRecord> = {}): AssetRecord {
  return {
    id: 'asset-1',
    kind: 'image',
    status: 'completed',
    contentType: 'image/jpeg',
    size: 3,
    checksum: 'checksum',
    storageKey: 'assets/asset-1/original',
    variants: [],
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  }
}

/** A fake `AssetService` that records every `createAsset` call it receives — proves the
 * controller builds the right `CreateAssetCommand` for each route, without any real
 * transform/storage/repository machinery. */
function createSpyAssetService(
  overrides: Partial<AssetService> = {},
): { service: AssetService; calls: CreateAssetCommand[] } {
  const calls: CreateAssetCommand[] = []
  const service: AssetService = {
    createAsset: (command) => {
      calls.push(command)
      return Promise.resolve(fakeRecord({ kind: command.transformRequest.kind }))
    },
    getAsset: () => Promise.resolve(undefined),
    downloadVariant: () => Promise.resolve(undefined),
    ...overrides,
  }
  return { service, calls }
}

Deno.test(
  'createImageAsset: reads the real upload and calls AssetService.createAsset with ' +
    "transformRequest.kind:'image' — no options, no query validation involved",
  async () => {
    const { service, calls } = createSpyAssetService()
    // Distinct `prefix` per test — `@Controller`/`@Post`/`@Get` register into a process-global
    // route table at class-definition time, so two controllers sharing the default 'assets'
    // prefix in the same test process would collide.
    const ControllerClass = createAssetsController({
      service,
      prefix: 'assets-image-test',
      guards: { write: [allowAllGuard], read: [allowAllGuard] },
    })
    const ctx = mockHandlerContext({ req: uploadRequest('image/jpeg') })
    const controller = new ControllerClass(ctx)

    const result = await controller.createImageAsset(ctx)

    assertEquals(calls.length, 1)
    assertEquals(calls[0].transformRequest, { kind: 'image' })
    assertEquals(calls[0].upload.contentType, 'image/jpeg')
    assertEquals(result, { ...fakeRecord({ kind: 'image' }) })
  },
)

Deno.test(
  'createVideoAsset: reads the real upload and forwards the search query ' +
    '(breakpoint/format) straight into transformRequest.options',
  async () => {
    const { service, calls } = createSpyAssetService()
    const ControllerClass = createAssetsController({
      service,
      prefix: 'assets-video-test',
      guards: { write: [allowAllGuard], read: [allowAllGuard] },
    })
    const ctx = mockHandlerContext({
      req: uploadRequest('video/mp4'),
      payload: {
        params: {},
        search: { breakpoint: 'dlg', format: 'webm' } as VideoUploadQueryRTO,
        body: undefined,
      },
    })
    const controller = new ControllerClass(ctx)

    await controller.createVideoAsset(ctx)

    assertEquals(calls.length, 1)
    assertEquals(calls[0].transformRequest, {
      kind: 'video',
      options: { breakpoint: 'dlg', format: 'webm' },
    })
  },
)

Deno.test(
  'createVoiceAsset: reads the real upload and forwards the search query format into ' +
    'transformRequest.options',
  async () => {
    const { service, calls } = createSpyAssetService()
    const ControllerClass = createAssetsController({
      service,
      prefix: 'assets-voice-search-test',
      guards: { write: [allowAllGuard], read: [allowAllGuard] },
    })
    const ctx = mockHandlerContext({
      req: uploadRequest('audio/wav'),
      payload: {
        params: {},
        search: { format: 'opus' } as VoiceUploadQueryRTO,
        body: undefined,
      },
    })
    const controller = new ControllerClass(ctx)

    await controller.createVoiceAsset(ctx)

    assertEquals(calls.length, 1)
    assertEquals(calls[0].transformRequest, {
      kind: 'audio',
      profile: 'voice',
      options: { format: 'opus' },
    })
  },
)

Deno.test(
  'getAssetStatus: an unknown id throws a real NOT_FOUND HttpError — never returns a ' +
    'fabricated status',
  async () => {
    const { service } = createSpyAssetService({ getAsset: () => Promise.resolve(undefined) })
    const ControllerClass = createAssetsController({
      service,
      prefix: 'assets-status-not-found-test',
      guards: { write: [allowAllGuard], read: [allowAllGuard] },
    })
    const ctx = mockHandlerContext({
      payload: { params: { id: 'missing' } as AssetIdParamsRTO, search: {}, body: undefined },
    })
    const controller = new ControllerClass(ctx)

    const error = await assertRejects(() => controller.getAssetStatus(ctx), HttpError)
    assertEquals(error.status.code, 'NOT_FOUND')
  },
)

Deno.test(
  'downloadAsset: an unknown id/variant throws a real NOT_FOUND HttpError — never a ' +
    'Response with no body',
  async () => {
    const { service } = createSpyAssetService({
      downloadVariant: () => Promise.resolve(undefined),
    })
    const ControllerClass = createAssetsController({
      service,
      prefix: 'assets-download-not-found-test',
      guards: { write: [allowAllGuard], read: [allowAllGuard] },
    })
    const ctx = mockHandlerContext({
      req: new Request('http://localhost/assets/missing/download'),
      payload: { params: { id: 'missing' } as AssetIdParamsRTO, search: {}, body: undefined },
    })
    const controller = new ControllerClass(ctx)

    const error = await assertRejects(() => controller.downloadAsset(ctx), HttpError)
    assertEquals(error.status.code, 'NOT_FOUND')
  },
)
