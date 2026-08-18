import { assertEquals } from '@std/assert'
import {
  getThemeResolver,
  resetThemeResolver,
  setThemeResolver,
} from 'modules/theme/theme-registry.ts'

Deno.test('getThemeResolver: undefined when no resolver was ever registered', () => {
  resetThemeResolver()
  assertEquals(getThemeResolver(), undefined)
})

Deno.test('setThemeResolver/getThemeResolver: round-trips the exact same function', () => {
  resetThemeResolver()
  const resolve = () => ({ '--space-color-primary': 'red' })

  setThemeResolver(resolve)

  assertEquals(getThemeResolver(), resolve)
  resetThemeResolver()
})

Deno.test('resetThemeResolver: clears a previously registered resolver back to undefined', () => {
  setThemeResolver(() => ({}))
  resetThemeResolver()

  assertEquals(getThemeResolver(), undefined)
})

Deno.test('setThemeResolver: passing undefined explicitly clears it, same as reset', () => {
  setThemeResolver(() => ({}))
  setThemeResolver(undefined)

  assertEquals(getThemeResolver(), undefined)
})
