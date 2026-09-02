import { assert, assertEquals, assertRejects } from '@std/assert'
import { join } from '@std/path'
import { getTemporaryFolder } from '@zanix/helpers'
import { BaseRTO, classMetadata, classValidation, IsString } from '@zanix/validator'
import { createSpaceDevEngine } from 'modules/bundler/dev-engine.ts'

const TMP_ROOT = getTemporaryFolder(import.meta.url)
const isRouteEntry = (id: string) => id.endsWith('/page.tsx') || id.endsWith('page.tsx')

/**
 * `@zanix/validator` (`@zanix/utils`'s validator subpath, aliased in every `zanix
 * new`-scaffolded project's own `deno.jsonc`, exactly as this package's own top-level `imports`
 * block aliases it too) is NOT on `NATIVE_RUNTIME_MODULES` — a real consumer's RTO file (e.g.
 * `console`'s own `create-trigger-form.rto.ts`) bare-imports it directly, reached through
 * `ssrLoadModule` exactly like a `@Guard` file reaches `'@zanix/auth'`. This test pins that
 * `classValidation` survives the resulting split anyway, unlike `@zanix/auth`'s own DI container:
 * `@zanix/server`'s real `validation.pipe.ts` bare-imports `'@zanix/validator'` itself (always
 * resolving natively, since `@zanix/server` is loaded via a real native `import()`, never through
 * Vite), and the RTO class it validates here is decorated by the SSR-side (Vite-transformed) copy
 * of `IsString`/`BaseRTO` instead — the same shape `create-trigger-form.rto.ts` and
 * `validation.pipe.ts` form together in a real `zanix space dev` session.
 *
 * The reason it survives: `defineValidationDecorator` (`@zanix/utils`'s `base/definitions/
 * decorators.ts`) closure-captures each field's own validation function directly onto the
 * accessor's `set`/`init` hooks at class-definition time — real ECMAScript native accessor
 * decorators, not a lookup through any cross-module registry keyed by class reference. Which
 * module evaluation of `@zanix/validator` applied the decorator plays no role in what the
 * accessor itself enforces at assignment time.
 */
Deno.test(
  'classValidation enforces a required @IsString field correctly even when the decorator that ' +
    'declared it comes from a separate SSR-side "@zanix/validator" module evaluation — the ' +
    'closure-based mechanism above, not module identity, is what classValidation actually ' +
    'depends on.',
  async () => {
    const root = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      await Deno.writeTextFile(
        join(root, 'probe-rto.ts'),
        [
          "import { BaseRTO, IsString } from '@zanix/validator'",
          '',
          'export class ProbeRTO extends BaseRTO {',
          '  @IsString({ expose: true })',
          '  accessor requiredField!: string',
          '}',
          '',
        ].join('\n'),
      )

      const engine = await createSpaceDevEngine({ root, isRouteEntry })
      try {
        const mod = await engine.ssrLoadModule('/probe-rto.ts') as { ProbeRTO: typeof BaseRTO }

        // Establishes the identity split itself, exactly like the `@zanix/auth` test does — the
        // assertion below only means something once this one holds.
        assert(
          mod.ProbeRTO !== BaseRTO,
          'sanity check: the SSR-loaded class must be a genuinely different evaluation than this ' +
            "test file's own native BaseRTO import — if Vite ever starts externalizing " +
            '@zanix/validator on its own, this assertion (not the one below) is what would start ' +
            'failing.',
        )

        // The native classValidation still enforces the constraint the SSR-side decorator
        // registered — submitting an object with the required field missing.
        await assertRejects(
          // deno-lint-ignore no-explicit-any
          () => classValidation(mod.ProbeRTO as any, {}),
          Error,
          undefined,
          'classValidation rejects a payload missing a required @IsString field regardless of ' +
            "which module copy's decorator registered that constraint — a passing assertion here " +
            "confirms the mechanism this test's own doc describes.",
        )
      } finally {
        await engine.close()
      }
    } finally {
      await Deno.remove(root, { recursive: true })
    }
  },
)

/**
 * `classMetadata` (static introspection: which decorator each field carries, for an OpenAPI
 * generator or a form/table renderer) does NOT share `classValidation`'s closure-based immunity
 * above — it reads `class-fields.ts`'s own `RTO_FIELDS_KEY = Symbol('zanix:rto-fields')`, a LOCAL
 * symbol re-created on every module evaluation (unlike a well-known symbol such as
 * `Symbol.metadata` itself, or a `Symbol.for()` global-registry symbol). The SSR-side decorator
 * writes field metadata under the SSR-side's own key; a native `classMetadata` call reads under a
 * different one, finding nothing. This surface never reaches request-handling — nothing in
 * `@zanix/server`'s own pipeline calls `classMetadata` — so it stays a real but narrow gap.
 */
Deno.test(
  'classMetadata loses field metadata for a class decorated through a separate SSR-side ' +
    '"@zanix/validator" module evaluation — a narrower, lower-severity gap than classValidation, ' +
    'which the test above confirms is unaffected.',
  async () => {
    const root = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      await Deno.writeTextFile(
        join(root, 'probe-rto-2.ts'),
        [
          "import { BaseRTO, IsString } from '@zanix/validator'",
          '',
          'export class ProbeRTO extends BaseRTO {',
          '  @IsString({ expose: true })',
          '  accessor requiredField!: string',
          '}',
          '',
        ].join('\n'),
      )

      const engine = await createSpaceDevEngine({ root, isRouteEntry })
      try {
        const mod = await engine.ssrLoadModule('/probe-rto-2.ts') as { ProbeRTO: typeof BaseRTO }
        // deno-lint-ignore no-explicit-any
        const metadata = classMetadata(mod.ProbeRTO as any)
        assertEquals(
          metadata,
          {},
          'classMetadata returns an empty registry for a class decorated through a separate ' +
            "module evaluation — this test's own doc explains why.",
        )
      } finally {
        await engine.close()
      }
    } finally {
      await Deno.remove(root, { recursive: true })
    }
  },
)

/** Control case: the exact same class, defined and decorated natively (no Vite/ssrLoadModule
 * involved at all) — proves `classValidation`/`IsString`/`BaseRTO` work correctly on their own,
 * so the split-specific assertions above isolate the identity split itself, never a bug in the
 * validator package or a mistake in how the probe class is written. */
Deno.test(
  'control: the same required @IsString accessor IS correctly rejected when both the decorator ' +
    'and classValidation come from the same (native) module instance',
  async () => {
    class ControlRTO extends BaseRTO {
      @IsString({ expose: true })
      accessor requiredField!: string
    }

    await assertRejects(() => classValidation(ControlRTO, {}))
  },
)
