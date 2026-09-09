import { assert, assertEquals } from '@std/assert'
import { ResolutionMode } from '@deno/loader'
import { fileURLToPath } from 'node:url'
import { getSpaceOwnLoader } from 'modules/bundler/deno-loader.ts'

Deno.test(
  "getSpaceOwnLoader: resolves preact — a real npm-only dependency @zanix/space's own deno.jsonc " +
    "declares, never a consuming project's — to a real file:// path with no referrer at all",
  async () => {
    const loader = await getSpaceOwnLoader()
    const resolved = loader.resolveSync('preact', undefined, ResolutionMode.Import)
    assert(resolved.startsWith('file://'), `expected a real file:// resolution, got: ${resolved}`)
    const path = fileURLToPath(resolved)
    assert(path.includes('preact'), `expected the resolved path to point into preact, got: ${path}`)
  },
)

Deno.test(
  "getSpaceOwnLoader: resolves preact/debug — the exact subpath @preact/preset-vite's own " +
    'devtools sub-plugin injects into the auto-generated client entry',
  async () => {
    const loader = await getSpaceOwnLoader()
    const resolved = loader.resolveSync('preact/debug', undefined, ResolutionMode.Import)
    assert(resolved.startsWith('file://'), `expected a real file:// resolution, got: ${resolved}`)
  },
)

Deno.test(
  'getSpaceOwnLoader: resolves @prefresh/core and @prefresh/utils — the other two npm-only deps ' +
    'the production bug this loader fixes originally surfaced for',
  async () => {
    const loader = await getSpaceOwnLoader()
    for (const id of ['@prefresh/core', '@prefresh/utils']) {
      const resolved = loader.resolveSync(id, undefined, ResolutionMode.Import)
      assert(
        resolved.startsWith('file://'),
        `expected a real file:// resolution for ${id}, got: ${resolved}`,
      )
    }
  },
)

Deno.test(
  'getSpaceOwnLoader: returns the exact same cached Loader across calls, never rebuilding it per call',
  async () => {
    const [first, second] = await Promise.all([getSpaceOwnLoader(), getSpaceOwnLoader()])
    assertEquals(first, second)
  },
)

Deno.test(
  "getSpaceOwnLoader: a specifier genuinely absent from @zanix/space's own manifest still fails " +
    'to resolve, same as any other unrelated bare specifier',
  async () => {
    const loader = await getSpaceOwnLoader()
    let threw = false
    try {
      loader.resolveSync(
        'definitely-not-a-real-package-xyz-123',
        undefined,
        ResolutionMode.Import,
      )
    } catch {
      threw = true
    }
    assert(threw, 'expected an unrelated, undeclared specifier to still fail to resolve')
  },
)
