import { render as renderPreactToString } from 'preact-render-to-string'
import type { VNode } from 'preact'
import { INITIAL_STATE_GLOBAL } from './initial-state-global.ts'
import { stringifyForWire } from './serialization-codec.ts'
import { buildDevClientScript } from '../dev/dev-client-script.ts'
import type { DevClientScriptOptions } from '../dev/dev-client-script.ts'
import { placeHeadMarkup } from './head-markup.ts'

/**
 * Options for {@linkcode renderToResponse} (Preact).
 *
 * Shaped differently from React's own `RenderToResponseOptions` (`render-to-response.tsx`) for one
 * structural reason: React 19 hoists head-level elements out of the tree, so that serializer can
 * take them as element-shaped options and render them as ordinary siblings, while Preact has no
 * hoisting and therefore takes the same content already serialized, as `headMarkup`, and places it
 * into the rendered document's `<head>` afterwards. Both describe the SAME document — see
 * `render/document-model.ts`, the renderer-agnostic model both serializers are driven from.
 *
 * An earlier version of this module instead had `render-page-preact.ts` thread `cssHrefs`/`pwaHead`
 * into the document-shell layer, which passed them to the app's own root `layout.tsx` as a
 * `headExtras` prop. That made the document's metadata depend on an app-authored component
 * cooperating, and silently produced pages with no head at all when it didn't. See
 * `head-markup.ts`'s own module doc.
 */
export type RenderToResponsePreactOptions = {
  /** Serialized once into a `<script>` that runs before hydration — same contract, same global
   * name (`INITIAL_STATE_GLOBAL`) as React's own `renderToResponse`. */
  initialState?: unknown
  /** Client entry module(s) to hydrate the page — rendered as `<script type="module" src="...">`
   * tags appended after `element`'s own markup. Unlike React's `renderToReadableStream` (which
   * emits these itself, mid-stream, via its own `bootstrapModules` option), `preact-render-to-string`
   * has no such mechanism — this function appends them by hand, after the fact, to the same
   * rendered string. */
  bootstrapModules?: string[]
  /** Applied to every `<script>` tag THIS function itself emits (the initial-state script, the
   * bootstrap module scripts) — same reasoning as React's own `nonce` option, but there is no
   * renderer-emitted script to auto-nonce here (Preact never emits one of its own), so this
   * function nonces its own output directly instead of forwarding the option to an underlying
   * streaming API. */
  nonce?: string
  /** `true` for a full document (prefixes `<!doctype html>`) — `false`/omitted for an Orbit
   * fragment response, which is never a standalone document. `preact-render-to-string` never adds
   * this itself (confirmed empirically — unlike `react-dom/server`, which does for an `<html>`
   * root), so the caller states its intent explicitly instead of this function guessing it from
   * `element`'s own root tag. */
  doctype?: boolean
  /** Called if rendering throws — Preact core has no streaming/recoverable-vs-fatal distinction
   * the way React 18/19 does (see `render-page-preact.ts`'s own doc): every error reaching this
   * function is fatal, so this fires at most once, immediately before the `500` response below. */
  onError?: (error: unknown) => void
  /** Dev-only client script options — from `isDevClientEnabled()`/`getPageTree()`, resolved by the
   * caller (`render-page-preact.ts`), same gate/shape React's own `RenderToResponseOptions.devClient`
   * uses. `undefined` outside of `znx space dev` — never present in a production build's own render
   * calls. Rendered as ONE `<script>` tag (`buildDevClientScript`'s own output, verbatim, reused
   * unchanged from React's own copy — the transport itself is renderer-agnostic, see
   * `dev-client-script.ts`'s own doc) — unlike React, Preact needs no separate preamble script here:
   * `@prefresh/vite`'s own Babel pass already injects its Fast-Refresh registration INLINE, per
   * transformed Comet module, not via a single global preamble (see `space-plugin.ts`'s own doc for
   * the full reasoning). What actually makes real Fast Refresh work end-to-end for a Preact page is
   * `dev-vite-hot-client.ts`'s own `/@vite/client` replacement — a separate HTTP response, not
   * something this function injects inline, and shared with React's own dev sessions too (see that
   * module's own doc — it was corrected from an earlier, wrongly Preact-scoped name). */
  devClient?: DevClientScriptOptions
  /**
   * This document's serialized head, from `serializeHeadMarkup()` (`render/head-markup.ts`) — the
   * resolved `<title>`/`<meta>`/`<link>`, stylesheet links, theme override and PWA manifest/
   * theme-color, already HTML.
   *
   * Placed inside the rendered document's own `<head>` by `placeHeadMarkup()` once `element` has
   * been serialized, rather than being rendered as part of the tree. That is not an implementation
   * detail of convenience: Preact has no head-hoisting, so tree-level rendering could only put these
   * where the tree happens to be, which previously meant depending on an app's own root layout to
   * accept and render a `headExtras` prop — and silently producing a document with no metadata at
   * all whenever it didn't. See `head-markup.ts`'s own module doc for the full reasoning, and
   * `placeHeadMarkup`'s for why the insertion point is the front of `<head>` rather than the end.
   *
   * Omitted (or empty) for an Orbit fragment response, which is not a document and has no `<head>`.
   */
  headMarkup?: string
  /**
   * Where the generated service worker is served, when this app has a PWA build output — rendered
   * as a small registration `<script>` alongside the other trailing scripts, just before `</body>`.
   *
   * Handled here rather than in the document shell for the same reason `headMarkup` is: it must
   * reach the document regardless of whether the app declares its own root layout. React's own
   * serializer renders the equivalent script inside the tree, where its hoisting makes tree position
   * irrelevant; this is the Preact-side equivalent, landing at the same semantic position in the
   * final document.
   */
  serviceWorkerHref?: string
}

