import { assertEquals } from '@std/assert'
import { toDenoSpecifier } from '@deno/vite-plugin/resolver'
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
      const evaluator = new RealImportEvaluator(dir)
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
      const evaluator = new RealImportEvaluator(dir)
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
      const evaluator = new RealImportEvaluator(dir)
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
