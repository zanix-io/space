import { assert, assertEquals } from '@std/assert'
import { USE_COMET_DIRECTIVE } from 'modules/bundler/comet-directive.ts'
import { directivePrologueRegex } from 'modules/bundler/directive-prologue.ts'
import { SERVER_ONLY_DIRECTIVE } from 'modules/bundler/server-only-directive.ts'

// `cometPlugin`'s `transform` hook can run both directive regexes against a module's code,
// including the CSS an `@import` chain inlines. A source with many adjacent comments and no
// directive must be rejected in linear time. The exponential pattern needs ~25 s for 26 comments,
// so this budget (a few hundred times the linear cost on a slow runner) still fails it by orders of
// magnitude without depending on machine speed.
const BUDGET_MS = 500
const COMMENTS = 26

function timed(fn: () => boolean): { result: boolean; ms: number } {
  const start = performance.now()
  const result = fn()
  return { result, ms: performance.now() - start }
}

for (
  const [name, regex] of [
    ['use comet', USE_COMET_DIRECTIVE],
    ['server-only', SERVER_ONLY_DIRECTIVE],
  ] as const
) {
  Deno.test(`${name} directive regex rejects ${COMMENTS} adjacent comments without a directive in linear time`, () => {
    const code = '/* section */\n'.repeat(COMMENTS) + '.a { color: red }\n'
    const { result, ms } = timed(() => regex.test(code))
    assertEquals(result, false)
    assert(ms < BUDGET_MS, `took ${ms.toFixed(0)}ms (budget ${BUDGET_MS}ms)`)
  })

  Deno.test(`${name} directive regex stays linear on concatenated stylesheets with trailing comments`, () => {
    const sheet = '/* header\n * spans lines\n */\n.a { color: red }\n/* tail */\n'
    const code = sheet.repeat(COMMENTS)
    const { result, ms } = timed(() => regex.test(code))
    assertEquals(result, false)
    assert(ms < BUDGET_MS, `took ${ms.toFixed(0)}ms (budget ${BUDGET_MS}ms)`)
  })

  Deno.test(`${name} directive regex stays linear on thousands of comments and on an unclosed comment`, () => {
    const comments = '/* c */\n// line\n'.repeat(5000)
    const closed = timed(() => regex.test(comments + 'export {}'))
    assertEquals(closed.result, false)
    assert(closed.ms < BUDGET_MS, `took ${closed.ms.toFixed(0)}ms (budget ${BUDGET_MS}ms)`)
    const unclosed = timed(() =>
      regex.test('/* a */\n'.repeat(COMMENTS) + `/* never closed '${name}'`)
    )
    assertEquals(unclosed.result, false)
    assert(unclosed.ms < BUDGET_MS, `took ${unclosed.ms.toFixed(0)}ms (budget ${BUDGET_MS}ms)`)
  })

  Deno.test(`${name} directive regex still matches after leading line and block comments`, () => {
    const code = `// a\n/* b */\n  /* c\n d */\n'${name}'\nexport const x = 1\n`
    assertEquals(regex.test(code), true)
    assertEquals(regex.test(`"${name}";\nexport {}`), true)
    assertEquals(regex.test(`/* a ** b **/ "${name}"`), true)
    assertEquals(regex.test(`/**\n * Doc.\n */\n'${name}'`), true)
    assertEquals(regex.test('/* a */\n'.repeat(COMMENTS) + `'${name}'`), true)
  })

  Deno.test(`${name} directive regex rejects a directive that is not the first statement`, () => {
    assertEquals(regex.test(`const y = 1\n'${name}'`), false)
    assertEquals(regex.test(`/* a */ const y = 1 /* b */ '${name}'`), false)
    assertEquals(regex.test(`'${name}`), false)
    assertEquals(regex.test(`'${name}"`), false)
  })
}

Deno.test('directivePrologueRegex builds one regex per directive from the shared prefix', () => {
  const regex = directivePrologueRegex('use other')
  assertEquals(regex.test(`/* a */ 'use other';`), true)
  assertEquals(regex.test(`'use comet'`), false)
  assertEquals(USE_COMET_DIRECTIVE.test(`'server-only'`), false)
  assertEquals(SERVER_ONLY_DIRECTIVE.test(`'use comet'`), false)
})
