/// <reference lib="dom" />
import { hydrateRoot } from 'react-dom/client'
import { Page } from './page.tsx'
import { LikeButton } from './like-button.tsx'
import { Newsletter } from './newsletter.tsx'
import { Cart } from './cart.tsx'
import type { Product } from '../data.ts'

/**
 * Variant A's own client entry — deliberately outside Space entirely (no `hydrateComets`, no
 * Comet markers): imports the SAME plain component bodies `LikeButton`/`Newsletter`/`Cart` used
 * inside the real Comets (variants B/C/D wrap these exact same files in `defineComet`) and
 * hydrates the WHOLE page tree in one `hydrateRoot` call, into a plain `<div id="app">` the
 * server shell wraps `Page`'s own SSR output in — this is the "full client hydration" baseline
 * this whole benchmark measures the Comets architecture against. `products` crosses the
 * server/client boundary via the same plain-JSON `<script>` convention Space's own
 * `initial-state-global.ts` documents, read here by hand since this variant never goes through
 * `renderToResponse` at all.
 */
declare global {
  var __BENCH_PRODUCTS__: Product[]
}

const products = globalThis.__BENCH_PRODUCTS__
const root = document.getElementById('app')
if (root) {
  hydrateRoot(
    root,
    <Page products={products} components={{ LikeButton, Newsletter, Cart }} />,
  )
}
