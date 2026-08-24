import { assert, assertEquals } from '@std/assert'
import { bootstrapServers, ProgramModule, webServerManager } from '@zanix/server'
import { createAssetsController } from 'modules/assets-api/controllers/assets.controller.ts'
import type { AssetService } from 'modules/assets-api/asset-service.ts'

/**
 * Its own file, one real server boot — same convention `@zanix/admin`'s own
 * `templates-admin-api.test.ts`/`triggers-admin-api.test.ts` already establish (separate files,
 * not separate `Deno.test` blocks in one file): `deno test` runs each file in its own isolated
 * worker, so two server boots sharing one process (and one `webServerManager`/port) never
 * interfere with each other.
 *
 * Proves the deny-by-default contract for real: with NO `guards` passed to
 * `createAssetsController`, every route rejects BEFORE the service is ever reached — even the
 * upload route, which would otherwise spawn a real `ffmpeg` process.
 */

function createUnreachableAssetService(): AssetService {
  const fail = (): never => {
    throw new Error('AssetService must never be invoked when a guard denies the request')
  }
  return { createAsset: fail, getAsset: fail, downloadVariant: fail }
}

Deno.test({
  sanitizeOps: false,
  sanitizeResources: false,
  name: 'AssetsController: with NO guards passed, every route denies by default — the service is ' +
    'never reached, even for a route that would otherwise spawn real ffmpeg',
  fn: async () => {
    await ProgramModule.defineApplication('assets-api-deny-test', () => {
      createAssetsController({ prefix: 'assets', service: createUnreachableAssetService() })
    })
    const [serverId] = await bootstrapServers({
      rest: { application: 'assets-api-deny-test', id: 'assets-api-deny-test' },
    })
    assert(serverId, 'the server should have been started')

    const info = webServerManager.info(serverId)
    assert(info.addr, 'the started server should be listening')
    const baseUrl = `http://${info.addr.hostname}:${info.addr.port}/${serverId}`

    const upload = await fetch(`${baseUrl}/assets/audio?format=aac`, {
      method: 'POST',
      headers: { 'Content-Type': 'audio/wav' },
      body: new Uint8Array([1, 2, 3, 4]),
    })
    assertEquals(upload.status, 403)
    await upload.body?.cancel()

    const read = await fetch(`${baseUrl}/assets/some-id`)
    assertEquals(read.status, 403)
    await read.body?.cancel()

    await webServerManager.stop([serverId])
  },
})
