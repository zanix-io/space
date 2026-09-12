import { assert, assertEquals } from '@std/assert'
import type { GuardContext } from '@zanix/server'
import { createOwnerScopedGuard } from 'modules/assets-api/controllers/guards/owner-scoped-guard.ts'
import { mockHandlerContext } from 'modules/testing/mock-handler-context.ts'
import type { AssetService } from 'modules/assets-api/asset-service.ts'
import type { AssetRecord } from 'modules/assets-api/typings.ts'

/**
 * `createOwnerScopedGuard` — the generic ownership-comparison half only (see this module's own
 * top-level doc): `resolveCallerId` is always a trivial stand-in here, never a real JWT/session
 * extractor, since that half is deliberately the INTEGRATOR's own concern, not this guard's.
 */

function fakeService(record: AssetRecord | undefined): AssetService {
  const fail = (): never => {
    throw new Error('not used in this test')
  }
  return {
    createAsset: fail,
    getAsset: () => Promise.resolve(record),
    downloadVariant: fail,
    deleteAsset: fail,
  }
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

function contextForId(id: string | undefined): GuardContext {
  return mockHandlerContext({
    payload: { params: id === undefined ? {} : { id }, search: {}, body: undefined },
  }) as GuardContext
}

Deno.test(
  "createOwnerScopedGuard: allows the request when resolveCallerId matches the record's ownerId",
  async () => {
    const guard = createOwnerScopedGuard(fakeService(fakeRecord({ ownerId: 'user-42' })), {
      resolveCallerId: () => 'user-42',
    })
    const result = await guard(contextForId('asset-1'))
    assertEquals(result.response, undefined)
  },
)

Deno.test(
  'createOwnerScopedGuard: denies with FORBIDDEN when resolveCallerId does not match ownerId',
  async () => {
    const guard = createOwnerScopedGuard(fakeService(fakeRecord({ ownerId: 'user-42' })), {
      resolveCallerId: () => 'someone-else',
    })
    const result = await guard(contextForId('asset-1'))
    assert(result.response, 'a mismatched caller must be denied')
    assertEquals(result.response.status, 403)
  },
)

Deno.test(
  'createOwnerScopedGuard: fails CLOSED when resolveCallerId resolves no identity at all',
  async () => {
    const guard = createOwnerScopedGuard(fakeService(fakeRecord({ ownerId: 'user-42' })), {
      resolveCallerId: () => undefined,
    })
    const result = await guard(contextForId('asset-1'))
    assert(result.response, 'an unresolved caller id must never be treated as a pass')
    assertEquals(result.response.status, 403)
  },
)

Deno.test(
  'createOwnerScopedGuard: fails CLOSED when the record itself has no ownerId on file — never ' +
    'treated as "public"',
  async () => {
    const guard = createOwnerScopedGuard(fakeService(fakeRecord({ ownerId: undefined })), {
      resolveCallerId: () => 'user-42',
    })
    const result = await guard(contextForId('asset-1'))
    assert(result.response, 'a record with no ownerId must never pass an ownership check')
    assertEquals(result.response.status, 403)
  },
)

Deno.test(
  "createOwnerScopedGuard: a missing asset passes through — the handler's own NOT_FOUND check " +
    'runs instead',
  async () => {
    const guard = createOwnerScopedGuard(fakeService(undefined), {
      resolveCallerId: () => 'user-42',
    })
    const result = await guard(contextForId('does-not-exist'))
    assertEquals(result.response, undefined)
  },
)

Deno.test(
  'createOwnerScopedGuard: no resolvable asset id (default getAssetId) passes through',
  async () => {
    const guard = createOwnerScopedGuard(fakeService(fakeRecord({ ownerId: 'user-42' })), {
      resolveCallerId: () => 'someone-else',
    })
    const result = await guard(contextForId(undefined))
    assertEquals(result.response, undefined)
  },
)

Deno.test(
  'createOwnerScopedGuard: a custom getAssetId overrides the default params.id lookup',
  async () => {
    const guard = createOwnerScopedGuard(fakeService(fakeRecord({ ownerId: 'user-42' })), {
      resolveCallerId: () => 'user-42',
      getAssetId: () => 'asset-1',
    })
    // No `params.id` at all — only the custom `getAssetId` can resolve it.
    const result = await guard(contextForId(undefined))
    assertEquals(result.response, undefined)
  },
)
