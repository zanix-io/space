import { assertEquals } from '@std/assert'
import {
  computeModulePreloads,
  type PreloadBundleChunk,
} from 'modules/bundler/modulepreload-plugin.ts'

function chunk(
  fileName: string,
  imports: string[] = [],
  extra: Partial<PreloadBundleChunk> = {},
): [string, PreloadBundleChunk] {
  return [fileName, { type: 'chunk', fileName, imports, ...extra }]
}

Deno.test('computeModulePreloads: lists every static dependency of an entry, nearest first', () => {
  const bundle = Object.fromEntries([
    chunk('assets/entry.js', ['assets/a.js', 'assets/b.js'], { isEntry: true }),
    chunk('assets/a.js', ['assets/c.js']),
    chunk('assets/b.js', ['assets/c.js']),
    chunk('assets/c.js'),
  ])
  assertEquals(computeModulePreloads(bundle), {
    '/assets/entry.js': ['/assets/a.js', '/assets/b.js', '/assets/c.js'],
  })
})

Deno.test('computeModulePreloads: no chunk repeats, cycles terminate, the start is never its own dep', () => {
  const bundle = Object.fromEntries([
    chunk('assets/x.js', ['assets/y.js', 'assets/y.js'], { isEntry: true }),
    chunk('assets/y.js', ['assets/z.js', 'assets/x.js']),
    chunk('assets/z.js', ['assets/y.js']),
  ])
  assertEquals(computeModulePreloads(bundle)['/assets/x.js'], ['/assets/y.js', '/assets/z.js'])
})

Deno.test('computeModulePreloads: a comet (facade module) gets its own closure, a plain shared chunk none', () => {
  const bundle = Object.fromEntries([
    chunk('assets/comet-w.js', ['assets/shared.js'], { facadeModuleId: '/src/w.tsx' }),
    chunk('assets/comet-o.js', ['assets/shared.js'], { isDynamicEntry: true }),
    chunk('assets/shared.js', ['assets/leaf.js']),
    chunk('assets/leaf.js'),
  ])
  const manifest = computeModulePreloads(bundle)
  assertEquals(manifest['/assets/comet-w.js'], ['/assets/shared.js', '/assets/leaf.js'])
  assertEquals(manifest['/assets/comet-o.js'], ['/assets/shared.js', '/assets/leaf.js'])
  assertEquals(Object.keys(manifest).includes('/assets/shared.js'), false)
})

Deno.test('computeModulePreloads: ignores assets, external imports and a chunk with no dependency', () => {
  const bundle: Record<string, PreloadBundleChunk> = {
    ...Object.fromEntries([
      chunk('assets/lone.js', [], { isEntry: true }),
      chunk('assets/e.js', ['https://cdn.example/x.js', 'assets/missing.js'], { isEntry: true }),
    ]),
    'assets/style.css': { type: 'asset', fileName: 'assets/style.css' },
  }
  assertEquals(computeModulePreloads(bundle), {})
})

Deno.test('computeModulePreloads: the same graph always yields the same manifest, keys sorted', () => {
  const a = Object.fromEntries([
    chunk('assets/b.js', ['assets/d.js'], { isEntry: true }),
    chunk('assets/a.js', ['assets/d.js'], { isEntry: true }),
    chunk('assets/d.js'),
  ])
  const b = Object.fromEntries(Object.entries(a).reverse())
  assertEquals(JSON.stringify(computeModulePreloads(a)), JSON.stringify(computeModulePreloads(b)))
  assertEquals(Object.keys(computeModulePreloads(a)), ['/assets/a.js', '/assets/b.js'])
})
