/** Produces each variant's full SSR HTML document — called ONCE per variant, sequentially, BEFORE
 * any server starts (see `run.ts`'s own doc for why: `setCometManifest`/`setActiveRenderer` are
 * real, process-wide globals in the actual Space source, so rendering every variant up front, one
 * at a time, into a plain string avoids any cross-variant race once servers start answering
 * concurrent requests — each server below only ever serves an already-computed, static string). */
import { createElement as reactElement } from 'react'
import type { ComponentType as ReactComponentType } from 'react'
import { renderToReadableStream } from 'react-dom/server'
import { createElement as preactElement } from 'preact'
import type { ComponentType as PreactComponentType } from 'preact'
import { renderToResponse as renderToResponseReact } from 'modules/render/render-to-response.tsx'
import { renderToResponse as renderToResponsePreact } from 'modules/render/render-to-response-preact.ts'
// Both renderer runtimes, called PER VARIANT below rather than installed once here. A real app
// imports exactly one of these from its own main module; this harness composes its documents by
// hand (to stay symmetric across variants A–D), never reaches `defineSpaceApp`, and renders React
// AND Preact in the same process — so it installs whichever one the variant about to run needs.
//
// Per variant matters: installing a renderer replaces the page/not-found renderer wholesale (one
// renderer per app). The Comet element factory is kept per renderer instead, so both stay
// registered regardless of order, which is what lets `defineComet` render in variants B/C (React)
// and D (Preact) within a single run. Without this, `getCometElementFactory()` throws for
// whichever renderer isn't registered — a loud failure, not a silent empty-markup one, and every
// Comet boundary disappears from the render as a result.
import { installReactRuntime } from '../../../../../mod-react.ts'
import { installPreactRuntime } from '../../../../../mod-preact.ts'
import { setCometManifest } from 'modules/comets/comet-manifest.ts'
import { setActiveRenderer } from 'modules/router/active-renderer.ts'
import type { Product } from '../scenario/data.ts'
import { Page as ReactPage } from '../scenario/react/page.tsx'
import { LikeButton as ReactLikeButton } from '../scenario/react/like-button.tsx'
import { Newsletter as ReactNewsletter } from '../scenario/react/newsletter.tsx'
import { Cart as ReactCart } from '../scenario/react/cart.tsx'
import { Page as PreactPage } from '../scenario/preact/page.ts'

async function drain(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let out = ''
  // deno-lint-ignore no-await-in-loop -- a real sequential stream drain
  for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
    out += decoder.decode(chunk.value, { stream: true })
  }
  return out
}

/** Variant A — plain React SSR (`renderToReadableStream` directly, no Space involved at all),
 * `Page` composed with the PLAIN (non-Comet) component bodies. `products` is embedded verbatim for
 * the client entry to read (see that file's own doc). */
export async function renderVariantA(
  products: Product[],
  clientEntryAssetUrl: string,
): Promise<string> {
  const body = await drain(
    await renderToReadableStream(
      reactElement(ReactPage, {
        products,
        components: { LikeButton: ReactLikeButton, Newsletter: ReactNewsletter, Cart: ReactCart },
      }),
    ),
  )
  return `<!doctype html><html><head><title>Variant A — full hydration</title></head><body>` +
    `<div id="app">${body}</div>` +
    `<script>window.__BENCH_PRODUCTS__=${JSON.stringify(products)}</script>` +
    `<script type="module" src="${clientEntryAssetUrl}"></script>` +
    `</body></html>`
}

/** Variants B/C — real Space React SSR (`renderToResponse`), `Page` composed with `defineComet`-
 * wrapped components. Identical code path for B and C — the only difference between them is which
 * `comets-manifest.json`/build output `manifestPath` points at (built with or without Compiler by
 * `build-comets-client.ts`), never anything rendered here. */
export async function renderVariantReactComets(
  products: Product[],
  manifestPath: string,
  clientEntryAssetUrl: string,
  // `ReactComponentType<any>`, not the real prop shape — `defineComet`'s own return type is
  // `ComponentType<P & CometProps>`, which for a no-props component (`Newsletter`) doesn't
  // structurally satisfy `ComponentType<Record<string, never>>` (a real TS strictness gap around
  // `defaultProps`, not a runtime one) — this stays loose on purpose rather than fighting that.
  // deno-lint-ignore no-explicit-any -- see the reasoning comment above these params
  ReactLikeButtonComet: ReactComponentType<any>,
  // deno-lint-ignore no-explicit-any -- see the reasoning comment above these params
  ReactNewsletterComet: ReactComponentType<any>,
  // deno-lint-ignore no-explicit-any -- see the reasoning comment above these params
  ReactCartComet: ReactComponentType<any>,
): Promise<string> {
  installReactRuntime()
  setActiveRenderer('react')
  const manifest = JSON.parse(await Deno.readTextFile(manifestPath))
  setCometManifest(manifest)
  try {
    const response = await renderToResponseReact(
      reactElement(
        'html',
        { lang: 'en' },
        reactElement('head', null, reactElement('title', null, 'Variant — Comets')),
        reactElement(
          'body',
          null,
          reactElement(ReactPage, {
            products,
            components: {
              LikeButton: ReactLikeButtonComet,
              Newsletter: ReactNewsletterComet,
              Cart: ReactCartComet,
            },
          }),
        ),
      ),
      { bootstrapModules: [clientEntryAssetUrl] },
    )
    return await response.text()
  } finally {
    setCometManifest(undefined)
  }
}

/** Variant D — real Space Preact SSR, `Page` composed with `defineComet`-wrapped Preact
 * components. */
export async function renderVariantPreactComets(
  products: Product[],
  manifestPath: string,
  clientEntryAssetUrl: string,
  // Same reasoning as `renderVariantReactComets`'s own params above (a no-props comet doesn't
  // structurally satisfy `ComponentType<Record<string, never>>`, a TS strictness gap around
  // `defaultProps`). Nothing renderer-related is involved any more: `defineComet` returns a
  // renderer-neutral boundary component, so a Preact comet arrives here as a real Preact component
  // and needs no bridging cast at the `preactElement(...)` call sites below.
  // deno-lint-ignore no-explicit-any -- see the reasoning comment above these params
  PreactLikeButtonComet: PreactComponentType<any>,
  // deno-lint-ignore no-explicit-any -- see the reasoning comment above these params
  PreactNewsletterComet: PreactComponentType<any>,
  // deno-lint-ignore no-explicit-any -- see the reasoning comment above these params
  PreactCartComet: PreactComponentType<any>,
): Promise<string> {
  installPreactRuntime()
  setActiveRenderer('preact')
  const manifest = JSON.parse(await Deno.readTextFile(manifestPath))
  setCometManifest(manifest)
  try {
    const element = preactElement(
      'html',
      { lang: 'en' },
      preactElement('head', null, preactElement('title', null, 'Variant D — Preact + Comets')),
      preactElement(
        'body',
        null,
        preactElement(PreactPage, {
          products,
          components: {
            LikeButton: PreactLikeButtonComet,
            Newsletter: PreactNewsletterComet,
            Cart: PreactCartComet,
          },
        }),
      ),
    )
    const response = renderToResponsePreact(element, {
      doctype: true,
      bootstrapModules: [clientEntryAssetUrl],
    })
    return await response.text()
  } finally {
    setCometManifest(undefined)
    // Back to React, runtime included: the variants run sequentially and the React ones follow.
    installReactRuntime()
    setActiveRenderer('react')
  }
}
