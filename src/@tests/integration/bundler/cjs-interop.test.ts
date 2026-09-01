import { assert, assertEquals, assertFalse } from '@std/assert'
import { join, toFileUrl } from '@std/path'
import { getTemporaryFolder } from '@zanix/helpers'
import type { LoadContext } from '@deno/vite-plugin'
import { denoOnLoadCjsInterop, wrapCjsIfNeeded } from 'modules/bundler/cjs-interop.ts'

const TMP_ROOT = getTemporaryFolder(import.meta.url)

async function withTempProject(
  files: Record<string, string>,
  run: (root: string) => Promise<void>,
): Promise<void> {
  const root = await Deno.makeTempDir({ dir: TMP_ROOT })
  try {
    await Promise.all(
      Object.entries(files).map(([name, content]) => Deno.writeTextFile(join(root, name), content)),
    )
    await run(root)
  } finally {
    await Deno.remove(root, { recursive: true })
  }
}

function fileUrlFor(root: string, name: string): string {
  return toFileUrl(join(root, name)).href
}

// `maskComments`'s own doc (`cjs-interop.ts`) describes several confirmed-real false
// positive/negative shapes for its comment-detection heuristic. None of them were ever exercised
// by the real-React regression suite in `dev-engine.test.ts` — that suite only ever reaches
// whatever comment/string/template/regex shapes react's own real source happens to contain, not
// every shape the heuristic itself has to handle. Each test below reproduces one shape directly.

Deno.test(
  'wrapCjsIfNeeded: an escaped quote inside a string does not end the string early, so a real ' +
    'require() sharing its line is never swallowed by a false "// comment"',
  async () => {
    await withTempProject(
      {
        'real-dep.js': `module.exports = 'REAL_DEP_VALUE'\n`,
        'entry.js':
          `const s = "a\\" // not a real comment"; require('./real-dep')\nmodule.exports = s\n`,
      },
      async (root) => {
        const entryId = fileUrlFor(root, 'entry.js')
        const code = await Deno.readTextFile(join(root, 'entry.js'))
        const result = await wrapCjsIfNeeded(code, entryId, root)
        assert(result, 'expected a real CJS bundle')
        // If the escaped quote were mishandled, the string would be read as closing early, the
        // trailing `// not a real comment"` text would be (mis)treated as a real line comment,
        // and everything after it on that same line — including `require('./real-dep')` — would
        // never be discovered as a dependency, so `real-dep.js`'s own factory would never be
        // bundled at all.
        assert(
          result.code.includes('REAL_DEP_VALUE'),
          `expected real-dep.js to be bundled, got: ${result.code}`,
        )
        assertFalse(
          result.code.includes("require('./real-dep')"),
          'the require() call must be rewritten to __cjsRequire__, never left untouched',
        )
      },
    )
  },
)

Deno.test(
  "wrapCjsIfNeeded: a comment written only inside a template literal's ${...} hole is masked, " +
    'never recorded as a real dependency — while a real require() elsewhere still is',
  async () => {
    await withTempProject(
      {
        'real-dep-2.js': `module.exports = 'REAL_DEP_2_VALUE'\n`,
        'entry.js': [
          "const label = `price: \\$ ${/* require('./sneaky-dep') */ ({a:1}).a}`",
          "module.exports = { label, dep: require('./real-dep-2') }",
          '',
        ].join('\n'),
      },
      async (root) => {
        const entryId = fileUrlFor(root, 'entry.js')
        const code = await Deno.readTextFile(join(root, 'entry.js'))
        const result = await wrapCjsIfNeeded(code, entryId, root)
        assert(result, 'expected a real CJS bundle')
        // The comment's own raw text (including the literal `require('./sneaky-dep')` inside it)
        // reaches the rewritten output completely untouched, same as any other comment — masking
        // only ever decides what counts as a real dependency to resolve/bundle, never strips
        // comment text from the output. The real assertion is that `./sneaky-dep` was never
        // RESOLVED into its own factory: exactly two factories exist (the entry and real-dep-2),
        // never a third one for the commented-out require.
        const factoryCount =
          (result.code.match(/function __cjsFactory_\d+__\(module, exports\)/g) ?? []).length
        assertEquals(
          factoryCount,
          2,
          `a require() written only inside a comment must never be resolved into its own ` +
            `factory, got ${factoryCount} factories in: ${result.code}`,
        )
        assert(
          result.code.includes('REAL_DEP_2_VALUE'),
          `expected real-dep-2.js to still be bundled correctly, got: ${result.code}`,
        )
      },
    )
  },
)

