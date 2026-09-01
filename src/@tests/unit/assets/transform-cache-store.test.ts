import { assertEquals } from '@std/assert'
import { join } from '@std/path'
import { getTemporaryFolder } from '@zanix/helpers'
import {
  createFileTransformCacheStore,
  createInMemoryTransformCacheStore,
} from 'modules/assets/transform-cache-store.ts'

async function tempDir(prefix: string): Promise<string> {
  return await Deno.makeTempDir({ dir: getTemporaryFolder(import.meta.url), prefix })
}

// --- createInMemoryTransformCacheStore: basic contract -------------------------------------------

Deno.test(
  'createInMemoryTransformCacheStore: getEntry is undefined before any setEntry',
  async () => {
    const store = createInMemoryTransformCacheStore()
    assertEquals(await store.getEntry('k'), undefined)
  },
)

Deno.test('createInMemoryTransformCacheStore: setEntry then getEntry round-trips', async () => {
  const store = createInMemoryTransformCacheStore()
  await store.setEntry('k', { status: 'optimized', bytesWritten: 42 })
  assertEquals(await store.getEntry('k'), { status: 'optimized', bytesWritten: 42 })
})

Deno.test('createInMemoryTransformCacheStore: setBytes then getBytes round-trips', async () => {
  const store = createInMemoryTransformCacheStore()
  await store.setBytes('k', new Uint8Array([1, 2, 3]))
  assertEquals(await store.getBytes('k'), new Uint8Array([1, 2, 3]))
})

Deno.test(
  'createInMemoryTransformCacheStore: a malformed injected entry is treated as absent (corrupt/incompatible -> safe miss)',
  async () => {
    const store = createInMemoryTransformCacheStore()
    // Simulate corruption/incompatibility by writing directly through the public contract with a
    // value the store must still validate on READ, never simply trusted merely because `setEntry`
    // itself wrote it.
    // deno-lint-ignore no-explicit-any
    await store.setEntry('k', { result: 'done' } as any)
    assertEquals(await store.getEntry('k'), undefined)
  },
)

// --- createFileTransformCacheStore: persisted, real filesystem -----------------------------------

Deno.test(
  'createFileTransformCacheStore: getEntry is undefined when the cache dir does not exist yet',
  async () => {
    const dir = await tempDir('transform-cache-missing-')
    await Deno.remove(dir, { recursive: true })
    const store = createFileTransformCacheStore(dir)
    assertEquals(await store.getEntry('k'), undefined)
  },
)

Deno.test(
  'createFileTransformCacheStore: setEntry/getEntry round-trips across a fresh store instance',
  async () => {
    const dir = await tempDir('transform-cache-roundtrip-')
    try {
      const store1 = createFileTransformCacheStore(dir)
      await store1.setEntry('k', { status: 'optimized', bytesWritten: 99 })

      // A brand new store instance, same dir — proves this is real persistence, not an in-memory
      // shortcut that only happens to look correct within one store's own lifetime.
      const store2 = createFileTransformCacheStore(dir)
      assertEquals(await store2.getEntry('k'), { status: 'optimized', bytesWritten: 99 })
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
)

Deno.test(
  'createFileTransformCacheStore: setBytes/getBytes round-trips as a real binary file, never JSON/base64',
  async () => {
    const dir = await tempDir('transform-cache-bytes-')
    try {
      const store = createFileTransformCacheStore(dir)
      const payload = new Uint8Array([0, 1, 2, 253, 254, 255])
      await store.setBytes('video:mlg:webm', payload)
      await store.setEntry('video:mlg:webm', {
        status: 'optimized',
        bytesWritten: payload.byteLength,
      })
      assertEquals(await store.getBytes('video:mlg:webm'), payload)

      // The index file itself must stay small/text — bytes live in their own file, never inlined.
      const indexText = await Deno.readTextFile(join(dir, 'index.json'))
      assertEquals(indexText.includes('253'), false)
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
)

Deno.test(
  'createFileTransformCacheStore: getBytes is undefined for a key that was never stored',
  async () => {
    const dir = await tempDir('transform-cache-missing-bytes-')
    try {
      const store = createFileTransformCacheStore(dir)
      assertEquals(await store.getBytes('never-stored'), undefined)
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
)

Deno.test(
  'createFileTransformCacheStore: a corrupt (non-JSON) index file is treated as empty, never thrown',
  async () => {
    const dir = await tempDir('transform-cache-corrupt-json-')
    try {
      await Deno.mkdir(dir, { recursive: true })
      await Deno.writeTextFile(join(dir, 'index.json'), 'this is not valid json {{{')

      const store = createFileTransformCacheStore(dir)
      assertEquals(await store.getEntry('any-key'), undefined)

      // The store must still be WRITABLE after recovering from a corrupt index — a safe recompute
      // needs to be able to record its own fresh result afterwards.
      await store.setEntry('any-key', { status: 'optimized', bytesWritten: 5 })
      assertEquals(await store.getEntry('any-key'), { status: 'optimized', bytesWritten: 5 })
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
)

Deno.test(
  'createFileTransformCacheStore: an index that is valid JSON but not a plain object is treated as empty',
  async () => {
    const dir = await tempDir('transform-cache-corrupt-shape-')
    try {
      await Deno.mkdir(dir, { recursive: true })
      await Deno.writeTextFile(join(dir, 'index.json'), '[1, 2, 3]')

      const store = createFileTransformCacheStore(dir)
      assertEquals(await store.getEntry('any-key'), undefined)
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
)

Deno.test(
  'createFileTransformCacheStore: one incompatible/foreign-shaped entry never invalidates its OTHER, still-valid sibling entries',
  async () => {
    const dir = await tempDir('transform-cache-partial-corrupt-')
    try {
      await Deno.mkdir(dir, { recursive: true })
      await Deno.writeTextFile(
        join(dir, 'index.json'),
        JSON.stringify({
          'good-key': { status: 'optimized', bytesWritten: 10 },
          'bad-key': { legacyShape: true, size: '10' },
        }),
      )

      const store = createFileTransformCacheStore(dir)
      assertEquals(await store.getEntry('good-key'), { status: 'optimized', bytesWritten: 10 })
      assertEquals(await store.getEntry('bad-key'), undefined)
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
)

Deno.test(
  'createFileTransformCacheStore: a missing output file behind an otherwise-valid entry is a safe miss, not a throw',
  async () => {
    const dir = await tempDir('transform-cache-missing-blob-')
    try {
      const store = createFileTransformCacheStore(dir)
      // A real entry, recorded, but its own bytes were never actually written (or were cleaned
      // separately) — exactly the "index and byte-store disagree" corruption shape.
      await store.setEntry('key-without-bytes', { status: 'optimized', bytesWritten: 100 })
      assertEquals(await store.getBytes('key-without-bytes'), undefined)
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
)