/**
 * Renders a Preact vnode tree to an HTML `Response` — the Preact counterpart to
 * `render-to-response.tsx`'s `renderToResponse`, registered (indirectly, via `render-page-preact.ts`)
 * as this package's SSR entry point whenever `--renderer=preact` is active.
 *
 * Deliberately synchronous and unstreamed — `preact-render-to-string`'s plain `render()`, not
 * `renderToStringAsync`/`preact-render-to-string/stream`: this package's own decision spike found
 * no `Suspense`/`lazy`/`use()` in Preact core at all (confirmed by direct inspection, not assumed),
 * so there is no boundary a streaming renderer would have anything to stream AROUND — adopting a
 * streaming API here would add real complexity for zero behavioral benefit under this renderer's
 * own contract (no suspending components, ever). No `RequestCacheProvider`-equivalent wraps the
 * tree either, for the same reason: `useRequestCache` is rejected outright under this renderer (see
 * `request-cache.tsx`'s own guard), so there is nothing for a provider to serve.
 *
 * @param element - The tree to render — typically a page's already-composed element chain (see
 * `render-page-preact.ts`'s own `composeSegments`).
 * @param options - See {@linkcode RenderToResponsePreactOptions}.
 * @returns A `Response`. `200` with the fully-rendered HTML normally; any render error yields an
 * empty-bodied `500` instead — always resolves, never throws, same documented contract as React's
 * own `renderToResponse`.
 */