Deno.test(
  "wrapCjsIfNeeded: a regex literal's own escaped slash, and its own character class, are never " +
    'misread as ending the regex or starting a "// comment" that swallows a real require()',
  async () => {
    await withTempProject(
      {
        'real-dep-3a.js': `module.exports = 'REAL_DEP_3A_VALUE'\n`,
        'entry.js': `const re = /[a-z]+:\\/\\//gi; require('./real-dep-3a')\nmodule.exports = re\n`,
      },
      async (root) => {
        const entryId = fileUrlFor(root, 'entry.js')
        const code = await Deno.readTextFile(join(root, 'entry.js'))
        const result = await wrapCjsIfNeeded(code, entryId, root)
        assert(result, 'expected a real CJS bundle')
        // If the regex literal's own escaped `/` were not tracked, the two adjacent,
        // unescaped-looking `/` characters right before the real closing delimiter would be
        // misread as starting a `//` line comment, masking away the rest of the line — including
        // the real `require('./real-dep-3a')` call sharing it. `[a-z]` (a `/` inside a character
        // class never closes the regex either) and the trailing `gi` flags exercise the rest of
        // the same detector.
        assert(
          result.code.includes('REAL_DEP_3A_VALUE'),
          `expected real-dep-3a.js to be bundled, got: ${result.code}`,
        )
      },
    )
  },
)

Deno.test(
  'wrapCjsIfNeeded: a "/" that looks like it could open a regex literal but never actually ' +
    'closes on the same line is left alone (treated as plain text), and scanning still finds a ' +
    'real require() on the next line',
  async () => {
    await withTempProject(
      {
        'real-dep-3b.js': `module.exports = 'REAL_DEP_3B_VALUE'\n`,
        'entry.js':
          `const notRegex = /unterminated\nrequire('./real-dep-3b')\nmodule.exports = notRegex\n`,
      },
      async (root) => {
        const entryId = fileUrlFor(root, 'entry.js')
        const code = await Deno.readTextFile(join(root, 'entry.js'))
        const result = await wrapCjsIfNeeded(code, entryId, root)
        assert(result, 'expected a real CJS bundle')
        assert(
          result.code.includes('REAL_DEP_3B_VALUE'),
          `expected real-dep-3b.js to still be bundled after the abandoned regex attempt, got: ${result.code}`,
        )
      },
    )
  },
)

Deno.test(
  'wrapCjsIfNeeded: recursively resolves and bundles a relative require subtree, and a shared ' +
    'dependency required by two different files is only ever bundled once',
  async () => {
    await withTempProject(
      {
        'shared.js': `module.exports = 'SHARED_VALUE'\n`,
        'a.js': `module.exports = require('./shared')\n`,
        'b.js': `module.exports = require('./shared')\n`,
        'entry.js':
          `const a = require('./a')\nconst b = require('./b')\nmodule.exports = { a, b }\n`,
      },
      async (root) => {
        const entryId = fileUrlFor(root, 'entry.js')
        const code = await Deno.readTextFile(join(root, 'entry.js'))
        const result = await wrapCjsIfNeeded(code, entryId, root)
        assert(result, 'expected a real CJS bundle')
        const occurrences = result.code.match(/SHARED_VALUE/g) ?? []
        assertEquals(
          occurrences.length,
          1,
          `expected shared.js's own factory to be bundled exactly once (the same-file visiting ` +
            `guard), got ${occurrences.length} occurrences in: ${result.code}`,
        )
      },
    )
  },
)

Deno.test(
  "wrapCjsIfNeeded: a relatively-required .json file (require('../package.json'), the real shape " +
    "mongoose's own lib/mongoose.js uses) is wrapped as a real assignment, never as raw JSON text " +
    'sitting in statement position',
  async () => {
    await withTempProject(
      {
        'package.json': `{\n  "name": "fake-pkg",\n  "version": "1.2.3"\n}\n`,
        'entry.js': `const pkg = require('./package.json')\nmodule.exports = pkg.version\n`,
      },
      async (root) => {
        const entryId = fileUrlFor(root, 'entry.js')
        const code = await Deno.readTextFile(join(root, 'entry.js'))
        const result = await wrapCjsIfNeeded(code, entryId, root)
        assert(result, 'expected a real CJS bundle')
        // The real bug this locks in: before the fix, a required `.json` file's raw content was
        // wrapped as `function(module, exports) {\nconst require = __cjsRequire__\n{"name": ...}\n}`
        // — a bare object literal in statement position, right after a `const` declaration with no
        // separator between them. `new Function` is the actual proof that matters: a real syntax
        // error there throws here too, the same way it crashed a real `zanix space dev` run against
        // mongoose. `export {}` (ESM syntax) is stripped first since `new Function` parses as a
        // plain script, not a module.
        const script = result.code.replace('export {}', '')
        const parses = () => new Function(script)
        parses() // throws SyntaxError if the bug regresses — the actual assertion.
        assert(
          result.code.includes('module.exports = {'),
          `expected the .json file's factory to assign its content, got: ${result.code}`,
        )
      },
    )
  },
)

