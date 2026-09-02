import { assert } from '@std/assert'
import { join } from '@std/path'
import { getTemporaryFolder } from '@zanix/helpers'
import { ProgramModule } from '@zanix/server'
import '@zanix/datamaster/core'
import { DlqProvider } from '@zanix/datamaster/dlq'
import { createSpaceDevEngine } from 'modules/bundler/dev-engine.ts'

const TMP_ROOT = getTemporaryFolder(import.meta.url)
const isRouteEntry = (id: string) => id.endsWith('/page.tsx') || id.endsWith('page.tsx')

/**
 * Gates the `@zanix/datamaster` identity test below — same `RUN_X_TESTS` convention
 * `native-runtime-modules.test.ts`'s own `shouldRunZanixAuthIdentityTest` establishes, for the
 * identical reason: `@zanix/datamaster` is NOT a top-level `imports` entry here on purpose, so
 * declaring it doesn't materialize its own Mongo/Redis driver dependencies into every
 * `@zanix/space` consumer's `node_modules`. `RealImportEvaluator.runExternalModule`'s own native
 * `import()` call (`ssr-module-evaluator.ts`) is issued from THAT file's own location, never under
 * `src/@tests/`, so the `scopes["./src/@tests/"]` entry `deno.jsonc` already carries for this
 * package's own test-file-level import does not reach it — only a real, TEMPORARY top-level
 * `"@zanix/datamaster/dlq": "jsr:@zanix/datamaster@^1.9.0/dlq"` entry does. Run this test, when
 * actually needed, with `RUN_ZANIX_DATAMASTER_IDENTITY_TEST=true` AND that temporary top-level
 * entry added by hand first, removing the entry again afterward.
 */
const shouldRunZanixDatamasterIdentityTest =
  Deno.env.get('RUN_ZANIX_DATAMASTER_IDENTITY_TEST') === 'true'

Deno.test(
  'nativeRuntimeModulesPlugin: a "@zanix/datamaster" import ssrLoadModule evaluates is the exact ' +
    'same, reference-identical DlqProvider class the native process already holds — never a ' +
    "second, Vite-transformed copy carrying none of the native side's own DI registration " +
    'metadata. Pins the exact production-shaped failure this closes — see ' +
    "native-runtime-modules.ts's own header doc for the full mechanism.",
  { ignore: !shouldRunZanixDatamasterIdentityTest },
  async () => {
    const root = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      await Deno.writeTextFile(
        join(root, 'probe-datamaster.ts'),
        `export { DlqProvider } from '@zanix/datamaster/dlq'\n`,
      )

      const engine = await createSpaceDevEngine({ root, isRouteEntry })
      try {
        const mod = await engine.ssrLoadModule('/probe-datamaster.ts') as {
          DlqProvider: typeof DlqProvider
        }

        assert(
          mod.DlqProvider === DlqProvider,
          'ssrLoadModule\'s own "@zanix/datamaster" import must resolve to the exact native ' +
            'DlqProvider class (===), not a structurally-identical but reference-different ' +
            "duplicate carrying none of the native side's own DI registration metadata.",
        )

        assert(
          ProgramModule.providers.get(mod.DlqProvider) !== undefined,
          'ProgramModule.providers.get must resolve the "dlq" provider through the SSR-loaded ' +
            'class reference — the exact resolution that fails, with ' +
            '"[BaseInstancesContainer]: Target is not a constructor", for any package outside ' +
            "NATIVE_RUNTIME_MODULES that registers a provider this way (@zanix/auth's own " +
            'production incident, see native-runtime-modules.ts).',
        )
      } finally {
        await engine.close()
      }
    } finally {
      await Deno.remove(root, { recursive: true })
    }
  },
)
