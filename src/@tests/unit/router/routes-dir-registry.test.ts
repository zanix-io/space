import { assertEquals } from '@std/assert'
import { getRoutesDir, setRoutesDir } from 'modules/router/routes-dir-registry.ts'

Deno.test('routes-dir-registry: never configured resolves to the default `./routes`', () => {
  assertEquals(getRoutesDir(), './routes')
})

Deno.test('routes-dir-registry: a single string is stored and read back as-is', () => {
  setRoutesDir('./src/space/routes')
  assertEquals(getRoutesDir(), './src/space/routes')
})

Deno.test('routes-dir-registry: an array is stored and read back as-is', () => {
  setRoutesDir(['./routes-override', './routes'])
  assertEquals(getRoutesDir(), ['./routes-override', './routes'])
})