Deno.test(
  'wrapCjsIfNeeded: a bare require() for a genuinely OPTIONAL native dependency that fails to ' +
    "resolve at all at runtime (mongoose's own real require('kerberos') shape, always wrapped in " +
    "its own try/catch) does not crash the whole bundle's top-level evaluation — the ORIGINAL " +
    'try/catch still catches it, since the failure is deferred to the exact __bareRequire__() ' +
    'call site the require() text was rewritten to, inside whatever try/catch already wraps it',
  async () => {
    await withTempProject(
      {
        'entry.js': [
          'let hasOptionalDep',
          'try {',
          "  hasOptionalDep = !!require('missing-optional-native-dep')",
          '} catch (e) {',
          '  hasOptionalDep = false',
          '}',
          'module.exports = { hasOptionalDep }',
          '',
        ].join('\n'),
      },
      async (root) => {
        const entryId = fileUrlFor(root, 'entry.js')
        const code = await Deno.readTextFile(join(root, 'entry.js'))
        const result = await wrapCjsIfNeeded(code, entryId, root)
        assert(result, 'expected a real CJS bundle')

        // Real EXECUTION, not just a syntax check (unlike the .json test above) — the property
        // under test is runtime behavior, not parseability. Mocks `__vite_ssr_import__` to reject
        // exactly the way a genuinely-missing npm package would at real runtime, wraps the bundle
        // body in an async IIFE (the same shape `RealImportEvaluator.runInlinedModule`'s own
        // production wrapping uses, just inlined here instead of written to a temp `.ts` file), and
        // confirms the WHOLE bundle's own top-level evaluation completes successfully: a rejected
        // `await __vite_ssr_import__(...)` at this bundle's own top level must never throw straight
        // out of this `run(...)` call without ever reaching the ORIGINAL `try/catch` this test's
        // own fixture wrote around its `require(...)` call.
        const script = result.code.replace('export {}', '')
        const exportedNames: string[] = []
        const exportedGetters: Record<string, () => unknown> = {}
        const run = new Function(
          '__vite_ssr_import__',
          '__vite_ssr_exportName__',
          `return (async () => {\n${script}\n})()`,
        )
        await run(
          (spec: string) => Promise.reject(new Error(`Cannot find module '${spec}'`)),
          (name: string, getter: () => unknown) => {
            exportedNames.push(name)
            exportedGetters[name] = getter
          },
        )
        assert(
          exportedNames.includes('hasOptionalDep'),
          `expected a real export from the completed bundle, got: ${result.code}`,
        )
        assertEquals(
          exportedGetters.hasOptionalDep(),
          false,
          "expected the ORIGINAL catch block's own fallback value, proving the deferred error " +
            'was caught exactly where the source code already expected it to be',
        )
      },
    )
  },
)

Deno.test(
  'denoOnLoadCjsInterop: returns null outside the ssr environment, without ever calling wrapCjsIfNeeded',
  async () => {
    await withTempProject({}, async (root) => {
      const onLoad = denoOnLoadCjsInterop(root)
      const result = await onLoad({
        code: `module.exports = 1\n`,
        id: fileUrlFor(root, 'client-only.js'),
        ssr: false,
      } as unknown as LoadContext)
      assertEquals(result, null)
    })
  },
)

Deno.test(
  'denoOnLoadCjsInterop: delegates to wrapCjsIfNeeded for a real ssr-environment CJS module',
  async () => {
    await withTempProject(
      { 'entry.js': `module.exports = 'SSR_DELEGATE_VALUE'\n` },
      async (root) => {
        const onLoad = denoOnLoadCjsInterop(root)
        const code = await Deno.readTextFile(join(root, 'entry.js'))
        const result = await onLoad({
          code,
          id: fileUrlFor(root, 'entry.js'),
          ssr: true,
        } as unknown as LoadContext)
        assert(result, 'expected wrapCjsIfNeeded to produce a real bundle')
        assert(result.code.includes('SSR_DELEGATE_VALUE'))
      },
    )
  },
)

