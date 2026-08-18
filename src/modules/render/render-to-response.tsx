import { renderToReadableStream } from 'react-dom/server'
import type { ReactElement } from 'react'
import { RequestCacheProvider } from './request-cache.tsx'
import type { RequestCache } from './request-cache.tsx'
import { INITIAL_STATE_GLOBAL } from './initial-state-global.ts'
import { stringifyForWire } from './serialization-codec.ts'
import { buildDevClientScript } from '../dev/dev-client-script.ts'
import type { DevClientScriptOptions } from '../dev/dev-client-script.ts'
import { buildFastRefreshPreambleScript } from '../dev/dev-fast-refresh-preamble.ts'
import type { HeadLinkTag, HeadMetaTag } from '../router/head-descriptor.ts'
import { linkIdentityKey, metaIdentityKey } from '../router/head-descriptor.ts'
import type { StylesheetRef } from './css-manifest.ts'

/**
 * Options for {@linkcode renderToResponse}.
 *
 * `bootstrapModules` is deliberately typed as `string[]` — a narrower, hand-written shape,
 * NOT a reference into `react-dom/server`'s own `RenderToReadableStreamOptions['bootstrapModules']`
 * (which additionally accepts `BootstrapScriptDescriptor` objects). Referencing that npm-sourced
 * type directly pulled its entire transitive type graph (including untyped-for-this-purpose
 * `@types/react-dom` internals) into this package's own public documentation surface, which
 * `deno doc --lint` then demanded full JSDoc for — a real, structural mismatch between vendor
 * `.d.ts` files and JSR's doc-completeness bar, not something worth chasing. The plain-URL case
 * this narrower type covers is the one `@zanix/space` itself needs.
 */
