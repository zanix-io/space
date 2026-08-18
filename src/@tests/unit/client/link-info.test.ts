import { assertEquals, assertFalse } from '@std/assert'
import { resolveLinkInfo } from 'modules/client/link-info.ts'

// `findAnchor` (this module's other export) is NOT covered here — it requires a real `Element`
// (`target instanceof Element`) and a real `.closest('a')`, both genuine DOM APIs this project has
// no DOM-shim for anywhere (a deliberate, already-documented choice — see
// `comet-persistence.test.ts` / `orbit.test.ts`'s own "DOM-shim" notes). Out of scope, verified by
// code review against the real DOM API instead.
//
// `resolveLinkInfo` only ever reads `location.href`/`location.origin`/`location.pathname`/
// `location.search` and feeds them into a real, native `new URL(...)` — no selector matching, no
// tree traversal. Deno's own global scope has no real `location` under `deno test` (confirmed by
// `dev-vite-hot-client.test.ts`'s own note: `typeof location === 'undefined'`), so a plain fake
// object standing in for exactly those four fields, installed on `globalThis.location` and restored
// afterward, follows that same file's own established pattern — not a DOM shim, just the one small
// piece of `location` this function actually reads.

type FakeLocation = { href: string; origin: string; pathname: string; search: string }

const globalWithLocation = globalThis as unknown as { location?: FakeLocation }

function withLocation<T>(location: FakeLocation, fn: () => T): T {
  const previous = globalWithLocation.location
  globalWithLocation.location = location
  try {
    return fn()
  } finally {
    if (previous === undefined) delete globalWithLocation.location
    else globalWithLocation.location = previous
  }
}

const CURRENT: FakeLocation = {
  href: 'https://example.com/products?tab=info',
  origin: 'https://example.com',
  pathname: '/products',
  search: '?tab=info',
}

Deno.test('resolveLinkInfo: href is null — resolved is undefined, nothing is same-origin', () => {
  withLocation(CURRENT, () => {
    const info = resolveLinkInfo(null)
    assertEquals(info.resolved, undefined)
    assertFalse(info.isSameOrigin)
    assertFalse(info.isSameDocumentHashLink)
  })
})

Deno.test('resolveLinkInfo: a relative, same-origin path resolves against location.href', () => {
  withLocation(CURRENT, () => {
    const info = resolveLinkInfo('/checkout')
    assertEquals(info.resolved?.href, 'https://example.com/checkout')
    assertEquals(info.isSameOrigin, true)
    assertFalse(info.isSameDocumentHashLink)
  })
})

Deno.test('resolveLinkInfo: a cross-origin absolute href is never same-origin', () => {
  withLocation(CURRENT, () => {
    const info = resolveLinkInfo('https://other.example/checkout')
    assertEquals(info.isSameOrigin, false)
    assertFalse(info.isSameDocumentHashLink)
  })
})

Deno.test(
  'resolveLinkInfo: a hash-only link to the current path+search is a same-document hash link',
  () => {
    withLocation(CURRENT, () => {
      const info = resolveLinkInfo('#section')
      assertEquals(info.isSameOrigin, true)
      assertEquals(info.isSameDocumentHashLink, true)
    })
  },
)

Deno.test(
  'resolveLinkInfo: the full current path+search+hash is also a same-document hash link',
  () => {
    withLocation(CURRENT, () => {
      const info = resolveLinkInfo('/products?tab=info#section')
      assertEquals(info.isSameDocumentHashLink, true)
    })
  },
)

Deno.test(
  'resolveLinkInfo: a hash link to a DIFFERENT path is never a same-document hash link',
  () => {
    withLocation(CURRENT, () => {
      const info = resolveLinkInfo('/other-page#section')
      assertEquals(info.isSameOrigin, true)
      assertFalse(info.isSameDocumentHashLink)
    })
  },
)

Deno.test(
  'resolveLinkInfo: a hash link to the same path but DIFFERENT search is never a ' +
    'same-document hash link',
  () => {
    withLocation(CURRENT, () => {
      const info = resolveLinkInfo('/products?tab=other#section')
      assertEquals(info.isSameOrigin, true)
      assertFalse(info.isSameDocumentHashLink)
    })
  },
)

Deno.test(
  'resolveLinkInfo: a same-path link with no hash at all is never a same-document hash link',
  () => {
    withLocation(CURRENT, () => {
      const info = resolveLinkInfo('/products?tab=info')
      assertEquals(info.isSameOrigin, true)
      assertFalse(info.isSameDocumentHashLink)
    })
  },
)
