import { assert, assertEquals, assertRejects } from '@std/assert'
import { join } from '@std/path'
import { getTemporaryFolder } from '@zanix/helpers'
import { InternalError } from '@zanix/errors'
import { setDevClientEnabled } from 'modules/dev/dev-client-registry.ts'
import {
  getGlobalCssPaths,
  resolveCssHrefs,
  setCssManifest,
  setGlobalCssPaths,
} from 'modules/render/css-manifest.ts'
import {
  addCssSources,
  CSS_SOURCES_DIR,
  getCssSourcePaths,
  getCssSources,
  materializeCssSources,
  resetCssSources,
} from 'modules/render/css-sources.ts'

const TMP_ROOT = getTemporaryFolder(import.meta.url)

function reset() {
  resetCssSources()
  setGlobalCssPaths(undefined)
  setCssManifest(undefined)
  setDevClientEnabled(false)
}

async function withTempRoot(run: (root: string) => Promise<void>): Promise<void> {
  const root = await Deno.makeTempDir({ dir: TMP_ROOT })
  try {
    await run(root)
  } finally {
    reset()
    await Deno.remove(root, { recursive: true })
  }
}

Deno.test('cssSources: a name that is not file-name safe is rejected, nothing is registered', () => {
  reset()
  for (const name of ['', 'Iam', '../escape', 'a/b', '-iam', 'iam.css', 'iam ui']) {
    let thrown: unknown
    try {
      addCssSources([{ name, css: '' }])
    } catch (error) {
      thrown = error
    }
    assert(thrown instanceof InternalError, `'${name}' was accepted`)
  }
  assertEquals(getCssSources(), [])
})

Deno.test('cssSources: declarations add to the list, and a repeated name keeps its position', () => {
  reset()
  addCssSources([{ name: 'iam', css: 'a' }, { name: 'ui', css: 'b' }])
  addCssSources([{ name: 'extra', css: 'c' }, { name: 'iam', css: 'a2' }])
  assertEquals(getCssSources().map((source) => [source.name, source.css]), [
    ['iam', 'a2'],
    ['ui', 'b'],
    ['extra', 'c'],
  ])
})

Deno.test('cssSources: materialize writes each source into the project and registers its path', async () => {
  reset()
  await withTempRoot(async (root) => {
    addCssSources([
      { name: 'iam', css: '.a { color: red; }\n' },
      { name: 'print', css: () => Promise.resolve('.p { color: black; }\n'), media: 'print' },
    ])
    await materializeCssSources(root)

    assertEquals(
      await Deno.readTextFile(join(root, CSS_SOURCES_DIR, 'iam.css')),
      '.a { color: red; }\n',
    )
    assertEquals(
      await Deno.readTextFile(join(root, CSS_SOURCES_DIR, 'print.css')),
      '.p { color: black; }\n',
    )
    assertEquals(getCssSourcePaths(), [
      './.space/css-sources/iam.css',
      { href: './.space/css-sources/print.css', media: 'print' },
    ])
  })
})

Deno.test('cssSources: an unchanged file is not rewritten, a changed one is', async () => {
  reset()
  await withTempRoot(async (root) => {
    const file = join(root, CSS_SOURCES_DIR, 'iam.css')
    addCssSources([{ name: 'iam', css: '.a {}' }])
    await materializeCssSources(root)
    const before = (await Deno.stat(file)).mtime?.getTime()

    // A distinguishable clock tick, so an accidental rewrite would change the modification time.
    await new Promise((resolve) => setTimeout(resolve, 25))
    await materializeCssSources(root)
    assertEquals((await Deno.stat(file)).mtime?.getTime(), before)

    addCssSources([{ name: 'iam', css: '.a { color: blue; }' }])
    await materializeCssSources(root)
    assertEquals(await Deno.readTextFile(file), '.a { color: blue; }')
  })
})

Deno.test('cssSources: no source at all writes nothing and leaves the global list alone', async () => {
  reset()
  await withTempRoot(async (root) => {
    setGlobalCssPaths(['./app.css'])
    await materializeCssSources(root)
    assertEquals(getGlobalCssPaths(), ['./app.css'])
    let created = true
    try {
      await Deno.stat(join(root, '.space'))
    } catch (error) {
      created = !(error instanceof Deno.errors.NotFound)
    }
    assertEquals(created, false)
  })
})

Deno.test('cssSources: a function that throws, or a source that is not a string, fails loudly', async () => {
  reset()
  await withTempRoot(async (root) => {
    addCssSources([{
      name: 'broken',
      css: () => {
        throw new Error('boom')
      },
    }])
    const failed = await assertRejects(() => materializeCssSources(root), InternalError)
    assertEquals(failed.code, 'SPACE_CSS_SOURCE_FAILED')

    resetCssSources()
    addCssSources([{ name: 'wrong', css: (() => 42) as never }])
    await assertRejects(() => materializeCssSources(root), InternalError)
  })
})

Deno.test("cssSources: the global list puts the sources ahead of the app's own stylesheets", async () => {
  reset()
  await withTempRoot(async (root) => {
    setGlobalCssPaths(['./app.css', { href: './mobile.css', media: '(max-width: 599px)' }])
    addCssSources([{ name: 'iam', css: '.a {}' }])
    assertEquals(getGlobalCssPaths()?.length, 2) // not materialized yet: nothing to prepend

    await materializeCssSources(root)
    assertEquals(getGlobalCssPaths(), [
      './.space/css-sources/iam.css',
      './app.css',
      { href: './mobile.css', media: '(max-width: 599px)' },
    ])
  })
})

Deno.test('cssSources: dev links the materialized sources first, prod reads the manifest as built', async () => {
  reset()
  await withTempRoot(async (root) => {
    setGlobalCssPaths(['./app.css'])
    addCssSources([{ name: 'iam', css: '.a {}' }])
    await materializeCssSources(root)

    setDevClientEnabled(true)
    assertEquals(resolveCssHrefs(), ['/.space/css-sources/iam.css?direct', '/app.css?direct'])

    setDevClientEnabled(false)
    setCssManifest({ global: ['/assets/iam-1.css', '/assets/app-2.css'] })
    assertEquals(resolveCssHrefs(), ['/assets/iam-1.css', '/assets/app-2.css'])
  })
})
