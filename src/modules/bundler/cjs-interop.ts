import { type Loader, RequestedModuleType, ResolutionMode } from '@deno/loader'
import type { Plugin } from 'vite'
import type { LoadContext, OnLoadResult } from '@deno/vite-plugin'
import { getSharedLoader } from './deno-loader.ts'
import { resolveBareSpecifierCanonically } from './bare-specifier-resolve.ts'

/**
 * Fixes a `zanix space dev` blocker that is entirely separate from {@linkcode RealImportEvaluator}'s
 * own decorator fix (`ssr-module-evaluator.ts`): `react` and `react-dom` are CommonJS at their real
 * npm entry files, and Vite's SSR pipeline never transforms CJS to ESM on its own — reproducible
 * with Vite's own untouched default evaluator too, so this is a pre-existing Vite/CJS gap, not
 * something this package's own pipeline introduces. Left unfixed, this blocks the one case
 * `zanix space dev` structurally can't avoid: a real JSX + React page.
 *
 * This module owns none of the module graph, resolution/invalidation, or HMR — those stay
 * entirely Vite's/`@deno/vite-plugin`'s own. It only ever rewrites a single module's own
 * transformed source text, the same shape as any other Vite `transform` hook.
 *
 * ## Why the CJS subtree is bundled by hand, not routed through Vite's own module graph
 *
 * A relative `require('./foo')` inside a CJS file cannot simply be resolved to an absolute path
 * and left for Vite to load on its own: an absolute, already-resolved path is treated by
 * `@deno/vite-plugin`'s own internal routing as "inside project root, already resolved" and read
 * through Vite's native filesystem loader instead of this plugin's own `onLoad`
 * — the sub-file's raw, un-transformed CJS content would reach the evaluator unprocessed. Nor can
 * the sub-request be routed by re-encoding `@deno/vite-plugin`'s own private virtual-id scheme
 * (`\0deno::...#deno`) — that format is undocumented, internal, and not guaranteed stable across
 * dot releases.
 *
 * The fix instead resolves and loads the ENTIRE relative-require subtree up front, directly via
 * `@deno/loader`'s own public `Workspace`/`Loader` API (the same resolver `@deno/vite-plugin` uses
 * internally, just invoked directly here — via `deno-loader.ts`'s shared instance), and inlines it
 * as a single, self-contained synchronous CJS runtime — the same shape as webpack/browserify's own
 * hand-built `__require`. Only a BARE specifier (`require('react')` from inside `react-dom`'s own
 * code) still goes through Vite's real module graph (via `__vite_ssr_import__`), which is what
 * preserves the React singleton — Vite dedupes by resolved id, not by original specifier string, so
 * a module already loaded through the page's own `import 'react'` is reused, never duplicated —
 * PROVIDED both resolve to the same id in the first place, which is
 * {@linkcode bare-specifier-resolve.ts!canonicalBareSpecifierResolvePlugin}'s own job, not this
 * file's (see that file's own doc for the identity bug it fixes).
 *
 * ## Why every factory function — and the top-level bare-specifier fetch — must stay synchronous
 *
 * Every CJS factory function must stay synchronous. Making a factory `async` so it could
 * `await __cjsRequire__(...)`/`await __vite_ssr_import__(...)` inline fails Rolldown's own parser
 * with `` `await` is only allowed within async functions and at the top levels of modules `` —
 * react's own source wraps its entire dev-mode implementation in a plain, non-async IIFE
 * (`"production" !== process.env.NODE_ENV && (function () { ... var React = require("react") ...
 * })();`). `await`
 * inside a nested, non-async closure is invalid regardless of how any OUTER function is declared —
 * marking an outer wrapper `async` does not make an inner, separately-declared function awaitable.
 * The fix: every relative-require lookup is fully synchronous (`__cjsRequire__(id)`), since the
 * entire subtree was already recursively pre-loaded before the bundle is even emitted; a bare
 * specifier is instead pre-fetched exactly once, at the bundle's own true top level (the only place
 * `await` is guaranteed syntactically valid), then looked up synchronously via `__bareRequire__`.
 *
 * ## A bare specifier is resolved canonically before being handed to `__vite_ssr_import__`
 *
 * `__vite_ssr_import__(target, {})` is called with `target` resolved via
 * `bare-specifier-resolve.ts`'s own {@linkcode resolveBareSpecifierCanonically} first, not the
 * original bare string. This is NOT redundant with that file's own `resolveId` hook
 * (`canonicalBareSpecifierResolvePlugin`) being registered in `createSpaceDevEngine`'s own
 * `plugins` — a bare specifier called from inside THIS file's own hand-written bundle text goes
 * through Vite's own module-runner `fetchModule`, which has a fast path (a bare string + a known
 * importer) that resolves it via Vite's plain Node resolution and never consults any plugin's
 * `resolveId` at all (see `resolveBareSpecifierCanonically`'s own doc for the full finding).
 * Resolving here first, and handing `__vite_ssr_import__` an already-resolved
 * absolute path, is what makes it skip that fast path — the same canonical resolution
 * `bare-specifier-resolve.ts`'s `resolveId` hook already applies to a normal import statement.
 *
 * Whatever the CJS module's own bare requires resolve to (a plain CJS `.js`, a real ESM module with
 * no `default` export at all, ...), the fetched value is used as-is — the WHOLE namespace object,
 * never narrowed to `.default`. Narrowing to `.default` happens to work for a CJS target — its own
 * synthesized `default` equals the whole `exports` object — but silently returns `undefined` for a
 * real ESM dependency with no `default` export, so the whole namespace object is kept instead.
 */

