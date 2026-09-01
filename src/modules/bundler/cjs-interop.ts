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
 * Blanks out (space-fills, same length/offsets, so a caller's own match indices stay valid against
 * the ORIGINAL `code`) every `//` and `/* *‍/`-style comment span in `code`. Exported for reuse by
 * `dynamic-import-interop.ts`'s own `DYNAMIC_IMPORT_RE` scan — same rationale, same tokenizer, a
 * different regex applied against the masked result. Used here to decide which `require(...)`
 * occurrences {@linkcode buildCjsBundle} should treat as real dependencies,
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
export function maskComments(code: string): string {
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
  /** Every bare (non-relative) specifier `require()`d anywhere in the subtree that stayed on the
   * `__vite_ssr_import__` path — see {@linkcode bareSpecifierResolvesAtTopLevel}'s own doc for
   * which bare specifiers this excludes now, and why. */
  bareSpecifiers: Set<string>
}

/**
 * Whether `spec` (a bare specifier — never one starting with `.`) resolves via the TOP-LEVEL
 * project's own import map, with NO referrer — the exact same referrer-less resolution
 * {@linkcode resolveBareSpecifierCanonically} (`bare-specifier-resolve.ts`) already performs for a
 * normal import statement, and the one Vite's own SSR module-runner `fetchModule` fast path
 * effectively relies on for "a bare string + a known importer" (see that file's own doc).
 *
 * This is the real distinction {@linkcode buildCjsBundle}'s own `visit()` needs — NOT whether
 * `spec` has a subpath, an earlier, narrower heuristic (`mongodb/lib/bulk/common` vs. plain
 * `mongodb`) that missed a real, confirmed second case: `mongodb`'s own bare PACKAGE ROOT
 * (`require('mongodb')`, no subpath at all) crashes the IDENTICAL way, because `console` (a real
 * consumer) never declares `mongodb` at its own top level either — only transitively, through
 * `mongoose`. A specifier that resolves HERE is a real, independently-declared dependency
 * (`react`, reachable from a page's own `import 'react'`) — exactly the case
 * `__bareRequire__`/`__vite_ssr_import__` exists FOR (see this module's own header doc): Vite
 * dedupes that shared instance by resolved id, so a page's own `import 'react'` and `react-dom`'s
 * internal `require('react')` land on the SAME module, and leaving it on the external path
 * preserves that singleton. A specifier that does NOT resolve here is private to whatever package
 * requires it — nothing else in the graph could ever reach it via the SAME bare id anyway
 * (`mongodb`'s own root included, once nothing besides `mongoose` itself ever requires it bare),
 * so there is no singleton to protect, and inlining it exactly like a relative require is both
 * safe and correct.
 */
function bareSpecifierResolvesAtTopLevel(spec: string, loader: Loader): boolean {
  try {
    loader.resolveSync(spec, undefined, ResolutionMode.Import)
    return true
  } catch {
    return false
  }
}

