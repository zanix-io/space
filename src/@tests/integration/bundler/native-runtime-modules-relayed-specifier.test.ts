import '../../../../mod-react.ts'
import { assert } from '@std/assert'
import { join } from '@std/path'
import { getTemporaryFolder } from '@zanix/helpers'
import { createSpaceDevEngine } from 'modules/bundler/dev-engine.ts'

const TMP_ROOT = getTemporaryFolder(import.meta.url)
const isRouteEntry = (id: string) => id.endsWith('/page.tsx')

/**
 * Gates the test below — same `RUN_X_TESTS`/temporary-`deno.jsonc`-entry convention
 * `native-runtime-modules.test.ts`'s own `shouldRunZanixAuthIdentityTest` already establishes,
 * for the identical reason: `@zanix/space-ui` is not, and must never become, a real dependency of
 * `@zanix/space` (the wrong direction entirely — `@zanix/space-ui` depends on `@zanix/space`,
 * never the reverse, see `zanix-dependency-direction`) — a permanent top-level `deno.jsonc`
 * `imports` entry for it is exactly the kind of accidental reversal that convention exists to
 * prevent, so this stays manual/opt-in rather than a normal always-on test dependency. Run it,
 * when actually needed, with `RUN_NATIVE_RUNTIME_RELAY_TEST=true` AND a temporary
 * `"@zanix/space-ui": "jsr:@zanix/space-ui@^2.0.0"` top-level `imports` entry added by hand first
 * (removed again afterward) — confirmed to fail with `Module not found` without it, and to pass
 * (a real, rendered Comet, no thrown `InternalError`) with it.
 */
const shouldRun = Deno.env.get('RUN_NATIVE_RUNTIME_RELAY_TEST') === 'true'

Deno.test(
  'nativeRuntimeModulesPlugin: a real @zanix/space-ui Comet (NavDrawer), reached through ' +
    "ssrLoadModule, renders correctly — the real, reproduced bug this closes: NavDrawer's own " +
    "internal `import { defineComet } from '@zanix/space/comet'` (a THIRD-PARTY package's own " +
    'source, resolved through ITS OWN declared dependency range, never the literal bare text it ' +
    'wrote) reaches this plugin as `jsr:@zanix/space@^1.0.0/comet` — a shape the bare-text-only ' +
    'match this plugin used to have never recognized, silently letting `@zanix/space` fall through ' +
    'as an ordinary, Vite-transformable dependency. The result: a SECOND, separately-evaluated ' +
    "copy of `element-factory.ts`, with none of the native side's own `setCometElementFactory()` " +
    'registration on it — `getCometElementFactory()` throws "no react element factory is ' +
    'registered" for THIS copy specifically, even though the native side\'s own copy has one and ' +
    'every OTHER (directly-imported) Comet in the same app keeps working. See ' +
    "native-runtime-modules.ts's own `isNativeRuntimeSpecifier` doc for the full mechanism and the " +
    'fix (`JSR_OR_NPM_SPECIFIER_RE`, normalizing a `jsr:`/`npm:`-prefixed specifier back to its ' +
    'bare `name`/`name/subpath` form before matching).',
  { ignore: !shouldRun },
  async () => {
    const root = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      await Deno.writeTextFile(
        join(root, 'probe-navdrawer.tsx'),
        [
          "import { NavDrawer } from '@zanix/space-ui/runtime/nav-drawer'",
          '',
          "// A plain function call, not JSX/createElement, is enough: CometBoundary's own body " +
          '(define-comet.ts) calls getCometElementFactory() as its very first statement, before ' +
          'anything that would need a real React render pass.',
          'export function tryRenderNavDrawer() {',
          '  return NavDrawer({ items: [], label: "Main navigation" })',
          '}',
        ].join('\n'),
      )

      const engine = await createSpaceDevEngine({ root, isRouteEntry })
      try {
        const mod = await engine.ssrLoadModule('/probe-navdrawer.tsx') as {
          tryRenderNavDrawer: () => { type: unknown }
        }

        const element = mod.tryRenderNavDrawer()
        assert(
          element && typeof element === 'object' && 'type' in element,
          'expected a real React element back — NavDrawer must not throw ' +
            '"no react element factory is registered"',
        )
      } finally {
        await engine.close()
      }
    } finally {
      await Deno.remove(root, { recursive: true })
    }
  },
)
