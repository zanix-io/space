/// <reference lib="dom" />
import { createElement as h, hydrate } from 'preact'
import { LikeButton } from './likebutton.ts'
import { Cart } from './cart.ts'
import { Newsletter } from './newsletter.ts'
import { Search } from './search.ts'
import { AccountMenu } from './accountmenu.ts'
import { Reviews } from './reviews.ts'
import { ProductDetails } from './productdetails.ts'
import { Filters } from './filters.ts'

// Every component type the app owns is referenced here so none is tree-shaken away — a real
// full-hydration app's root bundle contains its whole component library, whether or not a given
// page renders it. Only the ones this page actually renders are mounted.
const ALL = [LikeButton, Cart, Newsletter, Search, AccountMenu, Reviews, ProductDetails, Filters]
if ((globalThis as unknown as { __KEEP: unknown }).__KEEP === 'never') {
  // A real side effect (not a pure expression) so a bundler cannot tree-shake `ALL` away — never
  // actually reached, `__KEEP` is never `'never'`.
  ;(globalThis as unknown as { __KEEP_COUNT: number }).__KEEP_COUNT = ALL.length
}

hydrate(
  h('div', null, h(LikeButton, { key: 'LikeButton' }), h(Cart, { key: 'Cart' })),
  document.getElementById('app') as HTMLElement,
)