export type RenderToResponseOptions = {
  /** Serialized once into a `<script>` that runs before hydration — read back on the client via
   * {@linkcode readInitialState}. Omit if this render has no state to hand off. Must be
   * JSON-serializable. */
  initialState?: unknown
  /** Forwarded as-is to `renderToReadableStream` as plain module URLs — the client entry
   * module(s) that hydrate the page. */
  bootstrapModules?: string[]
  /** Forwarded as-is to `renderToReadableStream`'s own `nonce` option — applied to every `<script>`
   * tag React itself emits (the initial-state script above, and any streaming-boundary script).
   * Needed to keep a strict `script-src` (no `'unsafe-inline'`) from blocking those scripts; see
   * `cspGuard`'s nonce-generating form, which is what `SpacePageController` sources this from. */
  nonce?: string
  /** GLOBAL-scope stylesheet refs to link into the document — from `resolveCssHrefs()`, resolved by
   * the caller (never read from here directly, so a fragment-only Orbit response can omit it: its
   * stylesheets are already loaded on the page it's swapping into). A comet's own CSS is never part
   * of this list — it's rendered separately, at that comet's own tree position, by `defineComet`
   * itself (see that module's own doc for why). A plain `string` renders
   * `<link rel="stylesheet" href precedence="space">`; `{href, media}` additionally sets `media` —
   * either way, React 19 hoists the element into `<head>` regardless of where the actual `<head>`
   * lives, the same mechanism already relied on for `<title>`/`<meta>` hoisting. */
  cssHrefs?: StylesheetRef[]
  /** This request's own resolved design-token overrides — from `serializeThemeStyle()`
   * (`theme/theme-style.ts`), already a complete, sanitized `:root{...}` rule string, resolved by
   * the caller (never read from here directly, so a fragment-only Orbit response can omit it: it's
   * already in effect on the page it's swapping into, same reasoning as `cssHrefs`/`pwaHead`).
   * Rendered as a PLAIN `<style nonce={nonce}>` — deliberately NOT given a `precedence` prop the way
   * `cssHrefs`' `<link>`s are: confirmed empirically that React 19 silently drops a manually-set
   * `nonce` prop on a `precedence`-managed `<style>` tag (it wants the nonce via
   * `renderToReadableStream`'s own render option instead, which this function already reserves for
   * the bootstrap script — mixing the two isn't supported). A plain `<style>` isn't hoisted into
   * `<head>` the way a `precedence`d one is — it renders at its own literal tree position — but CSS
   * cascade order for equal-specificity `:root` rules is determined by DOCUMENT order, not by
   * whether the containing element happens to be inside `<head>` vs `<body>`: rendered AFTER
   * `cssHrefs` below, this still correctly overrides the static stylesheet's own token declarations
   * regardless of where in the DOM it physically ends up. */
  themeStyle?: string
  /** Web App Manifest link + theme-color meta to inject — from `getPwaConfig()`, resolved by the
   * caller (never read from here directly, so a fragment-only Orbit response can omit it: it's
   * page-independent, already in effect from the first full-document load). Rendered as
   * `<link rel="manifest">`/`<meta name="theme-color">` anywhere in the tree, hoisted into `<head>`
   * the same way `cssHrefs` already is. */
  pwaHead?: {
    manifestHref: string
    themeColor?: string
    serviceWorkerHref?: string
  }
  /** This page's own resolved `<title>` — from `resolveHead()` (`router/head-descriptor.ts`),
   * already merged across the page's own `SpacePageController.head` and its whole layout chain by
   * the caller (never read from here directly, same reasoning as `cssHrefs`/`pwaHead`). Rendered as
   * a real `<title>` element, positioned BEFORE `element` in this function's own tree — hoisted
   * into `<head>` by React 19 like `cssHrefs`/`pwaHead` already are. Confirmed empirically (a real
   * `renderToReadableStream` render, not assumed) that this positioning is what makes it the
   * document's FIRST `<title>` element, and therefore `document.title` per the HTML Living
   * Standard, even when an author separately renders their own `<title>` deeper in `element` — see
   * `head-descriptor.ts`'s own doc for the full coexistence contract with hand-authored JSX. */
  title?: string
  /** This page's own resolved `<meta>` tags — same resolution/positioning contract as `title`
   * above. */
  meta?: HeadMetaTag[]
  /** This page's own resolved `<link>` tags — same resolution/positioning contract as `title`
   * above. Never includes `cssHrefs`' own stylesheet links (a separate, deliberately independent
   * mechanism — see `cssHrefs`'s own doc for why it stays on React's `precedence`-based resource
   * dedup instead). */
  link?: HeadLinkTag[]
  /** Dev-only client script options — from `isDevClientEnabled()`/`getPageTree()`, resolved by
   * the caller (never read from here directly, same reasoning as `cssHrefs`/`pwaHead`: a
   * fragment-only Orbit response omits it, since the full document it's swapping into already has
   * its own connection). `undefined` outside of `znx space dev` — never present in a production
   * build's own render calls. Rendered as two `<script>` tags (both nonced, like the PWA
   * service-worker registration script above): the React Fast Refresh preamble
   * ({@linkcode buildFastRefreshPreambleScript}, `type="module"`, registers
   * `window.$RefreshReg$`/`$RefreshSig$` before any Comet's own code runs), then
   * {@linkcode buildDevClientScript}'s own output verbatim — same gate, since `zanix space dev` is
   * the only place either is ever needed. */
  devClient?: DevClientScriptOptions
  /** Called for every render error, recoverable (inside a Suspense boundary) or fatal (in the
   * shell) — a fatal error still makes this function resolve with a 500 `Response`, it does not
   * reject; use this callback to log/report it. */
  onError?: (error: unknown) => void
}