/**
 * Recursively resolves and loads every RELATIVE `require()` reachable from `entryUrl`, producing
 * one synchronous CJS factory per file. Never recurses into a bare specifier that resolves via the
 * TOP-LEVEL project's own import map — that stays external, resolved through Vite's real module
 * graph instead (see this module's own doc) — but DOES recurse into any OTHER bare specifier (see
 * {@linkcode bareSpecifierResolvesAtTopLevel}'s own doc), the same as a relative require, PROVIDED
 * the resolved target is itself CJS-shaped (the same `CJS_SHAPE_RE`/`ESM_SHAPE_RE` check
 * {@linkcode wrapCjsIfNeeded} already applies to the bundle's own entry file — a bare specifier
 * reached this way CAN point at a real ESM module, which this bundler's own `function(module,
 * exports) {...}` wrapping would corrupt if forced through it).
 *
 * ## Why this closes a real, confirmed `zanix space dev` crash `bareSpecifiers`/
 * `__vite_ssr_import__` cannot
 *
 * A bare specifier reaches `__vite_ssr_import__(target, {})` only after
 * {@linkcode resolveBareSpecifierCanonically} resolves it FIRST — but that resolution is only ever
 * attempted WITHOUT a real referrer for any `node_modules`-rooted importer (a deliberate choice in
 * `bare-specifier-resolve.ts`'s own `referrerUrlFor`, made for an unrelated asymmetry bug — see
 * that file's own doc). Confirmed, real, and reproducible, for BOTH shapes: `mongoose`'s own
 * `require('mongodb/lib/bulk/common')` (a subpath) AND its plain `require('mongodb')` (the bare
 * package root) alike fail to resolve that way — `@deno/loader`, given no referrer, tries to
 * resolve `mongodb` against the top-level project's OWN import map, which never declares this
 * deeply transitive dependency directly (subpath or not), and throws `Import "mongodb" not a
 * dependency and not in import map`. `wrapCjsIfNeeded`'s own fallback (`?? spec`, the RAW
 * unresolved string) then reaches Vite's SSR module-runner `fetchModule`'s own "bare string +
 * known importer" fast path — which resolves it fine, but as an EXTERNAL module, entirely
 * bypassing this file's own CJS-wrapping — producing the exact `ReferenceError: exports is not
 * defined` this fix closes, for either shape identically. Resolving a bare specifier HERE instead,
 * with `fileUrl` as a real referrer (`ResolutionMode.Require`, the same call a relative require
 * already makes successfully), sidesteps the broken referrer-less path entirely — confirmed
 * directly: the SAME `mongodb` specifiers (subpath and bare root alike) resolve cleanly when given
 * a real referrer, only failing without one.
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

    // A relatively-required `.json` file (`require('../package.json')`, a real, confirmed pattern
    // in `mongoose`'s own `lib/mongoose.js`) is raw JSON data, not JS source made of statements —
    // Node's own `require('./x.json')` returns the PARSED object as the module's exports. Treating
    // its raw content as JS-statement text (the general case below) produces a syntactically
    // invalid factory body: a bare object literal sitting where a statement is expected, right
    // after `const require = __cjsRequire__` below — confirmed as the exact, real cause of a
    // `mongoose`-specific crash (`Parse failure: Expected a semicolon...`, pointing straight at its
    // own inlined `package.json` content). Wrapped as a real assignment instead, which is valid JS
    // regardless of what the JSON's own top-level shape is (object, array, or primitive). Never
    // itself scanned for `require(...)`/visited further — JSON can't contain one.
    if (fileUrl.endsWith('.json')) {
      factories.set(fileUrl, `function(module, exports) {\nmodule.exports = ${code}\n}`)
      visiting.delete(fileUrl)
      return
    }

    // Matched against the COMMENT-MASKED text, never the raw `code` — see `maskComments`'s own doc
    // for the real, confirmed false positive this avoids (a `require(...)` call sitting inside a
    // JSDoc usage example, not real executable code). Masking preserves every character's offset,
    // so `match.index` below still addresses the ORIGINAL `code` correctly.
    const masked = maskComments(code)
    const matches = [...masked.matchAll(REQUIRE_RE)]
    const specs = matches.map((match) => match[2])

    const resolvedIds: string[] = []
    // Parallel to `resolvedIds`/`specs` — whether THIS occurrence was actually inlined into the
    // synchronous `__cjsRequire__` registry, as opposed to left on the external `__bareRequire__`/
    // `__vite_ssr_import__` path. Deliberately NOT re-derived from `specs[index].startsWith('.')`
    // at rewrite time below: a bare specifier can ALSO end up inlined (see
    // `bareSpecifierResolvesAtTopLevel`'s own doc) — using the original spec's own leading
    // character would emit `__bareRequire__` for an id that was never added to
    // `bareSpecifiers`/`__bareModules__`, resolving to `undefined` at runtime instead of the real
    // module.
    const useCjsRequire: boolean[] = []
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
        useCjsRequire.push(true)
        continue
      }

      // A bare specifier that does NOT resolve via the top-level project's own import map (see
      // `bareSpecifierResolvesAtTopLevel`'s own doc) is attempted as an INLINE target instead, the
      // same as a relative require, before ever falling back to the external `__vite_ssr_import__`
      // path below — see this function's own doc for the real crash this closes. Resolution/load/
      // shape-check failures all fall through to the ORIGINAL external behavior rather than
      // throwing — this whole block is an optimization attempt, not a new hard requirement a bare
      // specifier must satisfy.
      let inlinedAsPrivate = false
      if (!bareSpecifierResolvesAtTopLevel(spec, loader)) {
        let resolved: string | undefined
        try {
          resolved = loader.resolveSync(spec, fileUrl, ResolutionMode.Require)
        } catch {
          resolved = undefined
        }
        if (resolved && factories.has(resolved)) {
          // Already inlined via a PRIOR occurrence of this exact specifier (a shared internal
          // helper module a package's own source requires from many of its own files is a real,
          // common shape — mongodb's own tree has several) — `visit()`'s own body already ran the
          // shape check once; skip the redundant `loader.load()`/`CJS_SHAPE_RE` probe here, it can
          // only repeat the SAME verdict this file already recorded.
          resolvedIds.push(resolved)
          useCjsRequire.push(true)
          inlinedAsPrivate = true
        } else if (resolved) {
          // Same reasoning as the relative-require branch above: a genuine recursive graph walk,
          // one require at a time.
          // deno-lint-ignore no-await-in-loop
          const subResult = await loader.load(resolved, RequestedModuleType.Default)
          if (subResult.kind !== 'external') {
            const subCode = decoder.decode(subResult.code)
            if (CJS_SHAPE_RE.test(subCode) && !ESM_SHAPE_RE.test(subCode)) {
              // deno-lint-ignore no-await-in-loop -- same reasoning as above.
              await visit(resolved)
              resolvedIds.push(resolved)
              useCjsRequire.push(true)
              inlinedAsPrivate = true
            }
          }
        }
      }
      if (!inlinedAsPrivate) {
        bareSpecifiers.add(spec)
        resolvedIds.push(spec)
        useCjsRequire.push(false)
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
      rewritten += code.slice(lastIndex, match.index)
      rewritten += useCjsRequire[index]
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
  //
  // Each fetch is individually try/caught, never left to throw straight out of this `await` chain
  // — a real, confirmed shape: `mongoose`'s own `require('kerberos')` (a genuinely OPTIONAL native
  // binding almost never actually installed) is written inside a `try { require('kerberos') }
  // catch { ... }` in `mongoose`'s own real source. Rewriting that `require(...)` text to
  // `__bareRequire__("kerberos")` leaves the surrounding `try`/`catch` completely intact in the
  // output — this bundle never restructures control flow, only the call text — so the ORIGINAL
  // try/catch is still exactly where it needs to be once `__bareRequire__` actually runs, INSIDE
  // whatever factory does the requiring. Awaiting every fetch here eagerly and unconditionally, at
  // this bundle's own true top level, would run it BEFORE any factory (and its own try/catch) ever
  // gets a chance to run — an optional dependency that's genuinely absent would then throw at the
  // top level instead, crashing the whole bundle's evaluation instead of being caught the way the
  // original source always intended. Storing the error here and re-throwing it from
  // `__bareRequire__` itself below defers the failure to the exact point the original code already
  // guards.
  const bareFetches = (await Promise.all(bareEntries.map(async (spec, i) => {
    const resolved = await resolveBareSpecifierCanonically(spec, root)
    const target = resolved ?? spec
    return `let __bareModule_${i}__\ntry {\n  __bareModule_${i}__ = ` +
      `await __vite_ssr_import__(${
        JSON.stringify(target)
      }, {})\n} catch (__bareModuleError_${i}__) ` +
      `{\n  __bareModuleErrors__[${JSON.stringify(spec)}] = __bareModuleError_${i}__\n}`
  }))).join('\n')
  const bareMap = bareEntries
    .map((spec, i) => `  ${JSON.stringify(spec)}: __bareModule_${i}__,`)
    .join('\n')

  const bundle = `export {}
const __bareModuleErrors__ = {}
${bareFetches}
const __bareModules__ = {
${bareMap}
}
function __bareRequire__(spec) {
  if (Object.prototype.hasOwnProperty.call(__bareModuleErrors__, spec)) {
    throw __bareModuleErrors__[spec]
  }
  return __bareModules__[spec]
}
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
