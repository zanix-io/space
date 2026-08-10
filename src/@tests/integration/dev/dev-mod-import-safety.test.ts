import { assert, assertEquals } from '@std/assert'
import { fromFileUrl } from '@std/path'

const DEV_MOD_PATH = fromFileUrl(import.meta.resolve('../../../modules/dev/mod.ts'))
const BUNDLER_MOD_PATH = fromFileUrl(import.meta.resolve('../../../modules/bundler/mod.ts'))

/** The exact npm specifiers whose eager top-level evaluation crashes under Deno (Lightning CSS's
 * native binding fails to resolve — see `dev-engine.ts`'s own `css: { transformer: 'postcss' }`
 * comment for the original, empirically-confirmed failure). `cssPlugin`'s own top-level `import
 * tailwindcss from '@tailwindcss/vite'` is what pulls these in. */
const UNSAFE_SPECIFIER_FRAGMENTS = [
  '@tailwindcss/vite',
  '@vanilla-extract/vite-plugin',
  'lightningcss',
]

/** The real, per-entrypoint reachable ESM module graph `deno info --json` resolves for `entry` —
 * never the tool's own whole-project npm-resolution snapshot (a separate, unscoped section of the
 * same JSON output that lists every npm package resolved anywhere in this project, regardless of
 * whether `entry` actually imports it — confirmed by diffing this exact query against a file with
 * no Vite-related import at all, which still "shows" @tailwindcss/vite there). Only `modules[].specifier`
 * reflects what `entry`'s own import graph actually reaches.
 */
async function reachableModuleSpecifiers(entry: string): Promise<string[]> {
  const { stdout } = await new Deno.Command('deno', {
    args: ['info', '--json', entry],
    cwd: fromFileUrl(import.meta.resolve('../../../../')),
  }).output()

  const { modules } = JSON.parse(new TextDecoder().decode(stdout)) as {
    modules: { specifier?: string }[]
  }
  return modules.map((m) => m.specifier).filter((s): s is string => Boolean(s))
}

Deno.test(
  '@zanix/space/dev (modules/dev/mod.ts): eager evaluation never reaches @tailwindcss/vite/lightningcss',
  async () => {
    const specifiers = await reachableModuleSpecifiers(DEV_MOD_PATH)

    for (const fragment of UNSAFE_SPECIFIER_FRAGMENTS) {
      assert(
        !specifiers.some((s) => s.includes(fragment)),
        `modules/dev/mod.ts must never reach '${fragment}' — an external consumer like ` +
          `@zanix/cli can only import this package through its declared exports map, and this ` +
          `is the one @zanix/space entry point zanix space dev depends on for the dev engine itself`,
      )
    }

    // Real proof the boundary actually re-exports what zanix space dev needs, not just that it's
    // safe — a boundary that's safe because it's empty would be a false pass.
    const mod = await import('modules/dev/mod.ts')
    assertEquals(typeof mod.createSpaceDevEngine, 'function')
    assertEquals(typeof mod.spacePlugin, 'function')
  },
)

Deno.test(
  '@zanix/space/vite (modules/bundler/mod.ts): still reaches @tailwindcss/vite as before — this fix never touched that entry point',
  async () => {
    // The inverse assertion, on the OTHER entry point — confirms this was a real boundary split,
    // not `cssPlugin` quietly losing its own dependency somewhere.
    const specifiers = await reachableModuleSpecifiers(BUNDLER_MOD_PATH)
    assert(specifiers.some((s) => s.includes('@tailwindcss/vite')))
  },
)
