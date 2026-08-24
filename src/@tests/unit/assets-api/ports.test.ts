import { assert, assertEquals } from '@std/assert'
import { fromFileUrl } from '@std/path'
import { createInlineJobDispatcher } from 'modules/assets-api/adapters/inline-job-dispatcher.ts'
import { createInMemoryAssetRepository } from 'modules/assets-api/adapters/in-memory-asset-repository.ts'
import type { AssetVariant } from 'modules/assets-api/typings.ts'

const ASSETS_API_ROOT = fromFileUrl(import.meta.resolve('../../../modules/assets-api/'))

async function readPortSource(relativePath: string): Promise<string> {
  return await Deno.readTextFile(`${ASSETS_API_ROOT}${relativePath}`)
}

// --- port isolation: AssetStorage <-> AssetRepository never cross-import ------------------------

Deno.test('ports/asset-storage.ts never imports ports/asset-repository.ts', async () => {
  const source = await readPortSource('ports/asset-storage.ts')
  assert(
    !source.includes('asset-repository'),
    'AssetStorage (bytes) must stay structurally independent of AssetRepository (metadata)',
  )
})

Deno.test('ports/asset-repository.ts never imports ports/asset-storage.ts', async () => {
  const source = await readPortSource('ports/asset-repository.ts')
  assert(
    !source.includes('asset-storage'),
    'AssetRepository (metadata) must stay structurally independent of AssetStorage (bytes)',
  )
})

// --- JobDispatcher/AssetTransformationJobInput stay profile/codec-agnostic ----------------------

/** Real `import ... from '...'` lines only — deliberately ignores doc comments/prose, which
 * legitimately explain what NOT to import (and would otherwise false-positive a naive whole-file
 * substring check). */
function importSpecifiers(source: string): string[] {
  const specifiers: string[] = []
  for (const line of source.split('\n')) {
    const match = /^\s*import\b.*from\s+['"]([^'"]+)['"]/.exec(line)
    if (match) specifiers.push(match[1])
  }
  return specifiers
}

Deno.test(
  'ports/job-dispatcher.ts never IMPORTS modules/media/audio/ or any audio-specific type',
  async () => {
    const source = await readPortSource('ports/job-dispatcher.ts')
    const specifiers = importSpecifiers(source)
    assert(specifiers.length > 0, 'sanity check: this file must import something (../typings.ts)')
    for (const specifier of specifiers) {
      assert(
        !specifier.includes('media/audio') && !specifier.includes('media/'),
        `JobDispatcher must never import from "${specifier}" — transformRequest stays \`unknown\``,
      )
    }
  },
)

Deno.test(
  'JobDispatcher.dispatch(): accepts a transformRequest shape the port has never seen and still ' +
    'runs it, unchanged, through to the caller-supplied runTransformation — proving the port is ' +
    'genuinely opaque, not just typed as unknown while secretly assuming a shape',
  async () => {
    const repository = createInMemoryAssetRepository()
    await repository.create({
      id: 'x',
      kind: 'thumbnail',
      contentType: 'image/jpeg',
      size: 1,
      checksum: 'x',
      storageKey: 'assets/x/original',
    })

    let received: unknown
    const fakeVariant: AssetVariant = {
      variantId: 'v1',
      kind: 'thumbnail',
      format: 'jpeg',
      contentType: 'image/jpeg',
      storageKey: 'assets/x/variants/v1',
      size: 1,
      checksum: 'x',
      transformId: 't',
      policyVersion: 'v1',
    }

    const dispatcher = createInlineJobDispatcher({
      repository,
      runTransformation: (input) => {
        received = input.transformRequest
        return Promise.resolve(fakeVariant)
      },
    })

    const neverSeenBeforeShape = { totallyNovel: true, nested: { value: 42 } }
    await dispatcher.dispatch({
      assetId: 'x',
      sourceKey: 'assets/x/original',
      kind: 'thumbnail',
      transformRequest: neverSeenBeforeShape,
    })

    assertEquals(received, neverSeenBeforeShape)
    const record = await repository.findById('x')
    assertEquals(record?.status, 'completed')
  },
)

Deno.test(
  'JobDispatcher.dispatch(): a runTransformation failure is recorded on the record itself ' +
    '(never rejected back through dispatch), and a non-Error throw is stringified rather than ' +
    'crashing on a missing .message',
  async () => {
    const repository = createInMemoryAssetRepository()
    await repository.create({
      id: 'y',
      kind: 'thumbnail',
      contentType: 'image/jpeg',
      size: 1,
      checksum: 'y',
      storageKey: 'assets/y/original',
    })

    const dispatcher = createInlineJobDispatcher({
      repository,
      // deliberately NOT an `Error` instance — proves the `instanceof Error` check's OTHER
      // branch, `String(error)`, rather than assuming every rejection carries a `.message`.
      runTransformation: () => Promise.reject('transcode blew up'),
    })

    const { jobId } = await dispatcher.dispatch({
      assetId: 'y',
      sourceKey: 'assets/y/original',
      kind: 'thumbnail',
      transformRequest: {},
    })
    assertEquals(typeof jobId, 'string')

    const record = await repository.findById('y')
    assertEquals(record?.status, 'failed')
    assertEquals(record?.error, { message: 'transcode blew up' })
  },
)