/**
 * Renders a React element tree to a streamed HTML `Response` — the framework's one SSR entry
 * point. Always renders via `react-dom/server`'s `renderToReadableStream` (Web Streams), never the
 * Node-stream `renderToPipeableStream` — Deno's own `"deno"` export condition already resolves
 * `react-dom/server` to the Web-Streams build, so no adapter is needed to turn its output into a
 * `Response`.
 *
 * The returned element tree is always wrapped in a {@linkcode RequestCacheProvider}, so any
 * component under `element` can call `useRequestCache()` without the caller wiring that up itself.
 *
 * @param element - The tree to render — typically a page's `component`, already wrapped in
 * whatever layouts apply to it (layout composition is Router's responsibility, a later milestone;
 * this function only renders whatever tree it's given).
 * @param options - See {@linkcode RenderToResponseOptions}.
 * @returns A `Response`. `200` streaming `text/html` normally; a **recoverable** error (inside a
 * Suspense boundary) still streams the same `200` response with the fallback content in place —
 * only `onError` observes it. A **shell-breaking** error (outside any Suspense boundary) yields
 * an empty-bodied `500` instead, since React never produces a shell to stream in that case. Either
 * way, this function resolves — it never throws for an error `onError` could have reported.
 *
 * @example
 * ```tsx
 * const response = await renderToResponse(<ProductView product={product} />, {
 *   initialState: { product },
 *   bootstrapModules: ['/client/entry.js'],
 * })
 * ```
 */
