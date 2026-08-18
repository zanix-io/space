/// <reference lib="dom" />
import { createElement as h } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { LikeButton } from './likebutton.tsx'
import { Cart } from './cart.tsx'
import { Newsletter } from './newsletter.tsx'
import { Search } from './search.tsx'
import { AccountMenu } from './accountmenu.tsx'
import { Reviews } from './reviews.tsx'
import { ProductDetails } from './productdetails.tsx'
import { Filters } from './filters.tsx'

// Every component type the app owns is referenced here so none is tree-shaken away — a real
// full-hydration app's root bundle contains its whole component library, whether or not a given
// page renders it. Only the ones this page actually renders are mounted.
const ALL = [LikeButton, Cart, Newsletter, Search, AccountMenu, Reviews, ProductDetails, Filters]
if ((globalThis as unknown as { __KEEP: unknown }).__KEEP === 'never') {
  // A real side effect (not a pure expression) so a bundler cannot tree-shake `ALL` away — never
  // actually reached, `__KEEP` is never `'never'`.
  ;(globalThis as unknown as { __KEEP_COUNT: number }).__KEEP_COUNT = ALL.length
}

hydrateRoot(
  document.getElementById('app') as HTMLElement,
  h('div', null, h(LikeButton, { key: 'LikeButton' }), h(Cart, { key: 'Cart' })),
)
