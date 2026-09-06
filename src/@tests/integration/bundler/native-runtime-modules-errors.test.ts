import { assert } from '@std/assert'
import { join } from '@std/path'
import { getTemporaryFolder } from '@zanix/helpers'
import { HttpError } from '@zanix/errors'
import { createSpaceDevEngine } from 'modules/bundler/dev-engine.ts'

const TMP_ROOT = getTemporaryFolder(import.meta.url)
const isRouteEntry = (id: string) => id.endsWith('/page.tsx') || id.endsWith('page.tsx')

/**
 * The real, reproduced `zanix space dev`-only bug this closes: `@zanix/errors` (a subpath of
 * `@zanix/utils`, aliased in every `zanix new`-scaffolded project's own `deno.jsonc` — exactly as
 * this package's own top-level `imports` block aliases it too, `"@zanix/errors": "jsr:@zanix/
 * utils@^4.1.0/errors"`) was NOT on `NATIVE_RUNTIME_MODULES`, while `@zanix/auth` IS. A page's own
 * `catch (e) { if (e instanceof HttpError...) }` reached through `ssrLoadModule` therefore held a
 * SEPARATE, Vite-transformed evaluation of `HttpError` than the one `@zanix/auth`'s own natively-
 * resolved internals (e.g. `totp.ts`'s `throw new HttpError('FORBIDDEN', ...)`) threw — two
 * different classes, so `instanceof` was `false` for a real, correctly-constructed `HttpError`,
 * and the page's own catch block never ran. Never reproduced in production (`deno run`, no Vite,
 * one native evaluation of everything) — see `native-runtime-modules.ts`'s own header doc,
 * "`@zanix/auth` is on this list too", for the identical, already-fixed mechanism this pins for
 * `@zanix/utils` instead.
 *
 * Unlike `@zanix/auth`/`@zanix/datamaster`, `@zanix/utils` (via its `@zanix/errors` alias) is
 * already a real, permanent top-level `deno.jsonc` dependency of this package (`@zanix/logger`/
 * `@zanix/helpers`/`@zanix/validator`/... all alias the same package) — no `RUN_X_TESTS` gate or
 * temporary import-map entry is needed for this test, unlike `native-runtime-modules.test.ts`'s
 * own `@zanix/auth` case or `-datamaster.test.ts`'s own `@zanix/datamaster` case.
 */
Deno.test(
  'nativeRuntimeModulesPlugin: a "@zanix/errors" import ssrLoadModule evaluates is the exact ' +
    'same, reference-identical HttpError class the native process already holds — never a ' +
    "second, Vite-transformed copy that makes a page's own `e instanceof HttpError` check false " +
    'for an HttpError thrown by a natively-resolved package (e.g. @zanix/auth) internals.',
  async () => {
    const root = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      await Deno.writeTextFile(
        join(root, 'probe-errors.ts'),
        `export { HttpError } from '@zanix/errors'\n`,
      )

      const engine = await createSpaceDevEngine({ root, isRouteEntry })
      try {
        const mod = await engine.ssrLoadModule('/probe-errors.ts') as {
          HttpError: typeof HttpError
        }

        assert(
          mod.HttpError === HttpError,
          'ssrLoadModule\'s own "@zanix/errors" import must resolve to the exact native ' +
            'HttpError class (===), not a structurally-identical but reference-different ' +
            'duplicate — a second copy is exactly what makes `e instanceof HttpError` false for ' +
            "an error thrown from a natively-resolved package's own internals (e.g. " +
            "@zanix/auth), even though the thrown object's serialized shape (name/status/code) " +
            'is identical.',
        )

        // A real cross-copy instanceof check, mirroring the actual bug shape: an HttpError
        // constructed under the SSR-side evaluation must still be `instanceof` the NATIVE
        // HttpError class, and vice versa — proving both sides now share one class object, not
        // just that the module namespace re-exports the same binding text.
        const ssrError = new mod.HttpError('FORBIDDEN', { code: 'INVALID_TOTP' })
        assert(
          ssrError instanceof HttpError,
          'an HttpError constructed through the SSR-loaded module must be `instanceof` the ' +
            "native HttpError class — the exact check a page's own `catch (e) { if (e " +
            'instanceof HttpError...) }` performs.',
        )
      } finally {
        await engine.close()
      }
    } finally {
      await Deno.remove(root, { recursive: true })
    }
  },
)
