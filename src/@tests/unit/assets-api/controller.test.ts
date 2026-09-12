import { assert, assertEquals, assertRejects } from '@std/assert'
import { ZanixController, ZanixSsrController } from '@zanix/server'
import type { GuardContext } from '@zanix/server'
import { HttpError } from '@zanix/errors'
import {
  combineGuards,
  createAssetsController,
} from 'modules/assets-api/controllers/assets.controller.ts'
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
  return { createAsset: fail, getAsset: fail, downloadVariant: fail, deleteAsset: fail }
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

Deno.test(
  'combineGuards: merges headers from every non-denying guard, not just the last one — a ' +
    "guard like @zanix/auth's rateLimitGuard needs its own headers to actually reach a " +
    'PASSING request, not only a 429 denial',
  async () => {
    const rateLimitLikeGuard = () =>
      Promise.resolve({ headers: { 'X-Znx-RateLimit-Remaining': '99' } })
    const otherHeaderGuard = () => Promise.resolve({ headers: { 'X-Znx-RateLimit-Limit': '100' } })

    const combined = combineGuards([rateLimitLikeGuard, otherHeaderGuard])
    const result = await combined({} as GuardContext)

    assertEquals(result.response, undefined, 'neither guard denies — this must never short-circuit')
    assertEquals(result.headers, {
      'X-Znx-RateLimit-Remaining': '99',
      'X-Znx-RateLimit-Limit': '100',
    })
  },
)

Deno.test(
  'combineGuards: a later denial still wins even after an earlier guard already set headers',
  async () => {
    const headerGuard = () => Promise.resolve({ headers: { 'X-Znx-RateLimit-Remaining': '0' } })
    const denyingGuard = () => Promise.resolve({ response: new Response(null, { status: 429 }) })

    const combined = combineGuards([headerGuard, denyingGuard])
    const result = await combined({} as GuardContext)

    assert(result.response, 'the second guard denies — the combined guard must short-circuit')
    assertEquals(result.response.status, 429)
  },
)

Deno.test('combineGuards: no headers from any guard returns a bare {}, same as before', async () => {
  const combined = combineGuards([allowAllGuard])
  const result = await combined({} as GuardContext)

  assertEquals(result, {})
})

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
    deleteAsset: () => Promise.resolve(),
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
  'createImageAsset: a controller built with imageOptimizeOptions forwards it as ' +
    'transformRequest.options on every upload — never a per-request query param',
  async () => {
    const { service, calls } = createSpyAssetService()
    const ControllerClass = createAssetsController({
      service,
      prefix: 'assets-image-options-test',
      guards: { write: [allowAllGuard], read: [allowAllGuard] },
      imageOptimizeOptions: { breakpoints: [400, 1200] },
    })
    const ctx = mockHandlerContext({ req: uploadRequest('image/jpeg') })
    const controller = new ControllerClass(ctx)

    await controller.createImageAsset(ctx)

    assertEquals(calls.length, 1)
    assertEquals(calls[0].transformRequest, {
      kind: 'image',
      options: { breakpoints: [400, 1200] },
    })
  },
)

Deno.test(
  'createImageAsset: a configured resolveCallerId stamps its result onto ownerId',
  async () => {
    const { service, calls } = createSpyAssetService()
    const ControllerClass = createAssetsController({
      service,
      prefix: 'assets-image-owner-test',
      guards: { write: [allowAllGuard], read: [allowAllGuard] },
      resolveCallerId: () => 'user-42',
    })
    const ctx = mockHandlerContext({ req: uploadRequest('image/jpeg') })
    const controller = new ControllerClass(ctx)

    await controller.createImageAsset(ctx)

    assertEquals(calls.length, 1)
    assertEquals(calls[0].ownerId, 'user-42')
  },
)

Deno.test(
  'createImageAsset: an omitted resolveCallerId leaves ownerId unset — no behavior change',
  async () => {
    const { service, calls } = createSpyAssetService()
    const ControllerClass = createAssetsController({
      service,
      prefix: 'assets-image-no-owner-test',
      guards: { write: [allowAllGuard], read: [allowAllGuard] },
    })
    const ctx = mockHandlerContext({ req: uploadRequest('image/jpeg') })
    const controller = new ControllerClass(ctx)

    await controller.createImageAsset(ctx)

    assertEquals(calls[0].ownerId, undefined)
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
  'createVideoAsset: ?thumbnail=true forwards options.thumbnail:true; anything else (including ' +
    'omitted) forwards no `thumbnail` field at all — never a literal `false`',
  async () => {
    const { service, calls } = createSpyAssetService()
    const ControllerClass = createAssetsController({
      service,
      prefix: 'assets-video-thumbnail-test',
      guards: { write: [allowAllGuard], read: [allowAllGuard] },
    })

    async function createWith(thumbnail: string | undefined) {
      const ctx = mockHandlerContext({
        req: uploadRequest('video/mp4'),
        payload: {
          params: {},
          search: { breakpoint: undefined, format: undefined, thumbnail } as VideoUploadQueryRTO,
          body: undefined,
        },
      })
      await new ControllerClass(ctx).createVideoAsset(ctx)
    }

    await createWith('true')
    await createWith('false')
    await createWith(undefined)

    assertEquals(calls.length, 3)
    assertEquals(calls[0].transformRequest, {
      kind: 'video',
      options: { breakpoint: undefined, format: undefined, thumbnail: true },
    })
    assertEquals(calls[1].transformRequest, {
      kind: 'video',
      options: { breakpoint: undefined, format: undefined },
    })
    assertEquals(calls[2].transformRequest, {
      kind: 'video',
      options: { breakpoint: undefined, format: undefined },
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

Deno.test(
  'deleteAsset: an unknown id throws a real NOT_FOUND HttpError — never calls ' +
    'AssetService.deleteAsset for something that was never there',
  async () => {
    const { service } = createSpyAssetService({ getAsset: () => Promise.resolve(undefined) })
    const ControllerClass = createAssetsController({
      service,
      prefix: 'assets-delete-not-found-test',
      guards: { write: [allowAllGuard], read: [allowAllGuard], delete: [allowAllGuard] },
    })
    const ctx = mockHandlerContext({
      payload: { params: { id: 'missing' } as AssetIdParamsRTO, search: {}, body: undefined },
    })
    const controller = new ControllerClass(ctx)

    const error = await assertRejects(() => controller.deleteAsset(ctx), HttpError)
    assertEquals(error.status.code, 'NOT_FOUND')
  },
)

Deno.test(
  'deleteAsset: a known id calls AssetService.deleteAsset with that id and returns an empty body',
  async () => {
    let deletedId: string | undefined
    const { service } = createSpyAssetService({
      getAsset: () => Promise.resolve(fakeRecord()),
      deleteAsset: (id) => {
        deletedId = id
        return Promise.resolve()
      },
    })
    const ControllerClass = createAssetsController({
      service,
      prefix: 'assets-delete-ok-test',
      guards: { write: [allowAllGuard], read: [allowAllGuard], delete: [allowAllGuard] },
    })
    const ctx = mockHandlerContext({
      payload: { params: { id: 'asset-1' } as AssetIdParamsRTO, search: {}, body: undefined },
    })
    const controller = new ControllerClass(ctx)

    const result = await controller.deleteAsset(ctx)

    assertEquals(deletedId, 'asset-1')
    assertEquals(result, {})
  },
)