export async function renderToResponse(
  element: ReactElement,
  options: RenderToResponseOptions = {},
): Promise<Response> {
  const {
    initialState,
    bootstrapModules,
    nonce,
    cssHrefs,
    themeStyle,
    pwaHead,
    title,
    meta,
    link,
    devClient,
    onError,
  } = options
  const cache: RequestCache = new Map()
  let onErrorCalled = false

  const tree = (
    <RequestCacheProvider cache={cache}>
      {
        // Rendered FIRST, before anything else this function emits (including `cssHrefs`/`pwaHead`)
        // and before `element` itself — this exact position is what `head-descriptor.ts`'s own
        // coexistence contract with hand-authored JSX relies on (confirmed empirically): React 19
        // hoists tags into `<head>` in ENCOUNTER order, so rendering these first is what makes them
        // the document's FIRST `<title>`/matching `<meta>`, deterministically, without touching
        // React's own hoisting or anything an author separately renders elsewhere in `element`.
      }
      {title && <title>{title}</title>}
      {
        // Keys come from `head-descriptor.ts`'s own identity functions — the SAME ones
        // `resolveHead` deduplicated these tags by — never a second, independently-computed shape.
        // See `linkIdentityKey`'s own doc for the real duplicate-key bug that drift caused on every
        // i18n page (an `x-default` hreflang entry legitimately shares its `href` with the default
        // language's entry, so a `rel:href` key collided for two tags that are deliberately
        // distinct). `metaIdentityKey` returns `undefined` for a tag declaring no
        // `name`/`property`/`httpEquiv` at all — a documented, supported case that `resolveHead`
        // never dedupes — so those fall back to a positional key rather than several tags sharing
        // one `undefined`.
      }
      {meta?.map((tag, index) => <meta key={metaIdentityKey(tag) ?? `meta-${index}`} {...tag} />)}
      {link?.map((tag) => <link key={linkIdentityKey(tag)} {...tag} />)}
      {cssHrefs?.map((ref) => {
        const href = typeof ref === 'string' ? ref : ref.href
        const media = typeof ref === 'string' ? undefined : ref.media
        return <link key={href} rel='stylesheet' href={href} media={media} precedence='space' />
      })}
      {
        // Rendered AFTER cssHrefs, deliberately — see `themeStyle`'s own doc for why document order
        // (not head/body position) is what makes this correctly override the static stylesheet's
        // own `:root` token declarations.
      }
      {themeStyle && <style nonce={nonce}>{themeStyle}</style>}
      {pwaHead && (
        <>
          <link rel='manifest' href={pwaHead.manifestHref} />
          {pwaHead.themeColor && <meta name='theme-color' content={pwaHead.themeColor} />}
          {pwaHead.serviceWorkerHref && (
            // `nonce` here is NOT auto-applied by `renderToReadableStream`'s own `nonce` option —
            // that only covers scripts React itself emits (the bootstrap script). An
            // author-rendered `<script>` like this one needs it set explicitly to survive a
            // strict `script-src` with no `'unsafe-inline'`.
            <script
              nonce={nonce}
              // deno-lint-ignore react-no-danger
              dangerouslySetInnerHTML={{
                __html: `if('serviceWorker' in navigator){navigator.serviceWorker.register(${
                  JSON.stringify(pwaHead.serviceWorkerHref)
                })}`,
              }}
            />
          )}
        </>
      )}
      {devClient && (
        <>
          {
            // `type="module"` — the preamble contains a real `import` statement, invalid inside a
            // classic script. Rendered BEFORE `bootstrapModules`' own emitted script tags (below,
            // via `renderToReadableStream`'s own option) so React Fast Refresh's globals
            // (`window.$RefreshReg$`/`$RefreshSig$`) are already registered before any Comet's own
            // code runs — module scripts execute in relative document order unless `async`, and
            // neither this one nor React's own bootstrap scripts are (see
            // `buildFastRefreshPreambleScript`'s own doc for the full reasoning).
          }
          <script
            type='module'
            nonce={nonce}
            // deno-lint-ignore react-no-danger
            dangerouslySetInnerHTML={{
              __html: buildFastRefreshPreambleScript(),
            }}
          />
          {
            // Same `nonce` reasoning as the PWA service-worker registration script above — an
            // author-rendered `<script>` needs it set explicitly, `renderToReadableStream`'s own
            // `nonce` option never applies to it automatically.
          }
          <script
            nonce={nonce}
            // deno-lint-ignore react-no-danger
            dangerouslySetInnerHTML={{
              __html: buildDevClientScript(devClient),
            }}
          />
        </>
      )}
      {element}
    </RequestCacheProvider>
  )

  // Computed BEFORE `renderToReadableStream` is ever called, in its own try/catch — a
  // `JSON.stringify` failure (a circular `initialState`, a `BigInt` anywhere inside it) is a
  // serialization failure, not a render failure, but this function's own documented contract
  // ("always resolves, never throws") doesn't distinguish the two: either one must still resolve
  // gracefully with a reported `onError` and a `500`. Failing here, before the render even starts,
  // also means a bad `initialState` never wastes a real render pass — same fail-fast behavior
  // `renderToResponse` (Preact)'s own copy of this fix uses, for the same externally observable
  // contract on both renderers. See `typings/comet.ts`'s own module doc for the full serialization
  // contract this participates in (supported types, exact behavior for every unsupported one).
  let bootstrapScriptContent: string | undefined
  if (initialState !== undefined) {
    try {
      // Encoded only when the app opted in — with the codec off this is the same string it has
      // always been. `readInitialState` decodes on the client; the script itself stays a bare
      // assignment either way. See `serialization-codec.ts`.
      bootstrapScriptContent = `self.${INITIAL_STATE_GLOBAL}=${stringifyForWire(initialState)}`
    } catch (error) {
      onError?.(error)
      return new Response(null, { status: 500 })
    }
  }

  try {
    const stream = await renderToReadableStream(
      tree,
      {
        bootstrapModules,
        nonce,
        bootstrapScriptContent,
        onError(error) {
          onErrorCalled = true
          onError?.(error)
        },
      },
    )

    // `renderToReadableStream`'s own `onError` fires for every error, recoverable or not — a
    // component caught by an error boundary (or a Suspense boundary that later settles) still
    // calls it, even though the render as a whole succeeds. The only reliable fatal-vs-recoverable
    // signal is whether this `await` itself rejects (see the `catch` below) — reaching this line at
    // all means it didn't, so the response is always `200` here regardless of `onErrorCalled`.
    return new Response(stream, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    })
  } catch (error) {
    // A shell-breaking error (thrown outside any Suspense/error boundary) rejects
    // `renderToReadableStream`'s own promise, in addition to (not instead of) calling `onError`
    // above — caught here so this function keeps its documented contract of always resolving,
    // never throwing. `onErrorCalled` being `true` at this point confirms the rejection came from
    // that render call (whose `onError` wrapper already reported it, so it is NOT re-reported
    // here); any other rejection reaching this catch is a bug elsewhere and is re-thrown as-is,
    // since fabricating a response for that would hide it.
    if (!onErrorCalled) throw error
    return new Response(null, { status: 500 })
  }
}
