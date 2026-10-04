import { assert, assertEquals, assertFalse } from '@std/assert'
import { fromFileUrl, join } from '@std/path'
import { getTemporaryFolder } from '@zanix/helpers'
import { buildSpaceClient } from 'modules/bundler/build-client.ts'
import { resetEvaluatedComets } from 'modules/comets/evaluated-comets.ts'

const TMP_ROOT = getTemporaryFolder(import.meta.url)

/**
 * A project root plus, beside it, a directory standing for a package installed outside the project
 * (what `@zanix/iam` is to a real app), and a `deno.json` for the project that resolves the same
 * specifiers this repository does.
 */
async function withProjectAndPackage(
  run: (paths: { root: string; routesDir: string; pkg: string }) => Promise<void>,
): Promise<void> {
  const base = await Deno.makeTempDir({ dir: TMP_ROOT })
  const root = join(base, 'project')
  const pkg = join(base, 'package')
  const routesDir = join(root, 'routes')
  await Deno.mkdir(routesDir, { recursive: true })
  await Deno.mkdir(pkg)

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
    await run({ root, routesDir, pkg })
  } finally {
    resetEvaluatedComets()
    await Deno.remove(base, { recursive: true })
  }
}

const DEFINE_COMET_URL = new URL('../../../modules/comets/define-comet.ts', import.meta.url).href

/** A Comet the way a published package ships it: its own file, a DEFAULT export. */
function cometSource(name: string): string {
  return `'use comet'
import { defineComet } from '${DEFINE_COMET_URL}'
function ${name}() {
  return null
}
export default defineComet(${name}, import.meta.url, '${name}')
`
}

Deno.test(
  'buildSpaceClient: a Comet a dependency renders for the app, default-exported and reached ' +
    "through that dependency's own view with no JSX anywhere, gets a chunk and a manifest entry",
  async () => {
    await withProjectAndPackage(async ({ root, routesDir, pkg }) => {
      // The dependency: a view that is handed a Comet and calls it, and the Comet itself.
      await Deno.writeTextFile(join(pkg, 'login-two-step.tsx'), cometSource('LoginTwoStep'))
      await Deno.writeTextFile(
        join(pkg, 'login-view.tsx'),
        "import LoginTwoStep from './login-two-step.tsx'\n" +
          'export function LoginView() {\n  return LoginTwoStep({})\n}\n',
      )
      // The app renders the view only; no source of its own names `LoginTwoStep`.
      await Deno.writeTextFile(
        join(routesDir, 'page.tsx'),
        "import { LoginView } from '../../package/login-view.tsx'\n" +
          'export default function Page() {\n  return LoginView()\n}\n',
      )

      const result = await buildSpaceClient({
        root,
        routesDir,
        css: { tailwind: false },
        minify: false,
      })

      const manifest = JSON.parse(
        await Deno.readTextFile(join(result.outDir, 'comets-manifest.json')),
      ) as Record<string, string>
      const cometPath = await Deno.realPath(join(pkg, 'login-two-step.tsx'))
      const builtUrl = manifest[cometPath]
      assert(builtUrl, `LoginTwoStep is missing from the manifest: ${JSON.stringify(manifest)}`)
      await Deno.stat(join(result.outDir, builtUrl.replace(/^\//, '')))
      // The view is a plain component: it never becomes a Comet entry.
      assertFalse(Object.keys(manifest).some((key) => key.endsWith('login-view.tsx')))
    })
  },
)

Deno.test(
  'buildSpaceClient: a Comet inside the project is still built once, not again as an outside one',
  async () => {
    await withProjectAndPackage(async ({ root, routesDir }) => {
      const own = join(root, 'comets', 'own.tsx')
      await Deno.mkdir(join(root, 'comets'))
      await Deno.writeTextFile(own, cometSource('Own'))
      await Deno.writeTextFile(
        join(routesDir, 'page.tsx'),
        "import Own from '../comets/own.tsx'\nexport default function Page() {\n  return Own({})\n}\n",
      )

      const result = await buildSpaceClient({
        root,
        routesDir,
        css: { tailwind: false },
        minify: false,
      })

      const manifest = JSON.parse(
        await Deno.readTextFile(join(result.outDir, 'comets-manifest.json')),
      ) as Record<string, string>
      const ownEntries = Object.keys(manifest).filter((key) => key.endsWith('own.tsx'))
      assertEquals(ownEntries, [await Deno.realPath(own)])
    })
  },
)

Deno.test(
  'buildSpaceClient: a page that imports the barrel of ready-made Comets Space ships gets a chunk ' +
    "for a dependency's Comet and for none of the ready-made ones it does not render",
  async () => {
    await withProjectAndPackage(async ({ root, routesDir, pkg }) => {
      // Space's own barrel resolves to this checkout, as in the ready-made Comet test beside this.
      const denoJson = JSON.parse(await Deno.readTextFile(join(root, 'deno.json')))
      denoJson.imports['@zanix/space/comet/react'] = fromFileUrl(
        new URL('../../../modules/comets/mod-react.ts', import.meta.url),
      )
      await Deno.writeTextFile(join(root, 'deno.json'), JSON.stringify(denoJson))

      await Deno.writeTextFile(join(pkg, 'toggle.tsx'), cometSource('Toggle'))
      await Deno.writeTextFile(
        join(routesDir, 'page.tsx'),
        // The barrel is evaluated (every ready-made Comet runs its own `defineComet`), and none of
        // them is rendered.
        "import { SubmitGuard as _unused } from '@zanix/space/comet/react'\n" +
          "import Toggle from '../../package/toggle.tsx'\n" +
          'export default function Page() {\n  void _unused\n  return Toggle({})\n}\n',
      )

      const result = await buildSpaceClient({
        root,
        routesDir,
        css: { tailwind: false },
        minify: false,
      })
      const manifest = JSON.parse(
        await Deno.readTextFile(join(result.outDir, 'comets-manifest.json')),
      ) as Record<string, string>
      const keys = Object.keys(manifest)

      assert(
        keys.includes(await Deno.realPath(join(pkg, 'toggle.tsx'))),
        `the dependency's Comet is missing: ${keys.join(', ')}`,
      )
      const spaceComets = keys.filter((key) => key.includes('/modules/comets/'))
      assertEquals(spaceComets, [], `ready-made Comets nobody renders were built: ${spaceComets}`)
    })
  },
)
