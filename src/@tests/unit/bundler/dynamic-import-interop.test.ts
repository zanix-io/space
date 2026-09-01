import { assertEquals, assertStrictEquals } from '@std/assert'
import { forceUnanalyzableDynamicImports } from 'modules/bundler/dynamic-import-interop.ts'

Deno.test(
  'forceUnanalyzableDynamicImports: rewrites a variable-specifier dynamic import (the real ' +
    '`@zanix/admin`/`@zanix/utils` lazy-dependency shape) to call __vite_ssr_dynamic_import__, ' +
    'never a plain native import()',
  () => {
    const code = 'const m = await import(SPECIFIER)\n'
    const result = forceUnanalyzableDynamicImports(code)
    assertEquals(result, 'const m = await __vite_ssr_dynamic_import__(SPECIFIER)\n')
  },
)

Deno.test(
  'forceUnanalyzableDynamicImports: rewrites a member-expression specifier the same way',
  () => {
    const code = 'const m = await import(config.specifier)\n'
    const result = forceUnanalyzableDynamicImports(code)
    assertEquals(result, 'const m = await __vite_ssr_dynamic_import__(config.specifier)\n')
  },
)

Deno.test(
  'forceUnanalyzableDynamicImports: rewrites a template literal WITH real ${...} interpolation ' +
    "— Vite's own import-analysis cannot resolve this to a fixed module id either",
  () => {
    const code = 'const m = await import(`./locales/${lang}.js`)\n'
    const result = forceUnanalyzableDynamicImports(code)
    assertEquals(
      result,
      'const m = await __vite_ssr_dynamic_import__(`./locales/${lang}.js`)\n',
    )
  },
)

Deno.test(
  'forceUnanalyzableDynamicImports: leaves a plain single-quoted string literal untouched — ' +
    "Vite's own transform already resolves and rewrites this case correctly on its own",
  () => {
    const code = "const m = await import('react')\n"
    const result = forceUnanalyzableDynamicImports(code)
    assertStrictEquals(result, code)
  },
)

Deno.test(
  'forceUnanalyzableDynamicImports: leaves a plain double-quoted string literal untouched',
  () => {
    const code = 'const m = await import("react-dom")\n'
    const result = forceUnanalyzableDynamicImports(code)
    assertStrictEquals(result, code)
  },
)

Deno.test(
  'forceUnanalyzableDynamicImports: leaves an interpolation-free template literal untouched — ' +
    "Vite's own transform resolves a plain, static template specifier the same way it resolves a " +
    'quoted string',
  () => {
    const code = 'const m = await import(`react`)\n'
    const result = forceUnanalyzableDynamicImports(code)
    assertStrictEquals(result, code)
  },
)

Deno.test(
  'forceUnanalyzableDynamicImports: never touches a real `import ... from` static import ' +
    'statement, or a plain `import.meta` reference — neither one is a call this function should ' +
    'ever match',
  () => {
    const code = "import { foo } from 'bar'\nconsole.log(import.meta.url)\n"
    const result = forceUnanalyzableDynamicImports(code)
    assertStrictEquals(result, code)
  },
)

Deno.test(
  'forceUnanalyzableDynamicImports: a dynamic import written only inside a comment is never ' +
    'rewritten — the real, confirmed false-positive shape `maskComments` exists to avoid',
  () => {
    const code = '// const m = await import(SPECIFIER)\nconst x = 1\n'
    const result = forceUnanalyzableDynamicImports(code)
    assertStrictEquals(result, code)
  },
)

Deno.test(
  'forceUnanalyzableDynamicImports: rewrites more than one unanalyzable dynamic import in the ' +
    'same file, each independently, while a real literal import sitting between them is left alone',
  () => {
    const code = [
      'const a = await import(SPEC_A)',
      "const b = await import('literal-dep')",
      'const c = await import(SPEC_C)',
      '',
    ].join('\n')
    const result = forceUnanalyzableDynamicImports(code)
    assertEquals(
      result,
      [
        'const a = await __vite_ssr_dynamic_import__(SPEC_A)',
        "const b = await import('literal-dep')",
        'const c = await __vite_ssr_dynamic_import__(SPEC_C)',
        '',
      ].join('\n'),
    )
  },
)

Deno.test(
  'forceUnanalyzableDynamicImports: returns the exact same string reference (no unnecessary ' +
    'reallocation) when a file has no dynamic import to rewrite at all',
  () => {
    const code =
      "export function add(a, b) { return a + b }\n// import('never called') in a comment\n"
    const result = forceUnanalyzableDynamicImports(code)
    assertStrictEquals(result, code)
  },
)
