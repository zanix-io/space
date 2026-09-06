import { assertEquals } from '@std/assert'
import { join } from '@std/path'
import { getTemporaryFolder } from '@zanix/helpers'
import { discoverUsedCometImports } from 'modules/bundler/discover-comets.ts'

const TMP_ROOT = getTemporaryFolder(import.meta.url)

async function withTempDir(
  run: (root: string) => Promise<void>,
): Promise<void> {
  const root = await Deno.makeTempDir({ dir: TMP_ROOT })
  try {
    await run(root)
  } finally {
    await Deno.remove(root, { recursive: true })
  }
}

/**
 * The real-network counterpart to `unit/bundler/discover-comets.test.ts`'s own local-vendored-
 * alias tests — those prove the re-export-following/directive-detection logic in isolation; this
 * proves the SAME logic against a real, immutable, already-published third-party package a real
 * consumer app would actually reach for: `@zanix/space-ui@2.0.0`'s own `NavDrawer`, imported from
 * its real `runtime/nav-drawer` subpath, resolved through a real `@deno/loader` `jsr:` entrypoint
 * and read back over a real `fetch`, never a stub. Pinned to an exact, immutable published version
 * (never a `^` range) so this never drifts against a moving target.
 */
Deno.test(
  "discoverUsedCometImports: the real, published @zanix/space-ui NavDrawer — reached through its own runtime/nav-drawer subpath, then a real relative re-export hop down to its own file that actually carries 'use comet' — resolves end to end over a real network fetch",
  async () => {
    await withTempDir(async (root) => {
      await Deno.writeTextFile(
        join(root, 'deno.json'),
        JSON.stringify({
          imports: {
            '@zanix/space-ui/runtime/nav-drawer': 'jsr:@zanix/space-ui@2.0.0/runtime/nav-drawer',
          },
        }),
      )
      await Deno.writeTextFile(
        join(root, 'layout.tsx'),
        "import { NavDrawer } from '@zanix/space-ui/runtime/nav-drawer'\n" +
          "export default function Layout() { return <NavDrawer label='Main' items={[]} /> }\n",
      )

      const found = await discoverUsedCometImports(root)
      assertEquals(
        found,
        new Set(['https://jsr.io/@zanix/space-ui/2.0.0/src/components/NavDrawer/index.ts']),
      )
    })
  },
)
