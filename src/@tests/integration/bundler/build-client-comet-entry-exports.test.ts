import { assert } from '@std/assert'
import { fromFileUrl, join } from '@std/path'
import { getTemporaryFolder } from '@zanix/helpers'
import { buildSpaceClient } from 'modules/bundler/build-client.ts'
import type { RendererKind } from 'modules/router/active-renderer.ts'

const TMP_ROOT = getTemporaryFolder(import.meta.url)

const READY_MADE = [
  'SubmitGuard',
  'FormDraftPersistence',
  'NetworkStatus',
  'ScrollRestoration',
  'UnsavedChangesGuard',
]

/**
 * Builds a project whose only author comet renders every ready-made comet. The ready-made comets
 * are reached through that comet and appear in no other source of the project, so the bundler
 * emits their chunks itself instead of receiving them as inputs. Returns the built comets
 * manifest and the output directory.
 */
async function buildFixture(
  renderer: RendererKind,
  minify: boolean,
): Promise<{ manifest: Record<string, string>; outDir: string; root: string }> {
  const root = await Deno.makeTempDir({ dir: TMP_ROOT })
  const { parse } = await import('jsr:@std/jsonc@^1.0.2')
  const ownDenoJsonc = parse(
    await Deno.readTextFile(fromFileUrl(new URL('../../../../deno.jsonc', import.meta.url))),
  ) as { imports: Record<string, string> }
  const modules = new URL('../../../modules/', import.meta.url)
  await Deno.writeTextFile(
    join(root, 'deno.json'),
    JSON.stringify({
      imports: {
        ...ownDenoJsonc.imports,
        '@zanix/space/comet': fromFileUrl(new URL('comets/mod.ts', modules)),
        '@zanix/space/client': fromFileUrl(new URL('client/mod.ts', modules)),
        '@zanix/space/client/preact': fromFileUrl(new URL('client/mod-preact.ts', modules)),
        [`@zanix/space/comet/${renderer}`]: fromFileUrl(
          new URL(`comets/mod-${renderer}.ts`, modules),
        ),
      },
    }),
  )
  const routesDir = join(root, 'routes')
  const cometsDir = join(root, 'comets')
  await Deno.mkdir(routesDir, { recursive: true })
  await Deno.mkdir(cometsDir)
  await Deno.writeTextFile(
    join(cometsDir, 'form-shell.tsx'),
    `'use comet'
import { defineComet } from '@zanix/space/comet'
import { ${READY_MADE.join(', ')} } from '@zanix/space/comet/${renderer}'
export function FormShell() {
  return <>
    <SubmitGuard formId='f' />
    <FormDraftPersistence formId='f' storageKey='k' hasServerValues={false} />
    <NetworkStatus />
    <ScrollRestoration />
    <UnsavedChangesGuard formId='f' />
  </>
}
export default defineComet(FormShell, import.meta.url)
`,
  )
  await Deno.writeTextFile(
    join(routesDir, 'page.tsx'),
    "import FormShell from '../comets/form-shell.tsx'\n" +
      'export default function Page() { return FormShell({}) }\n',
  )

  const result = await buildSpaceClient({
    root,
    routesDir,
    renderer,
    css: { tailwind: false },
    minify,
  })
  const manifest = JSON.parse(
    await Deno.readTextFile(join(result.outDir, 'comets-manifest.json')),
  ) as Record<string, string>
  return { manifest, outDir: result.outDir, root }
}

for (const renderer of ['preact', 'react'] as const) {
  for (const minify of [true, false]) {
    Deno.test(
      `buildSpaceClient (${renderer}, minify: ${minify}): every comet entry exports the comet ` +
        'under its own name and as default, including ready-made comets reached only through ' +
        'another comet',
      async () => {
        const { manifest, outDir, root } = await buildFixture(renderer, minify)
        try {
          await Promise.all(READY_MADE.map(async (name) => {
            const source = Object.keys(manifest).find((key) =>
              key.includes(`/comets/${name.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()}-`)
            )
            assert(source, `${name} is missing from the manifest: ${JSON.stringify(manifest)}`)
            const entry = await Deno.readTextFile(join(outDir, manifest[source].slice(1)))
            const exportList = [...entry.matchAll(/export\s*\{([^}]*)\}/g)].map((m) => m[1])
              .join(',')
            assert(exportList.includes('default'), `${manifest[source]}: ${entry}`)
            assert(
              new RegExp(`\\b${name}\\b`).test(exportList),
              `${manifest[source]} does not export ${name}: ${entry}`,
            )
          }))
          const own = Object.keys(manifest).find((key) => key.endsWith('form-shell.tsx'))
          assert(own, JSON.stringify(manifest))
        } finally {
          await Deno.remove(root, { recursive: true })
        }
      },
    )
  }
}
