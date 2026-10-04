import { assertEquals, assertThrows } from '@std/assert'
import { readLayoutStyles } from 'modules/router/layout-styles.ts'

Deno.test('readLayoutStyles: no export means no styles', () => {
  assertEquals(readLayoutStyles('/r/layout.tsx', undefined), undefined)
})

Deno.test('readLayoutStyles: strings and { href, media } objects pass through unchanged', () => {
  const styles = ['./a.css', { href: './b.css', media: 'print' }, { href: './c.css' }]
  assertEquals(readLayoutStyles('/r/layout.tsx', styles), styles)
  assertEquals(readLayoutStyles('/r/layout.tsx', []), [])
})

Deno.test('readLayoutStyles: anything that is not that list is rejected, naming the layout', () => {
  for (
    const value of ['./a.css', { href: './a.css' }, [1], [{ media: 'print' }], [{ href: 1 }], [
      { href: './a.css', media: 3 },
    ], [null]]
  ) {
    const error = assertThrows(() => readLayoutStyles('/r/area/layout.tsx', value)) as {
      message: string
      code?: string
    }
    assertEquals(error.code, 'SPACE_LAYOUT_STYLES_INVALID')
    assertEquals(error.message.includes('/r/area/layout.tsx'), true)
  }
})