export function renderToResponse(
  // `VNode<any>` — a real, structural TypeScript limit, not a shortcut: `VNode<P>`'s own
  // `type: ComponentType<P>` field makes `P` appear CONTRAVARIANTLY (a component class's
  // constructor takes `props: P`), so `VNode<Specific>` (whatever `render-page-preact.ts`'s own
  // `composeSegments` produced) is only ever assignable to `VNode<X>` when `X` itself is assignable
  // TO `Specific` — no non-`any` supertype satisfies that across every possible caller. Confirmed
  // empirically before landing on this, not assumed.
  // deno-lint-ignore no-explicit-any
  element: VNode<any>,
  options: RenderToResponsePreactOptions = {},
): Response {
  const {
    initialState,
    bootstrapModules,
    nonce,
    doctype,
    onError,
    devClient,
    headMarkup,
    serviceWorkerHref,
  } = options

  // Computed BEFORE `renderPreactToString` runs, in its own try/catch — same fail-fast ordering
  // and same externally observable contract as `renderToResponse` (React)'s own identical fix: a
  // `JSON.stringify` failure (a circular `initialState`, a `BigInt` anywhere inside it) is a
  // serialization failure, not a render failure, but neither function's own documented "always
  // resolves, never throws" contract distinguishes the two — both now resolve gracefully with a
  // reported `onError` and a `500`, and neither wastes a real render pass on an `initialState`
  // that was never going to serialize. See `initial-state-global.ts`'s own module doc for the
  // full serialization contract this participates in (supported types, exact behavior for every
  // unsupported one).
  let serializedInitialState: string | undefined
  if (initialState !== undefined) {
    try {
      // `<` escaped to `<` in the serialized payload — real bug found and fixed during this
      // package's own Etapa 4 hardening pass: unlike this function, React's own `renderToResponse`
      // never builds this script tag by hand — it forwards the raw string to
      // `renderToReadableStream`'s own `bootstrapScriptContent` option, which React itself escapes
      // internally before embedding (confirmed empirically: a value containing a literal
      // `</script>` comes back out as `</script>` in React's real rendered output). This
      // function DOES build the tag by hand, so without this same escaping, a page whose
      // `initialState` includes untrusted content (e.g. a loader echoing a user-submitted string)
      // containing `</script>` could break out of this script tag and inject arbitrary HTML — a
      // real, exploitable gap that only existed on the Preact side. Escaping every `<` (not just
      // the exact `</script>` sequence) matches the broader, standard mitigation (e.g. the
      // `serialize-javascript` package's own approach) and is a no-op for any `initialState` that
      // never contained one.
      serializedInitialState = stringifyForWire(initialState)?.replace(/</g, '\\u003c')
    } catch (error) {
      onError?.(error)
      return new Response(null, { status: 500 })
    }
  }

  let html: string
  try {
    html = renderPreactToString(element)
  } catch (error) {
    onError?.(error)
    return new Response(null, { status: 500 })
  }

  const nonceAttr = nonce ? ` nonce="${nonce}"` : ''
  const initialStateScript = initialState === undefined
    ? ''
    : `<script${nonceAttr}>self.${INITIAL_STATE_GLOBAL}=${serializedInitialState}</script>`
  const bootstrapScripts = (bootstrapModules ?? [])
    .map((src) => `<script type="module"${nonceAttr} src="${src}"></script>`)
    .join('')
  // No preamble script here, unlike React's own `renderToResponse` — see
  // `RenderToResponsePreactOptions.devClient`'s own doc for why Preact needs none.
  const devClientScript = devClient
    ? `<script${nonceAttr}>${buildDevClientScript(devClient)}</script>`
    : ''
  // Nonced explicitly, like every other script this function builds by hand — there is no renderer
  // that would apply one automatically here (see this function's own `nonce` option doc).
  const serviceWorkerScript = serviceWorkerHref
    ? `<script${nonceAttr}>if('serviceWorker' in navigator){navigator.serviceWorker.register(${
      JSON.stringify(serviceWorkerHref)
    })}</script>`
    : ''
  const trailingScripts =
    `${initialStateScript}${bootstrapScripts}${devClientScript}${serviceWorkerScript}`

  // Inserted just before `</body>` (real HTML placement, not appended after `</html>`) whenever
  // `element` rendered one — a full document always does (`document-shell-preact.ts`'s own shell,
  // or a trusted custom root layout); an Orbit fragment (`fragmentOnly`, no `<body>` of its own)
  // never carries these scripts in the first place (see this function's own doc), so the fallback
  // below is defensive, not an expected path.
  const htmlWithScripts = trailingScripts
    ? html.includes('</body>')
      ? html.replace('</body>', `${trailingScripts}</body>`)
      : html + trailingScripts
    : html

  // After the scripts, not before — `placeHeadMarkup` targets the FIRST opening `<head>` tag, and
  // the script placement above only ever touches `</body>`, so the two never interfere. Ordering
  // them this way keeps each step operating on exactly the document the other produced.
  const htmlWithHead = headMarkup ? placeHeadMarkup(htmlWithScripts, headMarkup) : htmlWithScripts

  const body = `${doctype ? '<!doctype html>' : ''}${htmlWithHead}`
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  })
}