const REQUIRE_RE = /require\(\s*(['"])([^'"]+)\1\s*\)/g
// The same content-based heuristic real tools (e.g. `@rollup/plugin-commonjs`) use — `@deno/
// loader`'s own `MediaType.Cjs` does not reliably fire for a structurally-CJS `.js` file (confirmed
// empirically: it only fires for a literal `.cjs` extension), so detection can't rely on it.
// `exports\.\w+` (not `\w` — confirmed empirically with `react-dom/server.browser.js`'s own real
// `exports.version`/`exports.renderToString`/... assignments: a single-char `\w` followed by a
// trailing `\b` never matches a real multi-character property name, since there's no word boundary
// between two word characters — this file was silently passed through unwrapped until fixed).
const CJS_SHAPE_RE = /\bmodule\.exports\b|\bexports\.\w+|\bObject\.defineProperty\(\s*exports\s*,/
const ESM_SHAPE_RE = /^\s*(import|export)\b/m

const decoder = new TextDecoder()

/**
 * Blanks out (space-fills, same length/offsets, so `REQUIRE_RE` match indices stay valid against
 * the ORIGINAL `code`) every `//` and `/* *‍/`-style comment span in `code` — used ONLY to decide
 * which `require(...)` occurrences {@linkcode buildCjsBundle} should treat as real dependencies,
 * never to produce output text (comments reach the final rewritten source completely untouched).
 *
 * `REQUIRE_RE`'s own content-based heuristic (this module's own header doc) cannot tell a real
 * `require('foo')` call from identical text sitting inside a JSDoc usage example — `picomatch@4`'s
 * own `lib/picomatch.js` has exactly this, e.g. `* const pm = require('picomatch');` and,
 * separately, `* const picomatch = require('picomatch/posix');` (`picomatch/posix` — a real,
 * on-disk subpath, but one nothing in picomatch's own EXECUTABLE code ever actually requires).
 * Left unmasked, `buildCjsBundle` records both as real bare dependencies of `picomatch/index.js`;
 * `picomatch/posix` — genuinely resolvable, but never itself visited/wrapped by this file's own CJS
 * detection, since nothing real ever requires it — then reaches Vite's SSR module runner as a raw
 * external CJS file and crashes with `ReferenceError: module is not defined` at its own
 * `module.exports = require('./lib/picomatch')` line, the identical failure mode this module's
 * header doc already describes for `react`/`react-dom`. The generated bundle text traces the whole
 * failure directly back to this file's own naive regex scan: `__vite_ssr_import__("picomatch/
 * posix", {})`.
 *
 * Deliberately does not also try to mask string-literal contents elsewhere in the file (only
 * comments) — no confirmed real case needs it, and doing so risks misclassifying a genuine
 * `require('picomatch')` call's own string-literal argument. A backslash inside a string is
 * consumed together with the character it escapes, so a comment-starting `//`/`/*` sequence
 * embedded in an escaped string (`"a \" // not a comment"`) is never misread as leaving the
 * string early.
 *
 * A plain single `quote` flag is not enough to get this right for two further, confirmed-real
 * shapes, so this tracks a small stack of lexical contexts instead of one variable:
 * - **A template literal's own `${...}` interpolation hole is real, executable code, not string
 *   content** — a `//`/`/* *‍/` sequence written INSIDE one is a genuine comment (masking it is
 *   exactly this function's job), while the literal text on either side of the hole is opaque, same
 *   as any other string. Treating the whole backtick-to-backtick span as one opaque quote (as a
 *   single `quote` variable does) leaves a real comment inside a hole unmasked — `` `Hello ${/*
 *   require('sneaky-dep') *‍/ name}` `` — recording `sneaky-dep` as a real dependency even though
 *   it only ever appears inside a comment. The stack also lets a hole contain its OWN nested
 *   template literal (and that literal its own further holes) without losing track of which `` ` ``
 *   or `}` closes which context, and lets an ordinary object literal inside a hole (`${ {a: 1} }`)
 *   use `{`/`}` freely without being mistaken for the hole's own closing brace (tracked via a
 *   per-hole brace depth).
 * - **A regex literal's own escaped `/` is not a comment delimiter** — `/http:\/\//`'s closing
 *   delimiter is a `/` immediately preceded by an escaped `/`, and a plain char-by-char scan with no
 *   notion of regex literals reads the two adjacent, unescaped-looking `/` characters right after it
 *   as a `//` line comment, masking away everything after it on that line — including a real
 *   `require(...)` call sharing that line, a false NEGATIVE (a missed real dependency) rather than
 *   the false positive above, and arguably the more serious failure mode of the two since it fails
 *   silently at bundle time instead of at masking time. A `/` is treated as a regex literal's own
 *   opening delimiter when the last significant token before it is one this function recognizes as
 *   only ever preceding an expression (an operator/punctuation character, or a keyword like
 *   `return`/`typeof`/`case`) — the same regex-vs-division heuristic real lightweight (non-AST)
 *   JS tokenizers use — and, once opened, its own `[...]` character class is tracked separately
 *   since a `/` inside one never closes the regex either.
 */
function maskComments(code: string): string {
  type Frame =
    | { type: 'code' }
    | { type: 'string'; quote: string }
    | { type: 'template' }
    | { type: 'templateExpr'; depth: number }

  const REGEX_PRECEDERS = new Set([
    '',
    '(',
    ',',
    '=',
    ':',
    '[',
    '!',
    '&',
    '|',
    '?',
    '{',
    '}',
    ';',
    '+',
    '-',
    '*',
    '%',
    '~',
    '^',
    '<',
    '>',
    '\n',
  ])
  const REGEX_PRECEDING_KEYWORDS = new Set([
    'return',
    'typeof',
    'case',
    'delete',
    'void',
    'throw',
    'new',
    'in',
    'of',
    'instanceof',
    'yield',
    'do',
    'else',
  ])
  const WORD_RE = /[A-Za-z0-9_$]/

  let out = ''
  let i = 0
  const { length } = code
  const stack: Frame[] = [{ type: 'code' }]
  // The last significant (non-whitespace) code character emitted, and the last completed
  // identifier/keyword run — both drive the regex-vs-division heuristic above.
  let lastSignificant = ''
  let currentWord = ''
  let lastWord = ''

  function noteChar(char: string): void {
    if (WORD_RE.test(char)) {
      currentWord += char
    } else {
      if (currentWord) lastWord = currentWord
      currentWord = ''
      if (!/\s/.test(char)) lastWord = ''
    }
    if (!/\s/.test(char)) lastSignificant = char
  }

  while (i < length) {
    const top = stack[stack.length - 1]
    const char = code[i]

    if (top.type === 'string') {
      out += char
      if (char === '\\' && i + 1 < length) {
        out += code[i + 1]
        i += 2
        continue
      }
      if (char === top.quote) stack.pop()
      i++
      continue
    }

    if (top.type === 'template') {
      if (char === '\\' && i + 1 < length) {
        out += char + code[i + 1]
        i += 2
        continue
      }
      if (char === '`') {
        out += char
        stack.pop()
        i++
        continue
      }
      if (char === '$' && code[i + 1] === '{') {
        out += '${'
        stack.push({ type: 'templateExpr', depth: 0 })
        i += 2
        continue
      }
      out += char
      i++
      continue
    }

    // top.type === 'code' | 'templateExpr' — real, executable JS.
    const twoChars = code.slice(i, i + 2)
    if (twoChars === '//') {
      let end = i
      while (end < length && code[end] !== '\n') end++
      out += ' '.repeat(end - i)
      i = end
      continue
    }
    if (twoChars === '/*') {
      let end = code.indexOf('*/', i + 2)
      end = end === -1 ? length : end + 2
      out += ' '.repeat(end - i)
      i = end
      continue
    }
    if (char === '"' || char === "'") {
      stack.push({ type: 'string', quote: char })
      out += char
      noteChar(char)
      i++
      continue
    }
    if (char === '`') {
      stack.push({ type: 'template' })
      out += char
      noteChar(char)
      i++
      continue
    }
    if (
      char === '/' &&
      (REGEX_PRECEDERS.has(lastSignificant) ||
        (!currentWord && REGEX_PRECEDING_KEYWORDS.has(lastWord)))
    ) {
      let end = i + 1
      let inClass = false
      let closed = false
      while (end < length) {
        const c = code[end]
        if (c === '\\') {
          end += 2
          continue
        }
        if (c === '\n') break // an unterminated regex can't span a real newline
        if (c === '[') {
          inClass = true
          end++
          continue
        }
        if (c === ']') {
          inClass = false
          end++
          continue
        }
        if (c === '/' && !inClass) {
          closed = true
          end++
          break
        }
        end++
      }
      if (closed) {
        while (end < length && /[a-z]/i.test(code[end])) end++ // trailing flags
        out += code.slice(i, end)
        lastSignificant = '/'
        lastWord = ''
        currentWord = ''
        i = end
        continue
      }
      // No real closing delimiter found — not actually a regex literal; fall through below.
    }
    if (top.type === 'templateExpr') {
      if (char === '{') {
        top.depth++
        out += char
        noteChar(char)
        i++
        continue
      }
      if (char === '}') {
        if (top.depth === 0) {
          stack.pop()
          out += char
          i++
          continue
        }
        top.depth--
        out += char
        noteChar(char)
        i++
        continue
      }
    }
    out += char
    noteChar(char)
    i++
  }

  return out
}

interface CjsBundle {
  /** The resolved id of the file `wrapCjsIfNeeded` was originally called for. */
  entryId: string
  /** Resolved id -> factory function source (`''` for an externalized/`node:` dependency). */
  factories: Map<string, string>
  /** Every bare (non-relative) specifier `require()`d anywhere in the subtree. */
  bareSpecifiers: Set<string>
}

/**
 * Recursively resolves and loads every RELATIVE `require()` reachable from `entryUrl`, producing
 * one synchronous CJS factory per file. Never recurses into a bare specifier's own subtree — that
 * stays external, resolved through Vite's real module graph instead (see this module's own doc).
 */
async function buildCjsBundle(
  entryUrl: string,
  loader: Loader,
): Promise<CjsBundle> {
  const factories = new Map<string, string>()
  const bareSpecifiers = new Set<string>()
  const visiting = new Set<string>()

  async function visit(fileUrl: string): Promise<void> {
    if (factories.has(fileUrl) || visiting.has(fileUrl)) return
    visiting.add(fileUrl)

    const result = await loader.load(fileUrl, RequestedModuleType.Default)
    if (result.kind === 'external') {
      factories.set(fileUrl, '')
      visiting.delete(fileUrl)
      return
    }

    const code = decoder.decode(result.code)
    // Matched against the COMMENT-MASKED text, never the raw `code` — see `maskComments`'s own doc
    // for the real, confirmed false positive this avoids (a `require(...)` call sitting inside a
    // JSDoc usage example, not real executable code). Masking preserves every character's offset,
    // so `match.index` below still addresses the ORIGINAL `code` correctly.
    const masked = maskComments(code)
    const matches = [...masked.matchAll(REQUIRE_RE)]
    const specs = matches.map((match) => match[2])

    const resolvedIds: string[] = []
    for (const spec of specs) {
      if (spec.startsWith('.')) {
        const resolved = loader.resolveSync(
          spec,
          fileUrl,
          ResolutionMode.Require,
        )
        // subtree must finish loading before the next require's factory can safely reference it.
        // deno-lint-ignore no-await-in-loop -- a genuine recursive graph walk; each require's own
        await visit(resolved)
        resolvedIds.push(resolved)
      } else {
        bareSpecifiers.add(spec)
        resolvedIds.push(spec)
      }
    }

    // Built by hand from `matches`' own offsets, not `code.replace(REQUIRE_RE, ...)` — replacing
    // against the raw `code` would re-scan it with `REQUIRE_RE` and rewrite the SAME comment-only
    // occurrences `masked` was built to exclude, right back into the output. A comment's own
    // `require(...)` text is left completely untouched in the rewritten source, exactly as
    // originally written.
    let rewritten = ''
    let lastIndex = 0
    matches.forEach((match, index) => {
      const resolvedId = resolvedIds[index]
      const isRelative = specs[index].startsWith('.')
      rewritten += code.slice(lastIndex, match.index)
      rewritten += isRelative
        ? `__cjsRequire__(${JSON.stringify(resolvedId)})`
        : `__bareRequire__(${JSON.stringify(resolvedId)})`
      lastIndex = match.index + match[0].length
    })
    rewritten += code.slice(lastIndex)

    factories.set(
      fileUrl,
      `function(module, exports) {\nconst require = __cjsRequire__\n${rewritten}\n}`,
    )
    visiting.delete(fileUrl)
  }

  await visit(entryUrl)
  return { entryId: entryUrl, factories, bareSpecifiers }
}

/**
 * Rewrites `code` into a self-contained synchronous CJS runtime if — and only if — it structurally
 * looks like CommonJS (see `CJS_SHAPE_RE`/`ESM_SHAPE_RE`); returns `null` for anything else, the
 * same "not my concern, leave it untouched" contract every Vite `transform` hook follows. Safe to
 * call more than once for the same `id` (e.g. once via `deno()`'s own `onLoad`, once via the
 * `transform`-hook fallback below) — each call independently resolves and rebuilds its own bundle,
 * with no shared mutable state beyond the process-wide loader cache.
 */
export async function wrapCjsIfNeeded(
  code: string,
  id: string,
  root: string,
): Promise<OnLoadResult> {
  if (!CJS_SHAPE_RE.test(code) || ESM_SHAPE_RE.test(code)) return null

  const fileUrl = id.startsWith('file://') ? id : new URL(id, 'file:///').href
  const loader = await getSharedLoader(root)
  const { entryId, factories, bareSpecifiers } = await buildCjsBundle(
    fileUrl,
    loader,
  )

  const factoryEntries = [...factories.entries()].filter(([, body]) => body !== '')
  const fnNames = new Map(
    factoryEntries.map(([fid], i) => [fid, `__cjsFactory_${i}__`]),
  )
  const factoryDecls = factoryEntries
    .map(([fid, body]) => body.replace('function(', `function ${fnNames.get(fid)}(`))
    .join('\n\n')
  const ids = factoryEntries.map(([fid]) => fid)
  const registryEntries = ids
    .map((fid) => `  ${JSON.stringify(fid)}: ${fnNames.get(fid)},`)
    .join('\n')

  const bareEntries = [...bareSpecifiers]
  // Resolved via `resolveBareSpecifierCanonically` FIRST, never the bare string handed to
  // `__vite_ssr_import__` directly — see this file's own header doc ("A bare specifier is resolved
  // canonically before ...") for why: Vite's own module-runner `fetchModule` takes a fast path for
  // a bare string called with a known importer that bypasses the plugin `resolveId` chain (and
  // therefore `bare-specifier-resolve.ts`'s own fix) entirely. Falls back to the original spec
  // untouched when canonical resolution declines (e.g. a real npm package `@deno/loader` and Vite's
  // own native Node resolution already agree on) — the whole namespace object is used as-is either
  // way, never narrowed to `.default` (an earlier version did; see this file's own header doc).
  const bareFetches = (await Promise.all(bareEntries.map(async (spec, i) => {
    const resolved = await resolveBareSpecifierCanonically(spec, root)
    const target = resolved ?? spec
    return `const __bareModule_${i}__ = await __vite_ssr_import__(${JSON.stringify(target)}, {})`
  }))).join('\n')
  const bareMap = bareEntries
    .map((spec, i) => `  ${JSON.stringify(spec)}: __bareModule_${i}__,`)
    .join('\n')

  const bundle = `export {}
${bareFetches}
const __bareModules__ = {
${bareMap}
}
function __bareRequire__(spec) { return __bareModules__[spec] }
${factoryDecls}
const __cjsFactories__ = {
${registryEntries}
}
const __cjsCache__ = {}
function __cjsRequire__(fid) {
  if (__cjsCache__[fid]) return __cjsCache__[fid].exports
  const module = { exports: {} }
  __cjsCache__[fid] = module
  __cjsFactories__[fid](module, module.exports)
  return module.exports
}
const __cjsResult__ = __cjsRequire__(${JSON.stringify(entryId)})
const __cjsResultType__ = typeof __cjsResult__
const __cjsIsObjectLike__ = __cjsResultType__ === 'object' || __cjsResultType__ === 'function'
const __cjsResultKeys__ = __cjsResult__ && __cjsIsObjectLike__ ? Object.keys(__cjsResult__) : []
for (const __cjsKey__ of __cjsResultKeys__) {
  __vite_ssr_exportName__(__cjsKey__, () => __cjsResult__[__cjsKey__])
}
if (!__cjsResultKeys__.includes('default')) {
  __vite_ssr_exportName__('default', () => __cjsResult__)
}
`
  return { code: bundle }
}

/**
 * A factory, not a plain handler — `deno()`'s own `LoadContext` (`@deno/vite-plugin`'s public type)
 * carries no `root`/config information at all, only `code`/`id`/`mediaType`/`environment`/`ssr`, so
 * `root` must be captured via closure from `createSpaceDevEngine`'s own `options.root` at the call
 * site (`deno({ onLoad: denoOnLoadCjsInterop(options.root) })`) instead. `root` is what makes
 * `wrapCjsIfNeeded`'s own bare-specifier resolution agree with the SAME project's real, on-disk
 * `node_modules` Vite's own SSR fast path resolves against — see `resolveBareSpecifierCanonically`'s
 * own doc for the module-identity failure this fixes.
 *
 * The returned function is passed as `deno()`'s own `onLoad` option — the primary integration
 * point, run right after `@deno/loader` transpiles a module `@deno/vite-plugin` itself resolved.
 * Only ever active for the `ssr` environment; the `client` environment's own CJS handling (if any is
 * ever needed there) is intentionally out of scope for this dev-only SSR fix.
 */
export function denoOnLoadCjsInterop(
  root: string,
): (ctx: LoadContext) => OnLoadResult | Promise<OnLoadResult> {
  return (ctx) => {
    if (!ctx.ssr) return null
    return wrapCjsIfNeeded(ctx.code, ctx.id, root)
  }
}

/**
 * A second, independent safety net alongside {@linkcode denoOnLoadCjsInterop} — confirmed
 * necessary, not defensive-programming filler: the SAME underlying CJS file can reach the
 * evaluator through TWO different resolution paths in practice (once through `@deno/vite-plugin`'s
 * own wrapped id, which triggers its `onLoad`; once through a plain, unwrapped specifier — e.g.
 * Vite's own automatic JSX-runtime auto-injection — which resolves via Vite's native FS loader and
 * skips `onLoad` entirely). A generic `transform` hook fires for every module regardless of which
 * path it arrived through, so it catches exactly the case `onLoad` alone misses. Registered before
 * `deno()` in `createSpaceDevEngine`'s own `plugins` array so it runs first — either hook's own
 * `wrapCjsIfNeeded` call has an identical, idempotent effect if the other already handled the file.
 */
export function cjsInteropFallbackPlugin(): Plugin {
  return {
    name: 'zanix-space-dev-cjs-interop-fallback',
    transform(code, id) {
      if (this.environment?.name !== 'ssr') return null
      return wrapCjsIfNeeded(code, id, this.environment.config.root)
    },
  }
}
