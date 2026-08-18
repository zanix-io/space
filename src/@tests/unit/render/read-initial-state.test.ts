import { assertEquals } from '@std/assert'
import { readInitialState } from 'modules/client/mod.ts'

const globalRecord = globalThis as Record<string, unknown>

Deno.test('readInitialState: returns undefined when nothing was set', () => {
  delete globalRecord.__ZANIX_SPACE_STATE__
  assertEquals(readInitialState(), undefined)
})

Deno.test('readInitialState: returns whatever value the global carries', () => {
  globalRecord.__ZANIX_SPACE_STATE__ = { user: { name: 'Ana' } }
  assertEquals(readInitialState<{ user: { name: string } }>(), {
    user: { name: 'Ana' },
  })
  delete globalRecord.__ZANIX_SPACE_STATE__
})
