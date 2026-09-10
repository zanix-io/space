import { assert, assertEquals } from '@std/assert'
import { join } from '@std/path'
import { toDenoSpecifier } from '@deno/vite-plugin/resolver'
import { HttpError } from '@zanix/errors'
import { getTemporaryFolder } from '@zanix/helpers'
import { RealImportEvaluator } from 'modules/bundler/ssr-module-evaluator.ts'
import type { EvaluatedModuleNode, ModuleRunnerContext } from 'vite/module-runner'

const TMP_ROOT = getTemporaryFolder(import.meta.url)

/** A minimal, real `ModuleRunnerContext` — every key `runInlinedModule`'s own generated
 * `__run__` wrapper actually destructures, plus a starting `__vite_ssr_import_meta__.url` this
 * suite mutates directly to observe whether `runInlinedModule` corrects it. */
function makeContext(initialMetaUrl: string): ModuleRunnerContext {
  return {
    __vite_ssr_exports__: {},
    __vite_ssr_import_meta__: {
      url: initialMetaUrl,
      env: {},
      dirname: '',
      filename: '',
      glob: () => ({}),
      resolve: (specifier: string) => specifier,
    },
    __vite_ssr_import__: () => Promise.resolve({}),
    __vite_ssr_dynamic_import__: () => Promise.resolve({}),
    __vite_ssr_exportAll__: () => {},
    __vite_ssr_exportName__: () => {},
    // deno-lint-ignore no-explicit-any
  } as any
}

/** A minimal `EvaluatedModuleNode` stand-in — `runInlinedModule`'s own fix only ever reads `.id`. */
function makeModule(id: string): Readonly<EvaluatedModuleNode> {
  return { id } as Readonly<EvaluatedModuleNode>
}

