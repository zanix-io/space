import { assertEquals } from '@std/assert'
import { canonicalizePackageSpecifier } from 'modules/bundler/deno-optimize-deps-alias.ts'

// `collectBareSpecifiersFromFile` (`deno-optimize-deps-alias.ts`) used to add whatever specifier
// text it matched straight into `optimizeDeps.include`, verbatim — correct only for the narrow case
// a bare import's own specifier text already equals its real package name (`import x from
// 'lodash'`). A deep subpath (`monaco-editor/esm/vs/editor/editor.worker`) or a Vite-only `?worker`/
// `?url`/`?raw`/`?inline` suffix on top of one — the real, documented way to reach Vite's native
// Worker-import feature for one specific entry file inside a package — never got reduced to the
// real package name, so `optimizeDeps.include` held a value no installed package could ever match,
// silently defeating the whole point of adding it: a transitive CJS dependency several levels down
// (`monaco-graphql` → `graphql-language-service` → `nullthrows`) never got Vite's own ESM-interop
// rewrite, confirmed live via `SyntaxError: ... does not provide an export named 'default'` inside
// a Web Worker. `canonicalizePackageSpecifier` is what closes that gap — this suite exercises it
// directly, covering every shape a real project's own import graph can produce, not just the one
// case that was actually reproduced.

Deno.test(
  'canonicalizePackageSpecifier: a plain bare package name passes through unchanged',
  () => {
    assertEquals(canonicalizePackageSpecifier('lodash'), 'lodash')
  },
)

Deno.test(
  'canonicalizePackageSpecifier: an unscoped package with a subpath reduces to the package name',
  () => {
    assertEquals(canonicalizePackageSpecifier('lodash/debounce'), 'lodash')
  },
)

Deno.test(
  'canonicalizePackageSpecifier: a scoped package with no subpath passes through unchanged',
  () => {
    assertEquals(canonicalizePackageSpecifier('@std/path'), '@std/path')
  },
)

Deno.test(
  "canonicalizePackageSpecifier: a scoped package's own name is its first TWO segments, never " +
    'the whole specifier — the real gap this closes for `@zanix/space/comet/react`-shaped imports',
  () => {
    assertEquals(canonicalizePackageSpecifier('@zanix/space/comet/react'), '@zanix/space')
  },
)

Deno.test(
  'canonicalizePackageSpecifier: a deeply nested subpath (more than one extra segment) still ' +
    'reduces to just the package name',
  () => {
    assertEquals(
      canonicalizePackageSpecifier('monaco-editor/esm/vs/editor/editor.worker'),
      'monaco-editor',
    )
  },
)

Deno.test(
  "canonicalizePackageSpecifier: Vite's own `?worker` import-suffix is stripped, even with no " +
    'subpath at all',
  () => {
    assertEquals(canonicalizePackageSpecifier('lodash?worker'), 'lodash')
  },
)

Deno.test(
  'canonicalizePackageSpecifier: a deep subpath PLUS a `?worker` suffix — the exact real-world ' +
    'repro (a Monaco Web Worker entry file, confirmed live) — reduces to the bare package name, ' +
    'never the raw subpath+query text `optimizeDeps.include` could never match against a real ' +
    'installed package',
  () => {
    assertEquals(
      canonicalizePackageSpecifier('monaco-editor/esm/vs/editor/editor.worker?worker'),
      'monaco-editor',
    )
    assertEquals(
      canonicalizePackageSpecifier('monaco-graphql/esm/graphql.worker?worker'),
      'monaco-graphql',
    )
  },
)

Deno.test(
  'canonicalizePackageSpecifier: every other Vite-only query suffix this convention supports ' +
    '(`?url`, `?raw`, `?inline`) is stripped the same way `?worker` is — the suffix TEXT itself ' +
    'never matters, only that everything from the first `?` on is never part of a real package name',
  () => {
    assertEquals(canonicalizePackageSpecifier('some-asset-pkg/logo.svg?url'), 'some-asset-pkg')
    assertEquals(canonicalizePackageSpecifier('some-pkg/data.json?raw'), 'some-pkg')
    assertEquals(canonicalizePackageSpecifier('some-pkg/worker.js?inline'), 'some-pkg')
  },
)

Deno.test(
  'canonicalizePackageSpecifier: a scoped package with a deep subpath AND a query suffix reduces ' +
    'to the two-segment scoped name, never the whole string',
  () => {
    assertEquals(
      canonicalizePackageSpecifier('@scope/pkg/esm/worker/entry.ts?worker'),
      '@scope/pkg',
    )
  },
)

Deno.test(
  'canonicalizePackageSpecifier: a scoped package with a query suffix but no subpath at all still ' +
    'reduces correctly',
  () => {
    assertEquals(canonicalizePackageSpecifier('@scope/pkg?worker'), '@scope/pkg')
  },
)
