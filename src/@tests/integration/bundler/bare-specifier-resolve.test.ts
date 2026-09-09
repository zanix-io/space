import { assert, assertEquals } from '@std/assert'
import { join } from '@std/path'
import { getTemporaryFolder } from '@zanix/helpers'
import { resolveBareSpecifierCanonically } from 'modules/bundler/bare-specifier-resolve.ts'

const TMP_ROOT = getTemporaryFolder(import.meta.url)

/** A real temp project whose own `deno.json` deliberately never declares `preact` — the only way
 * a resolution of `preact` inside it can succeed is via the `getSpaceOwnLoader` fallback this file
 * tests, never through the project's own scope. */
async function withProjectNotDeclaringPreact(
  run: (root: string) => Promise<void>,
): Promise<void> {
  const root = await Deno.makeTempDir({ dir: TMP_ROOT })
  try {
    await Deno.writeTextFile(
      join(root, 'deno.json'),
      JSON.stringify({ imports: { 'is-odd': 'npm:is-odd@^3.0.1' } }),
    )
    await run(root)
  } finally {
    await Deno.remove(root, { recursive: true })
  }
}

Deno.test(
  'resolveBareSpecifierCanonically: a referrer-less request for preact — a specifier only @zanix/' +
    "space's own manifest declares, never a consuming project's — resolves via the getSpaceOwnLoader " +
    'fallback even though the project root genuinely does not declare it',
  async () => {
    await withProjectNotDeclaringPreact(async (root) => {
      const resolved = await resolveBareSpecifierCanonically('preact', root, undefined)
      assert(
        resolved,
        'expected the referrer-less fallback against getSpaceOwnLoader to resolve preact',
      )
      assert(resolved.includes('preact'), `expected a path into preact, got: ${resolved}`)
    })
  },
)

Deno.test(
  'resolveBareSpecifierCanonically: a referrer-less request for a specifier neither the project ' +
    "nor @zanix/space's own manifest declares still resolves to null — the fallback doesn't " +
    'invent a resolution for a genuinely unrelated package',
  async () => {
    await withProjectNotDeclaringPreact(async (root) => {
      const resolved = await resolveBareSpecifierCanonically(
        'definitely-not-a-real-package-xyz-123',
        root,
        undefined,
      )
      assertEquals(resolved, null)
    })
  },
)

Deno.test(
  'resolveBareSpecifierCanonically: a real project-file referrer that fails to resolve preact ' +
    "never retries against @zanix/space's own loader — a real project file is trusted at face " +
    'value, not second-guessed against a package it never itself declared',
  async () => {
    await withProjectNotDeclaringPreact(async (root) => {
      const importerPath = join(root, 'page.tsx')
      await Deno.writeTextFile(importerPath, `import 'preact'\n`)
      const resolved = await resolveBareSpecifierCanonically('preact', root, importerPath)
      assertEquals(
        resolved,
        null,
        'a genuine project-file referrer must not fall back to getSpaceOwnLoader',
      )
    })
  },
)
