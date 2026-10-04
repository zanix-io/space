import { assert, assertEquals, assertFalse } from '@std/assert'
import { fromFileUrl, join } from '@std/path'
import { getTemporaryFolder } from '@zanix/helpers'
import { buildSpaceClient } from 'modules/bundler/build-client.ts'
import { resetEvaluatedComets } from 'modules/comets/evaluated-comets.ts'
import { MODULE_PRELOAD_MANIFEST_FILE } from 'modules/render/modulepreload-manifest.ts'

const TMP_ROOT = getTemporaryFolder(import.meta.url)
const DEFINE_COMET_URL = new URL('../../../modules/comets/define-comet.ts', import.meta.url).href

async function withProject(
  run: (paths: { root: string; routesDir: string }) => Promise<void>,
): Promise<void> {
  const root = await Deno.makeTempDir({ dir: TMP_ROOT })
  const routesDir = join(root, 'routes')
  await Deno.mkdir(routesDir, { recursive: true })
  const { parse } = await import('jsr:@std/jsonc@^1.0.2')
  const ownDenoJsonc = parse(
    await Deno.readTextFile(fromFileUrl(new URL('../../../../deno.jsonc', import.meta.url))),
  ) as { imports: Record<string, string> }
  await Deno.writeTextFile(
    join(root, 'deno.json'),
    JSON.stringify({
      imports: {
        ...ownDenoJsonc.imports,
        '@zanix/space/client': fromFileUrl(
          new URL('../../../modules/client/mod.ts', import.meta.url),
        ),
      },
    }),
  )
  resetEvaluatedComets()
  try {
    await run({ root, routesDir })
  } finally {
    resetEvaluatedComets()
    await Deno.remove(root, { recursive: true })
  }
}

function cometSource(name: string): string {
  return `'use comet'
import { defineComet } from '${DEFINE_COMET_URL}'
import { shared } from '../shared.ts'
function ${name}() {
  return shared('${name}')
}
export default defineComet(${name}, import.meta.url, '${name}')
`
}

Deno.test(
  'buildSpaceClient: modulepreload-manifest.json lists, for each comet chunk, the chunks it imports ' +
    'statically (the module two comets share is one chunk, listed for both)',
  async () => {
    await withProject(async ({ root, routesDir }) => {
      await Deno.mkdir(join(root, 'comets'))
      // Enough code that the shared module is split out instead of inlined twice.
      await Deno.writeTextFile(
        join(root, 'shared.ts'),
        `export const shared = (name: string) =>\n  ['shared-module-marker', name, ${
          JSON.stringify(Array.from({ length: 40 }, (_, i) => `entry-${i}`))
        }].join('/')\n`,
      )
      await Deno.writeTextFile(join(root, 'comets', 'alpha.tsx'), cometSource('Alpha'))
      await Deno.writeTextFile(join(root, 'comets', 'beta.tsx'), cometSource('Beta'))
      await Deno.writeTextFile(
        join(routesDir, 'page.tsx'),
        "import Alpha from '../comets/alpha.tsx'\nimport Beta from '../comets/beta.tsx'\n" +
          'export default function Page() {\n  return [Alpha({}), Beta({})]\n}\n',
      )

      const result = await buildSpaceClient({
        root,
        routesDir,
        css: { tailwind: false },
        minify: false,
      })

      const cometManifest = JSON.parse(
        await Deno.readTextFile(join(result.outDir, 'comets-manifest.json')),
      ) as Record<string, string>
      const preloads = JSON.parse(
        await Deno.readTextFile(join(result.outDir, MODULE_PRELOAD_MANIFEST_FILE)),
      ) as Record<string, string[]>

      const alpha = cometManifest[await Deno.realPath(join(root, 'comets', 'alpha.tsx'))]
      const beta = cometManifest[await Deno.realPath(join(root, 'comets', 'beta.tsx'))]
      assert(alpha && beta, JSON.stringify(cometManifest))

      const alphaDeps = preloads[alpha]
      const betaDeps = preloads[beta]
      assert(alphaDeps?.length, `no preload entry for ${alpha}: ${JSON.stringify(preloads)}`)
      assert(betaDeps?.length, `no preload entry for ${beta}: ${JSON.stringify(preloads)}`)

      // Both comets import the same shared chunk.
      const sharedInBoth = alphaDeps.filter((url) => betaDeps.includes(url))
      assert(sharedInBoth.length > 0, JSON.stringify({ alphaDeps, betaDeps }))

      // Every listed URL is a real chunk of this build, once, never the comet itself.
      for (const [chunk, deps] of Object.entries(preloads)) {
        assertEquals(new Set(deps).size, deps.length, `${chunk} repeats a dependency`)
        assertFalse(deps.includes(chunk), `${chunk} lists itself`)
        for (const dep of deps) {
          assert(dep.startsWith('/assets/') && dep.endsWith('.js'), dep)
          // deno-lint-ignore no-await-in-loop -- a handful of files, checked one by one
          await Deno.stat(join(result.outDir, dep.replace(/^\//, '')))
        }
      }
    })
  },
)
