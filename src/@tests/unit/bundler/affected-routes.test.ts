import { assertEquals } from '@std/assert'
import type { EnvironmentModuleNode } from 'vite'
import { computeAffectedRoutes } from 'modules/bundler/affected-routes.ts'

const isRouteEntry = (id: string) => id.includes('/routes/') && id.endsWith('page.tsx')

/** Minimal fake module node — `computeAffectedRoutes` only reads `.id`/`.importers`. */
function fakeModule(
  id: string,
  importers: EnvironmentModuleNode[] = [],
): EnvironmentModuleNode {
  return {
    id,
    importers: new Set(importers),
  } as unknown as EnvironmentModuleNode
}

Deno.test('computeAffectedRoutes: a changed module that IS a route resolves to itself', () => {
  const page = fakeModule('/routes/products/page.tsx')

  assertEquals(computeAffectedRoutes([page], isRouteEntry), [
    '/routes/products/page.tsx',
  ])
})

Deno.test('computeAffectedRoutes: climbs a shared module to reach the importing route', () => {
  const page = fakeModule('/routes/products/page.tsx')
  const shared = fakeModule('/modules/shared-greeting.ts', [page])

  assertEquals(computeAffectedRoutes([shared], isRouteEntry), [
    '/routes/products/page.tsx',
  ])
})

Deno.test('computeAffectedRoutes: climbs through multiple levels of transitive importers', () => {
  const page = fakeModule('/routes/products/page.tsx')
  const mid = fakeModule('/modules/mid.ts', [page])
  const leaf = fakeModule('/modules/leaf.ts', [mid])

  assertEquals(computeAffectedRoutes([leaf], isRouteEntry), [
    '/routes/products/page.tsx',
  ])
})

Deno.test('computeAffectedRoutes: a module shared by two routes resolves both', () => {
  const productPage = fakeModule('/routes/products/page.tsx')
  const cartPage = fakeModule('/routes/cart/page.tsx')
  const shared = fakeModule('/modules/shared.ts', [productPage, cartPage])

  const result = computeAffectedRoutes([shared], isRouteEntry).sort()
  assertEquals(result, ['/routes/cart/page.tsx', '/routes/products/page.tsx'])
})

Deno.test('computeAffectedRoutes: a diamond import graph is walked once, not duplicated', () => {
  const page = fakeModule('/routes/products/page.tsx')
  const left = fakeModule('/modules/left.ts', [page])
  const right = fakeModule('/modules/right.ts', [page])
  const shared = fakeModule('/modules/shared.ts', [left, right])

  assertEquals(computeAffectedRoutes([shared], isRouteEntry), [
    '/routes/products/page.tsx',
  ])
})

Deno.test('computeAffectedRoutes: a module with no path to a route resolves empty', () => {
  const orphan = fakeModule('/modules/never-imported-by-a-route.ts')

  assertEquals(computeAffectedRoutes([orphan], isRouteEntry), [])
})

Deno.test('computeAffectedRoutes: a module with no `id` is skipped without throwing', () => {
  const noId = {
    id: undefined,
    importers: new Set(),
  } as unknown as EnvironmentModuleNode

  assertEquals(computeAffectedRoutes([noId], isRouteEntry), [])
})

Deno.test('computeAffectedRoutes: independently-changed modules resolve their own routes', () => {
  const productPage = fakeModule('/routes/products/page.tsx')
  const cartPage = fakeModule('/routes/cart/page.tsx')

  const result = computeAffectedRoutes([productPage, cartPage], isRouteEntry)
    .sort()
  assertEquals(result, ['/routes/cart/page.tsx', '/routes/products/page.tsx'])
})
