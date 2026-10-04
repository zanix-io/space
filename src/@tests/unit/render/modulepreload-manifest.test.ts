import { assertEquals, assertRejects } from '@std/assert'
import {
  dedupeModulePreloadLinks,
  getModulePreloadManifest,
  isModulePreloadEnabled,
  loadModulePreloadManifest,
  MAX_MODULE_PRELOADS_PER_CHUNK,
  resolveModulePreloads,
  setModulePreloadEnabled,
  setModulePreloadManifest,
} from 'modules/render/modulepreload-manifest.ts'

function reset() {
  setModulePreloadManifest(undefined)
  setModulePreloadEnabled(true)
}

Deno.test('resolveModulePreloads: the chunk first, then its dependencies', () => {
  reset()
  setModulePreloadManifest({ '/a.js': ['/b.js', '/c.js'] })
  assertEquals(resolveModulePreloads('/a.js'), ['/a.js', '/b.js', '/c.js'])
  reset()
})

Deno.test('resolveModulePreloads: caps the dependencies of one chunk', () => {
  reset()
  const deps = Array.from({ length: MAX_MODULE_PRELOADS_PER_CHUNK + 10 }, (_, i) => `/d${i}.js`)
  setModulePreloadManifest({ '/a.js': deps })
  const urls = resolveModulePreloads('/a.js')
  assertEquals(urls.length, MAX_MODULE_PRELOADS_PER_CHUNK + 1)
  assertEquals(urls.slice(0, 3), ['/a.js', '/d0.js', '/d1.js'])
  reset()
})

Deno.test('resolveModulePreloads: nothing with no manifest (dev, an older build), the option off, or no chunk', () => {
  reset()
  assertEquals(resolveModulePreloads('/a.js'), [])
  setModulePreloadManifest({ '/a.js': ['/b.js'] })
  assertEquals(resolveModulePreloads(undefined), [])
  assertEquals(resolveModulePreloads(''), [])
  setModulePreloadEnabled(false)
  assertEquals(isModulePreloadEnabled(), false)
  assertEquals(resolveModulePreloads('/a.js'), [])
  reset()
})

Deno.test('resolveModulePreloads: a chunk the manifest does not list still preloads itself', () => {
  reset()
  setModulePreloadManifest({})
  assertEquals(resolveModulePreloads('/solo.js'), ['/solo.js'])
  reset()
})

Deno.test('loadModulePreloadManifest: reads the file, tolerates a missing one, fails on a broken one', async () => {
  reset()
  const dir = await Deno.makeTempDir()
  try {
    await loadModulePreloadManifest(`${dir}/missing.json`)
    assertEquals(getModulePreloadManifest(), undefined)

    await Deno.writeTextFile(`${dir}/ok.json`, JSON.stringify({ '/a.js': ['/b.js'] }))
    await loadModulePreloadManifest(`${dir}/ok.json`)
    assertEquals(getModulePreloadManifest(), { '/a.js': ['/b.js'] })

    await Deno.writeTextFile(`${dir}/bad.json`, '{ nope')
    await assertRejects(() => loadModulePreloadManifest(`${dir}/bad.json`))
  } finally {
    reset()
    await Deno.remove(dir, { recursive: true })
  }
})

Deno.test('dedupeModulePreloadLinks: keeps the first link per href, in order, and nothing else', () => {
  const html =
    '<head><link rel="stylesheet" href="/s.css"><link rel="modulepreload" href="/a.js">' +
    '</head><body><link rel="modulepreload" href="/b.js"/><i>x</i>' +
    '<link rel="modulepreload" href="/a.js"/><link rel="modulepreload" href="/b.js"></body>'
  assertEquals(
    dedupeModulePreloadLinks(html),
    '<head><link rel="stylesheet" href="/s.css"><link rel="modulepreload" href="/a.js">' +
      '</head><body><link rel="modulepreload" href="/b.js"/><i>x</i></body>',
  )
})

Deno.test('dedupeModulePreloadLinks: a document with no preload is returned untouched', () => {
  const html = '<link rel="stylesheet" href="/s.css"><link rel="stylesheet" href="/s.css">'
  assertEquals(dedupeModulePreloadLinks(html), html)
})