Deno.test(
  'runInlinedModule: corrects import.meta.url for a module reached through a REMOTE Deno ' +
    "specifier — the real, reproduced bug: Vite's own module runner mangles a wrapped " +
    "`deno::<loader>::<id>::<resolved>#deno` id's embedded `https://` down to `https:/` (a POSIX " +
    "path.resolve-style normalizer collapsing consecutive slashes), which this framework's own " +
    'resolveCometModuleUrl (comet-manifest.ts) never recognizes as a real URL — this is the exact ' +
    "corruption a third-party package's own ready-made Comet (e.g. @zanix/space-ui's NavDrawer, " +
    "never one of @zanix/space's own, which are diverted to a genuine native import() instead) hit " +
    'in zanix space dev',
  async () => {
    const dir = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      const evaluator = new RealImportEvaluator(dir, dir)
      const realResolvedUrl =
        'https://jsr.io/@zanix/space-ui/2.0.0/src/components/NavDrawer/index.ts'
      const wrappedId = toDenoSpecifier('TSX', realResolvedUrl, realResolvedUrl)

      // Stands in for the ALREADY-MANGLED value Vite's own module runner would have computed for
      // `context[ssrImportMetaKey].url` before ever reaching this evaluator — this suite doesn't
      // need to reproduce Vite's own path-normalization bug to prove the FIX; it only needs to
      // confirm `runInlinedModule` overwrites whatever was there with the real, un-mangled value
      // recovered from `module.id` whenever `module.id` is a genuine remote Deno specifier.
      const mangledMetaUrl =
        'file:///project/%00deno::TypeScript::https:/jsr.io/@zanix/space-ui/2.0.0/src/components/NavDrawer/index.ts::https:/jsr.io/@zanix/space-ui/2.0.0/src/components/NavDrawer/index.ts'
      const context = makeContext(mangledMetaUrl)

      await evaluator.runInlinedModule(
        context,
        '__vite_ssr_exports__.metaUrl = __vite_ssr_import_meta__.url',
        makeModule(wrappedId),
      )

      assertEquals(
        // deno-lint-ignore no-explicit-any
        (context as any).__vite_ssr_exports__.metaUrl,
        realResolvedUrl,
      )
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
)

Deno.test(
  'runInlinedModule: an ordinary local file (module.id is not a Deno specifier at all) leaves ' +
    'import.meta.url completely untouched — the common case, unaffected by this fix',
  async () => {
    const dir = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      const evaluator = new RealImportEvaluator(dir, dir)
      const localMetaUrl = 'file:///project/src/routes/page.tsx'
      const context = makeContext(localMetaUrl)

      await evaluator.runInlinedModule(
        context,
        '__vite_ssr_exports__.metaUrl = __vite_ssr_import_meta__.url',
        makeModule('/project/src/routes/page.tsx'),
      )

      assertEquals(
        // deno-lint-ignore no-explicit-any
        (context as any).__vite_ssr_exports__.metaUrl,
        localMetaUrl,
      )
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
)

Deno.test(
  'runInlinedModule: a Deno specifier that resolves to a LOCAL filesystem path (not a remote ' +
    'http(s) URL — e.g. a JSR package Deno already cached on disk) is left untouched too — only a ' +
    'genuinely remote resolution needs correcting',
  async () => {
    const dir = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      const evaluator = new RealImportEvaluator(dir, dir)
      const localMetaUrl = 'file:///project/%00deno::TypeScript::/some/cached/local/file.ts'
      const context = makeContext(localMetaUrl)
      const wrappedId = toDenoSpecifier(
        'TypeScript',
        '/some/cached/local/file.ts',
        '/some/cached/local/file.ts',
      )

      await evaluator.runInlinedModule(
        context,
        '__vite_ssr_exports__.metaUrl = __vite_ssr_import_meta__.url',
        makeModule(wrappedId),
      )

      assertEquals(
        // deno-lint-ignore no-explicit-any
        (context as any).__vite_ssr_exports__.metaUrl,
        localMetaUrl,
      )
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
)

Deno.test(
  "runExternalModule: a served project's own declared version wins over this package's own — " +
    'resolves `@zanix/errors` against the project root passed to the constructor, not this ' +
    "package's own `deno.jsonc` nor whatever the surrounding process happens to have cached",
  async () => {
    const dir = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      await Deno.writeTextFile(
        join(dir, 'deno.json'),
        JSON.stringify({ imports: { '@zanix/errors': 'jsr:@zanix/utils@4.0.0/errors' } }),
      )

      const evaluator = new RealImportEvaluator(dir, dir)
      const sentinel = `znxruntime://${encodeURIComponent('@zanix/errors')}`
      const mod = await evaluator.runExternalModule(sentinel) as { HttpError: typeof HttpError }

      assert(
        mod.HttpError !== HttpError,
        "expected the project's own pinned 4.0.0 HttpError, not this package's own",
      )
      assertEquals(new mod.HttpError('FORBIDDEN').name, 'HttpError')
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
)

Deno.test(
  'runExternalModule: resolves a bare npm-style SUBPATH the served project never itself declared ' +
    "— a real, confirmed regression: `@preact/preset-vite`'s own devtools sub-plugin injects " +
    '`import "preact/debug"` into a real route file on its own, so the project\'s `deno.json` has ' +
    'no reason to ever map that exact subpath (only the bare `preact` it actually imports itself). ' +
    "A plain `import(specifier)` resolves against THIS EVALUATOR's OWN module scope — a remote " +
    '`jsr.io` one in production, with no local `node_modules` to fall back to for a subpath ' +
    'nothing in that scope declares — confirmed empirically against the real published module to ' +
    'throw exactly `Import "preact/debug" not a dependency and not in import map`. Reproduced here ' +
    "with a synthetic, fully isolated fixture rather than the real `preact` package: `preact`'s " +
    'own `debug` entry further self-references `preact/devtools`, then bare `preact` itself, and ' +
    "Deno resolves a bare specifier only against whichever EXACT strings a process's own root " +
    'import map declares — no generic "any subpath of an already-declared package" fallback — so ' +
    'a fixture built on the real package ends up needing every one of those declared too, which ' +
    'defeats the very isolation this test needs (once `preact` itself is declared, a plain ' +
    "`import('preact/debug')` resolves fine independently of this fix, the same \"any subpath of " +
    'an already-declared package resolves" behavior — genuinely different from `import()` inside a ' +
    'remote `https://` module, which has no filesystem to walk at all). A one-file synthetic ' +
    'package with no further internal imports sidesteps that entirely while still exercising the ' +
    'identical mechanism: resolved through `getSharedLoader`/`resolveDenoAt` (rooted at the ' +
    "SERVED PROJECT, passed separately as this class's own `root` constructor argument), which " +
    "follows the served project's own declared `file:` mapping directly, independent of the " +
    "evaluator's own scope.",
  async () => {
    const projectDir = await Deno.makeTempDir({ dir: TMP_ROOT })
    // Deliberately OUTSIDE this repo (no ancestor `deno.json` to inherit anything from) — this is
    // what actually makes the subprocess below fail on a plain `import('preact/debug')` without
    // the fix, the same way the published package's own remote `jsr.io` scope does.
    const evaluatorHome = await Deno.makeTempDir()
    try {
      // The "served project" this evaluator resolves against — declares the LITERAL specifier
      // `runExternalModule`'s own `REQUIRES_LOADER_RESOLUTION` checks for (`preact/debug`), mapped
      // to a synthetic local fixture file rather than the real `preact` package — see this test's
      // own description above for why the real package can't be used here.
      const fixtureModule = join(projectDir, 'fixture-module.ts')
      await Deno.writeTextFile(fixtureModule, 'export function markerFn() { return true }\n')
      await Deno.writeTextFile(
        join(projectDir, 'deno.json'),
        JSON.stringify({ imports: { 'preact/debug': `file://${fixtureModule}` } }),
      )

      const sourceDir = new URL('../../../../src/modules/bundler/', import.meta.url)
      await Deno.writeTextFile(
        join(evaluatorHome, 'deno.json'),
        // Everything `ssr-module-evaluator.ts`'s own import graph genuinely needs to resolve and
        // typecheck — `preact/debug` deliberately absent, isolating this copy's own scope from
        // `projectDir`'s the same way a genuinely remote `jsr.io` module's own scope is isolated
        // from any one consumer's `node_modules` in production.
        JSON.stringify({
          imports: {
            '@std/path': 'jsr:@std/path@0.224',
            '@std/jsonc': 'jsr:@std/jsonc@1',
            '@deno/loader': 'jsr:@deno/loader@^0.5.0',
            '@deno/vite-plugin': 'npm:@deno/vite-plugin@^2.0.3',
            vite: 'npm:vite@^8.0.0',
          },
        }),
      )
      for (
        const file of [
          'ssr-module-evaluator.ts',
          'native-runtime-modules.ts',
          'deno-loader.ts',
          'deno-specifier-resolver.ts',
        ]
      ) {
        // deno-lint-ignore no-await-in-loop
        await Deno.copyFile(new URL(file, sourceDir), join(evaluatorHome, file))
      }
      await Deno.writeTextFile(
        join(evaluatorHome, 'run.ts'),
        [
          "import { RealImportEvaluator } from './ssr-module-evaluator.ts'",
          'const [tmpDir, projectDir] = Deno.args',
          'const evaluator = new RealImportEvaluator(tmpDir, projectDir)',
          "const sentinel = `znxruntime://${encodeURIComponent('preact/debug')}`",
          'try {',
          '  const mod = await evaluator.runExternalModule(sentinel) as { markerFn: unknown }',
          "  console.log('OK', typeof mod.markerFn)",
          '} catch (e) {',
          "  console.log('FAIL', (e as Error).message)",
          '}',
        ].join('\n'),
      )

      const command = new Deno.Command(Deno.execPath(), {
        args: ['run', '--allow-all', 'run.ts', evaluatorHome, projectDir],
        cwd: evaluatorHome,
        stdout: 'piped',
        stderr: 'piped',
      })
      const { stdout, stderr } = await command.output()
      const output = new TextDecoder().decode(stdout).trim()
      assertEquals(
        output,
        'OK function',
        `subprocess output: ${output || '(empty)'}\nstderr: ${new TextDecoder().decode(stderr)}`,
      )
    } finally {
      await Deno.remove(projectDir, { recursive: true })
      await Deno.remove(evaluatorHome, { recursive: true })
    }
  },
)
