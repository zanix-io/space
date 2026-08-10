import { renderToReadableStream } from 'react-dom/server'
import type { ReactElement } from 'react'
import { RequestCacheProvider } from './request-cache.tsx'
import type { RequestCache } from './request-cache.tsx'
import { INITIAL_STATE_GLOBAL } from './initial-state-global.ts'
import { buildDevClientScript } from '../dev/dev-client-script.ts'
import type { DevClientScriptOptions } from '../dev/dev-client-script.ts'
import { buildFastRefreshPreambleScript } from '../dev/dev-fast-refresh-preamble.ts'

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
  /** Stylesheet URLs to link into the document — from {@linkcode getCssManifest}, resolved by the
   * caller (never read from here directly, so a fragment-only Orbit response can omit it: its
   * stylesheets are already loaded on the page it's swapping into). Rendered as
   * `<link rel="stylesheet" precedence="space">` elements anywhere in the tree — React 19 hoists
   * them into `<head>` regardless of where the actual `<head>` element lives (the default shell's
   * or a root layout's own), the same mechanism already relied on for `<title>`/`<meta>` hoisting. */
  cssHrefs?: string[]
  /** Web App Manifest link + theme-color meta to inject — from `getPwaConfig()`, resolved by the
   * caller (never read from here directly, so a fragment-only Orbit response can omit it: it's
   * page-independent, already in effect from the first full-document load). Rendered as
   * `<link rel="manifest">`/`<meta name="theme-color">` anywhere in the tree, hoisted into `<head>`
   * the same way `cssHrefs` already is. */
  pwaHead?: { manifestHref: string; themeColor?: string; serviceWorkerHref?: string }
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
  const { initialState, bootstrapModules, nonce, cssHrefs, pwaHead, devClient, onError } = options
  const cache: RequestCache = new Map()
  let onErrorCalled = false

  const tree = (
    <RequestCacheProvider cache={cache}>
      {cssHrefs?.map((href) => <link key={href} rel='stylesheet' href={href} precedence='space' />)}
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
            dangerouslySetInnerHTML={{ __html: buildFastRefreshPreambleScript() }}
          />
          {
            // Same `nonce` reasoning as the PWA service-worker registration script above — an
            // author-rendered `<script>` needs it set explicitly, `renderToReadableStream`'s own
            // `nonce` option never applies to it automatically.
          }
          <script
            nonce={nonce}
            // deno-lint-ignore react-no-danger
            dangerouslySetInnerHTML={{ __html: buildDevClientScript(devClient) }}
          />
        </>
      )}
      {element}
    </RequestCacheProvider>
  )

  try {
    const stream = await renderToReadableStream(
      tree,
      {
        bootstrapModules,
        nonce,
        bootstrapScriptContent: initialState === undefined
          ? undefined
          : `self.${INITIAL_STATE_GLOBAL}=${JSON.stringify(initialState)}`,
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
