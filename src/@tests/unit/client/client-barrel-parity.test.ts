import { assertEquals } from '@std/assert'
import { fromFileUrl } from '@std/path'

/**
 * The two client barrels must expose the SAME public surface — `@zanix/space/client` (React) and
 * `@zanix/space/client/preact` are one API with one renderer-specific implementation inside it
 * (`hydrateComets`), not two APIs that happen to overlap.
 *
 * This exists because they had already drifted: `prefetch.ts` — DOM-only, importing neither
 * renderer — was exported from the React barrel and simply missed on the Preact one, which left
 * `initOrbit({ prefetch })`'s own option type unnameable from a `--renderer=preact` app while the
 * runtime it configures was the very same module. Nothing failed; the Preact half of the framework
 * was just quietly smaller. A name-set comparison catches that class of omission the moment it
 * happens, without asserting anything about what either barrel's `hydrateComets` actually does.
 *
 * Each barrel is loaded in its OWN subprocess, deliberately: importing both into one process would
 * also mean both `setCometHydrator` registrations running in it (last one wins), which is exactly
 * the mixed-renderer state `renderer-invariant.test.ts` documents as impossible in a real app. It
 * also proves each barrel loads standalone — the only way an app ever loads one.
 *
 * @module
 */

const ROOT = fromFileUrl(import.meta.resolve('../../../../'))

/** The runtime export names of one barrel, read from a process that loaded ONLY that barrel. */
async function exportNames(modulePath: string): Promise<string[]> {
  const { stdout, stderr, success } = await new Deno.Command(Deno.execPath(), {
    args: [
      'eval',
      '--min-dep-age=0',
      `const m = await import('${modulePath}'); console.log(Object.keys(m).sort().join(','))`,
    ],
    cwd: ROOT,
  }).output()

  if (!success) {
    throw new Error(
      `failed to import ${modulePath} standalone:\n${new TextDecoder().decode(stderr)}`,
    )
  }
  return new TextDecoder().decode(stdout).trim().split(',')
}

Deno.test(
  '@zanix/space/client and @zanix/space/client/preact expose the identical set of export names — ' +
    'one API, one renderer-specific implementation inside it',
  async () => {
    const [react, preact] = await Promise.all([
      exportNames('modules/client/mod.ts'),
      exportNames('modules/client/mod-preact.ts'),
    ])

    // Real proof the comparison is not vacuously passing on two empty lists.
    assertEquals(react.includes('hydrateComets'), true)
    assertEquals(react.includes('initOrbit'), true)
    assertEquals(react.includes('shouldPrefetch'), true)

    assertEquals(
      preact,
      react,
      `client barrel drift: @zanix/space/client exports [${react.join(', ')}], ` +
        `@zanix/space/client/preact exports [${preact.join(', ')}]`,
    )
  },
)