// The three regression tests below reproduce the exact real, confirmed shape of TWO genuine
// `zanix space dev` crashes (`console`/`mongoose`/`mongodb`, 2026-08-31), both the same underlying
// cause: a package's own CJS source `require()`s something in a DIFFERENT package that the
// CONSUMING project's own top-level import map never declares directly — only transitively, the
// same way `console` never declares `mongodb` itself, only through `mongoose`. Confirmed for BOTH
// shapes real `mongoose` source takes: a SUBPATH into `mongodb`'s internals
// (`require('mongodb/lib/bulk/common')`) AND `mongodb`'s own bare PACKAGE ROOT
// (`require('mongodb')`) — an earlier fix version only caught the first, gated on whether the
// specifier had a subpath at all, a narrower heuristic than the real distinction (see
// `bareSpecifierResolvesAtTopLevel`'s own doc in `cjs-interop.ts`). `resolveBareSpecifierCanonically`
// (`bare-specifier-resolve.ts`) only ever resolves a bare specifier WITHOUT a real referrer for any
// `node_modules`-rooted importer (deliberate, for an unrelated module-identity asymmetry — see that
// file's own doc) — which fails outright for anything the consuming project's own top-level import
// map doesn't declare directly, falling back to Vite's own SSR "bare string + known importer" fast
// path, which resolves it as an EXTERNAL module, entirely bypassing this file's own CJS wrapping —
// the real, confirmed cause of `ReferenceError: exports is not defined`. Own temp `deno.json` (not
// `withTempProject`'s flat, config-less files) since real import-map `imports`/`scopes` entries are
// what this fix's own detection needs to resolve through — `scopes`, not a top-level `imports`
// entry, is what reproduces "resolvable only relative to the requiring package's own directory,
// never from the consuming project's own top level" faithfully: a plain top-level `imports` entry
// (an EXACT-match key, not a package with real subpath expansion) resolves identically with or
// without a referrer, so it can't reproduce the asymmetry this fix closes at all.
async function withTempConfiguredProject(
  files: Record<string, string>,
  imports: Record<string, string>,
  run: (root: string) => Promise<void>,
  scopes?: Record<string, Record<string, string>>,
): Promise<void> {
  const root = await Deno.makeTempDir({ dir: TMP_ROOT })
  try {
    const config: Record<string, unknown> = { imports }
    if (scopes) config.scopes = scopes
    await Deno.writeTextFile(join(root, 'deno.json'), JSON.stringify(config))
    await Promise.all(
      Object.entries(files).map(async ([name, content]) => {
        const filePath = join(root, name)
        await Deno.mkdir(join(filePath, '..'), { recursive: true })
        await Deno.writeTextFile(filePath, content)
      }),
    )
    await run(root)
  } finally {
    await Deno.remove(root, { recursive: true })
  }
}

Deno.test(
  'wrapCjsIfNeeded: a bare require() with a SUBPATH into another package, resolvable only via a ' +
    "SCOPED entry relative to the requiring file's own directory — never the consuming project's " +
    "own top level (mongoose's own real require('mongodb/lib/bulk/common') shape) — is inlined " +
    'exactly like a relative require, never left on the __bareRequire__/__vite_ssr_import__ ' +
    'external path',
  async () => {
    await withTempConfiguredProject(
      {
        'heavy-pkg/index.js': `module.exports = 'HEAVY_PKG_ROOT'\n`,
        'heavy-pkg/lib/deep.js': `module.exports = 'HEAVY_PKG_SUBPATH_VALUE'\n`,
        // Lives INSIDE heavy-pkg's own directory — mirroring mongoose's own
        // lib/drivers/node-mongodb-native/bulkWriteResult.js requiring straight into mongodb's own
        // internals, never the consuming project's own top-level source.
        'heavy-pkg/entry.js': `module.exports = require('heavy-pkg/lib/deep')\n`,
      },
      // Deliberately does NOT declare 'heavy-pkg/lib/deep' here — only the scope below does.
      { 'heavy-pkg': './heavy-pkg/index.js' },
      async (root) => {
        const entryId = fileUrlFor(root, 'heavy-pkg/entry.js')
        const code = await Deno.readTextFile(join(root, 'heavy-pkg/entry.js'))
        const result = await wrapCjsIfNeeded(code, entryId, root)
        assert(result, 'expected a real CJS bundle')
        assert(
          result.code.includes('HEAVY_PKG_SUBPATH_VALUE'),
          `expected the subpath's own factory to be inlined, got: ${result.code}`,
        )
        assertFalse(
          result.code.includes('__vite_ssr_import__("heavy-pkg/lib/deep"'),
          'a subpath require must never reach the external __vite_ssr_import__ path — that path ' +
            'is exactly what reaches Vite\'s "bare string + known importer" fast path and ' +
            `externalizes the module instead of wrapping it, got: ${result.code}`,
        )
        assertFalse(
          result.code.includes('__bareRequire__("heavy-pkg/lib/deep")'),
          `expected __cjsRequire__ (inlined), never __bareRequire__, got: ${result.code}`,
        )
      },
      // Scoped to heavy-pkg's own directory — resolvable ONLY relative to a referrer that falls
      // under this prefix, never from the top-level `imports` map above (confirms the fix's real
      // criterion is "resolves with a referrer", not merely "has a subpath").
      { './heavy-pkg/': { 'heavy-pkg/lib/deep': './heavy-pkg/lib/deep.js' } },
    )
  },
)

