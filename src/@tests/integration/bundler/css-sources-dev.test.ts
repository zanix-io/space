import { assert, assertEquals } from '@std/assert'
import { join } from '@std/path'
import { getTemporaryFolder } from '@zanix/helpers'
import { createSpaceDevEngine } from 'modules/bundler/dev-engine.ts'
import { setDevClientEnabled } from 'modules/dev/dev-client-registry.ts'
import { resolveCssHrefs, setGlobalCssPaths } from 'modules/render/css-manifest.ts'
import { addCssSources, resetCssSources } from 'modules/render/css-sources.ts'

const TMP_ROOT = getTemporaryFolder(import.meta.url)

const isRouteEntry = (id: string) => id.endsWith('page.tsx')

Deno.test(
  'createSpaceDevEngine: a declared cssSource is materialized, linked before the app stylesheets ' +
    'and served as real CSS with ?direct',
  async () => {
    const root = await Deno.makeTempDir({ dir: TMP_ROOT })
    let engine: Awaited<ReturnType<typeof createSpaceDevEngine>> | undefined
    try {
      await Deno.writeTextFile(join(root, 'app.css'), '.app { color: red; }\n')
      setGlobalCssPaths(['./app.css'])
      addCssSources([{ name: 'iam', css: ':where(.x) { margin: 1px; }\n' }])
      setDevClientEnabled(true)

      engine = await createSpaceDevEngine({ root, isRouteEntry })

      assertEquals(resolveCssHrefs(), ['/.space/css-sources/iam.css?direct', '/app.css?direct'])
      const asset = await engine.transformClientAsset('/.space/css-sources/iam.css?direct')
      assert(asset)
      assertEquals(asset.contentType, 'text/css; charset=utf-8')
      assert(asset.code.includes(':where(.x)'), asset.code)
      assert(asset.code.includes('margin: 1px'), asset.code)
    } finally {
      await engine?.close()
      setDevClientEnabled(false)
      resetCssSources()
      setGlobalCssPaths(undefined)
      await Deno.remove(root, { recursive: true })
    }
  },
)
