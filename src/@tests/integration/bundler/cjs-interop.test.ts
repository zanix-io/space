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