Deno.test(
  "wrapCjsIfNeeded: a bare require() of ANOTHER package's own PUBLIC ROOT (no subpath), " +
    "resolvable only via a SCOPED entry relative to the requiring file's own directory — never " +
    "the consuming project's own top level (mongoose's own real require('mongodb') shape, " +
    'confirmed to crash identically to the subpath case above) — is ALSO inlined, never left on ' +
    'the external path. The earlier, narrower "has a subpath" heuristic missed this exact case.',
  async () => {
    await withTempConfiguredProject(
      {
        'other-pkg/index.js': `module.exports = 'OTHER_PKG_ROOT_VALUE'\n`,
        // Lives INSIDE heavy-pkg's own directory, same shape as the subpath test above — mirroring
        // mongoose's own source requiring mongodb's bare package root, never declared at
        // console's own top level either.
        'heavy-pkg/entry.js': `module.exports = require('other-pkg')\n`,
      },
      // Deliberately does NOT declare 'other-pkg' here — only the scope below does.
      {},
      async (root) => {
        const entryId = fileUrlFor(root, 'heavy-pkg/entry.js')
        const code = await Deno.readTextFile(join(root, 'heavy-pkg/entry.js'))
        const result = await wrapCjsIfNeeded(code, entryId, root)
        assert(result, 'expected a real CJS bundle')
        assert(
          result.code.includes('OTHER_PKG_ROOT_VALUE'),
          `expected other-pkg's own root factory to be inlined, got: ${result.code}`,
        )
        assertFalse(
          result.code.includes('__vite_ssr_import__("other-pkg"'),
          'a bare root require unreachable from the top-level import map must never reach the ' +
            `external __vite_ssr_import__ path, got: ${result.code}`,
        )
        assertFalse(
          result.code.includes('__bareRequire__("other-pkg")'),
          `expected __cjsRequire__ (inlined), never __bareRequire__, got: ${result.code}`,
        )
      },
      { './heavy-pkg/': { 'other-pkg': './other-pkg/index.js' } },
    )
  },
)

Deno.test(
  "wrapCjsIfNeeded: a bare require() of a package's own PUBLIC ROOT that DOES resolve via the " +
    "consuming project's own TOP-LEVEL import map (a real, independently-declared dependency, " +
    "the react/react-dom singleton shape this file's own header doc describes) still goes " +
    'through the external __bareRequire__/__vite_ssr_import__ path unchanged — inlining it would ' +
    "duplicate the module instance a page's own top-level import of the same package already " +
    'holds.',
  async () => {
    await withTempConfiguredProject(
      {
        'heavy-pkg/index.js': `module.exports = 'HEAVY_PKG_ROOT'\n`,
        'entry.js': `module.exports = require('heavy-pkg')\n`,
      },
      { 'heavy-pkg': './heavy-pkg/index.js' },
      async (root) => {
        const entryId = fileUrlFor(root, 'entry.js')
        const code = await Deno.readTextFile(join(root, 'entry.js'))
        const result = await wrapCjsIfNeeded(code, entryId, root)
        assert(result, 'expected a real CJS bundle')
        assert(
          result.code.includes('__bareRequire__("heavy-pkg")'),
          `expected the package's own root require to stay external (__bareRequire__), got: ${result.code}`,
        )
      },
    )
  },
)
