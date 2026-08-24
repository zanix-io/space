import { assertEquals, assertThrows } from '@std/assert'
import type { Plugin } from 'vite'
import { createAssetManifestRegistry } from 'modules/assets/asset-manifest-registry.ts'

console.error = () => {}

/** A minimal fake Rollup plugin-context `this` — only the two methods `createManifestPlugin`'s
 * own `generateBundle` actually calls. `getFileName` mimics Rollup's real behavior: a stable,
 * deterministic "hashed" name derived from the refId, so assertions don't need a real bundler. */
function fakeRollupContext() {
  const emitted: { type: string; fileName: string; source: string }[] = []
  const ctx = {
    getFileName(refId: string): string {
      return `assets/${refId}-HASH.bin`
    },
    emitFile(file: { type: 'asset'; fileName: string; source: string }): string {
      emitted.push({ type: file.type, fileName: file.fileName, source: file.source })
      return 'unused'
    },
  }
  return { ctx, emitted }
}

async function runGenerateBundle(
  plugin: Plugin,
  ctx: ReturnType<typeof fakeRollupContext>['ctx'],
): Promise<void> {
  // `generateBundle` is typed as a union of shapes (a plain function or a `{handler}` object) —
  // this registry's own `createManifestPlugin` always uses the plain-function form, so a direct
  // call is safe; the cast is only to sidestep the union Vite's own `Plugin` type allows in
  // general, not to bypass any real safety this specific call needs.
  // deno-lint-ignore no-explicit-any
  await (plugin.generateBundle as any)?.call(ctx, {}, {})
}

Deno.test(
  'register + createManifestPlugin: writes a manifest correlating every registered entry',
  async () => {
    const registry = createAssetManifestRegistry()
    registry.register('logo.svg', 'ref-logo')
    registry.register('hero.jpg', 'ref-hero')

    const { ctx, emitted } = fakeRollupContext()
    await runGenerateBundle(registry.createManifestPlugin(), ctx)

    assertEquals(emitted.length, 1)
    assertEquals(emitted[0].fileName, 'assets-manifest.json')
    const manifest = JSON.parse(emitted[0].source)
    assertEquals(manifest, {
      'logo.svg': '/assets/ref-logo-HASH.bin',
      'hero.jpg': '/assets/ref-hero-HASH.bin',
    })
  },
)

Deno.test('createManifestPlugin: an empty registry emits nothing at all', async () => {
  const registry = createAssetManifestRegistry()
  const { ctx, emitted } = fakeRollupContext()
  await runGenerateBundle(registry.createManifestPlugin(), ctx)

  assertEquals(emitted.length, 0)
})

Deno.test('register: the SAME relativePath + SAME refId is idempotent, never throws', () => {
  const registry = createAssetManifestRegistry()
  registry.register('logo.svg', 'ref-logo')
  registry.register('logo.svg', 'ref-logo')
  registry.register('logo.svg', 'ref-logo')

  // No throw above is half the assertion — confirm the entry itself is still correct, not
  // duplicated or corrupted by the repeat calls.
})

Deno.test(
  'register: the SAME relativePath + a DIFFERENT refId throws a clear collision error',
  () => {
    const registry = createAssetManifestRegistry()
    registry.register('hero.jpg', 'ref-from-image-plugin')

    assertThrows(
      () => registry.register('hero.jpg', 'ref-from-video-plugin'),
      Error,
      'Asset manifest collision',
    )
  },
)

Deno.test('register: manifest entries preserve REGISTRATION order, deterministically', async () => {
  const registry = createAssetManifestRegistry()
  registry.register('c.jpg', 'ref-c')
  registry.register('a.jpg', 'ref-a')
  registry.register('b.jpg', 'ref-b')

  const { ctx, emitted } = fakeRollupContext()
  await runGenerateBundle(registry.createManifestPlugin(), ctx)

  const manifest = JSON.parse(emitted[0].source)
  assertEquals(Object.keys(manifest), ['c.jpg', 'a.jpg', 'b.jpg'])
})

Deno.test(
  'two independent producers sharing ONE registry: entries from both land in the SAME manifest',
  async () => {
    const registry = createAssetManifestRegistry()

    // Stands in for assetsPlugin's own buildStart loop — never imports assetsPlugin itself.
    registry.register('hero.jpg', 'ref-image-hero')
    registry.register('hero.msm.jpg', 'ref-image-hero-msm')

    // Stands in for a future mediaPlugin's own buildStart loop — never imports assetsPlugin,
    // never imports mediaPlugin either (it doesn't exist yet) — just the same registry contract.
    registry.register('clip.mp4', 'ref-video-clip')
    registry.register('clip.webm', 'ref-video-clip-webm')
    registry.register('clip.thumb.jpg', 'ref-video-thumb')

    const { ctx, emitted } = fakeRollupContext()
    await runGenerateBundle(registry.createManifestPlugin(), ctx)

    assertEquals(emitted.length, 1, 'exactly one assets-manifest.json for both producers combined')
    const manifest = JSON.parse(emitted[0].source)
    assertEquals(Object.keys(manifest).sort(), [
      'clip.mp4',
      'clip.thumb.jpg',
      'clip.webm',
      'hero.jpg',
      'hero.msm.jpg',
    ])
  },
)

Deno.test(
  'createManifestPlugin: two independent producers colliding on the same relativePath with ' +
    'DIFFERENT outputs throws — never silently picks one',
  () => {
    const registry = createAssetManifestRegistry()
    registry.register('hero.jpg', 'ref-from-image-producer')

    assertThrows(
      () => registry.register('hero.jpg', 'ref-from-a-different-producer'),
      Error,
      'hero.jpg',
    )
  },
)
