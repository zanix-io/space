// Installs the Preact renderer, exactly as a real `--renderer preact` app does: `@zanix/space`
// itself ships none. A SEPARATE file from `native-runtime-modules.test.ts` (never both renderers
// imported into the same process) — see `define-space-app.ts`'s own "renderer mismatch" check,
// which this file would otherwise trip by having both `mod-react.ts` and `mod-preact.ts` installed
// at once.
import '../../../../mod-preact.ts'
import { useState } from 'preact/hooks'
import { assert } from '@std/assert'
import { getTemporaryFolder } from '@zanix/helpers'
import { join } from '@std/path'
import { createSpaceDevEngine } from 'modules/bundler/dev-engine.ts'

const TMP_ROOT = getTemporaryFolder(import.meta.url)
const isRouteEntry = (id: string) => id.endsWith('/page.tsx') || id.endsWith('page.tsx')

Deno.test(
  'nativeRuntimeModulesPlugin: a Comet\'s own "preact/hooks" import, evaluated through ' +
    'ssrLoadModule, resolves to the EXACT SAME useState reference (===) the native process ' +
    'already holds — never a second, Vite-transformed copy. Real, reproduced bug this closes: ' +
    "a Comet calling `useState` from `preact/hooks` under `--renderer preact` threw Preact's " +
    '"Hook can only be invoked from render methods." during SSR, the exact Preact-flavored ' +
    "equivalent of React's own `Invalid hook call` — `preact-render-to-string`'s own renderer " +
    "installs its hooks dispatcher on the NATIVE side's `preact` copy; a SEPARATE, Vite-resolved " +
    'copy (no dispatcher installed) is what a Comet calling a hook without this fix would read ' +
    "from instead. Fast and HTTP-free, same tier as `native-runtime-modules.test.ts`'s own first " +
    'test — this alone is what closes the identity split; nothing here renders a real component.',
  async () => {
    const root = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      await Deno.writeTextFile(
        join(root, 'probe.ts'),
        `export { useState } from 'preact/hooks'\n`,
      )

      const engine = await createSpaceDevEngine({ root, isRouteEntry })
      try {
        const mod = await engine.ssrLoadModule('/probe.ts')
        assert(
          mod.useState === useState,
          'ssrLoadModule\'s own "preact/hooks" import must resolve to the exact native useState ' +
            'reference (===), not a structurally-identical but reference-different duplicate — ' +
            'see native-runtime-modules.ts for the mechanism (a synthetic `znxruntime://` ' +
            'external id, decoded back to a plain native `import()` by ssr-module-evaluator.ts) ' +
            'this proves actually took effect for `preact`/`preact/hooks`, the same as it already ' +
            'did for `react`/`react-dom`.',
        )
      } finally {
        await engine.close()
      }
    } finally {
      await Deno.remove(root, { recursive: true })
    }
  },
)
