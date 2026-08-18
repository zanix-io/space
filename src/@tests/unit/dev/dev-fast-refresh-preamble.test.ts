import { assertEquals, assertStringIncludes } from '@std/assert'
import react from '@vitejs/plugin-react'
import { buildFastRefreshPreambleScript } from 'modules/dev/dev-fast-refresh-preamble.ts'

// `viteReact.preambleCode` is only ever imported here, in a test — never from production code
// (see `dev-fast-refresh-preamble.ts`'s own doc for why). This is the guard against silent drift:
// `buildFastRefreshPreambleScript`'s hand-written content must always match the real package's own
// export, byte for byte once `__BASE__` is substituted the same way.
const REAL_PREAMBLE_CODE = (react as unknown as { preambleCode: string }).preambleCode

Deno.test('buildFastRefreshPreambleScript: matches @vitejs/plugin-react preambleCode', () => {
  assertEquals(
    buildFastRefreshPreambleScript('/'),
    REAL_PREAMBLE_CODE.replace('__BASE__', '/'),
  )
})

Deno.test('buildFastRefreshPreambleScript: defaults to "/" when no base is given', () => {
  assertEquals(
    buildFastRefreshPreambleScript(),
    buildFastRefreshPreambleScript('/'),
  )
})

Deno.test('buildFastRefreshPreambleScript: substitutes a custom base', () => {
  assertStringIncludes(
    buildFastRefreshPreambleScript('/app/'),
    'import { injectIntoGlobalHook } from "/app/@react-refresh"',
  )
})

Deno.test('buildFastRefreshPreambleScript: registers the globals Comet code requires', () => {
  const source = buildFastRefreshPreambleScript()
  assertStringIncludes(source, 'window.$RefreshReg$')
  assertStringIncludes(source, 'window.$RefreshSig$')
})
