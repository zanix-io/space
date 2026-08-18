/**
 * The renderer-agnostic description of a full HTML document — everything `@zanix/space` itself
 * decides about a response, with the one exception it cannot decide: the component tree, which is a
 * React element under `--renderer=react` and a Preact vnode under `--renderer=preact` and has no
 * shared type.
 *
 * **Why this exists.** Before it, each renderer independently decided how the resolved head reached
 * the document, and the two answers were not equivalent: React 19 hoists a `<title>`/`<meta>`/
 * `<link>` rendered anywhere in the tree into the real `<head>`, so `render-to-response.tsx` could
 * emit them as plain siblings; Preact has no hoisting at all, so `document-shell-preact.ts` passed
 * them to the root layout as a `headExtras` prop and depended on that layout to render them. The
 * consequence was a real, silent divergence: the SAME `page.tsx` + `layout.tsx` + `head` produced a
 * document WITH the resolved head under React and a document with NO head at all under Preact,
 * whenever the app declared its own root layout (the common case) and that layout did not happen to
 * destructure a prop that was not even part of the public `LayoutProps` type. Head management is not
 * a renderer feature — it is a property of the document this framework promises to produce — so it
 * belongs here, resolved once, and each renderer's own module is reduced to serializing it.
 *
 * **The contract, stated once for every renderer:** given the same page, the same layout chain and
 * the same resolved data, every serializer must produce a document with the same semantics — the
 * same `<title>`, the same `<meta>`/`<link>` set, the same `lang`, the same stylesheet links, the
 * same PWA contribution. Byte-for-byte equality is explicitly NOT the contract: `preact-render-to-string`
 * and `react-dom/server` legitimately differ in attribute order, boolean-attribute spelling and
 * whitespace. What is asserted, in `@tests/functional/render/document-parity.test.tsx`, is the
 * extracted semantics, not the string.
 *
 * **PWA is not a renderer, and not a third document shape.** It is an orthogonal capability: the
 * real matrix is `renderer ∈ {react, preact}` × `pwa ∈ {on, off}`, four combinations, and a PWA app
 * has no shell of its own — it contributes `<link rel="manifest">`, a `theme-color` `<meta>` and a
 * service-worker registration script to whichever renderer's shell is already active. That
 * contribution is {@linkcode DocumentPwa} below, one field of this model like any other, which is
 * exactly why no rule or test in this package ever needs a "PWA renderer" to exist.
 *
 * @module
 */
import type { HeadLinkTag, HeadMetaTag } from '../router/head-descriptor.ts'
import type { ResolvedHead } from '../router/head-descriptor.ts'
import type { StylesheetRef } from './css-manifest.ts'
import type { DevClientScriptOptions } from '../dev/dev-client-script.ts'

/**
 * A PWA app's own contribution to the document — produced by `resolvePwaHead()`
 * (`pwa/pwa-registry.ts`), `undefined` for an app that never configured `pwa` at all.
 *
 * Deliberately shaped as data rather than as markup: each serializer renders it with its own
 * renderer's primitives (React hoists the `<link>`/`<meta>` from anywhere in the tree; Preact's
 * shell places them literally inside its own `<head>`), but neither decides *what* it contains.
 */
export type DocumentPwa = {
  /** Where the Web App Manifest is served — a fixed route, never configurable (see
   * `MANIFEST_ROUTE`, `pwa/web-manifest.ts`). */
  manifestHref: string
  /** Rendered as `<meta name="theme-color">`. Omitted when `PwaConfig.themeColor` was not set. */
  themeColor?: string
  /** Where the generated service worker is served. `undefined` until `loadPwaBuildOutput()` has been
   * called with a real build output directory — in that case no registration script is rendered at
   * all, rather than one pointing at a file that was never built. */
  serviceWorkerHref?: string
}

/**
 * Everything about a full-document response except the component tree itself.
 *
 * Built once per request by `render-page-react.tsx`/`render-page-preact.ts` (both call the same
 * resolution helpers to do it), then handed to that renderer's own serializer. Never built for an
 * Orbit fragment response: a fragment is not a document, carries no `<head>`, and is only ever
 * inserted into a page that already has all of this in effect.
 */
export type DocumentModel = {
  /**
   * The document's language, for `<html lang>`.
   *
   * Only ever consumed by this package's own default document shell — an app that declares its own
   * root `layout.tsx` renders `<html>` itself and therefore owns this attribute directly, in both
   * renderers. Defaults to `'en'` at the shell, preserving the exact behavior both default shells
   * had when the value was hardcoded in each of them separately.
   */
  lang?: string
  /**
   * The fully-resolved `<title>`/`<meta>`/`<link>` set — already merged across this page's own
   * `SpacePageController.head` and every `layout.tsx` in its chain, already deduplicated, already
   * ordered (see `resolveHead`, `router/head-descriptor.ts`). A serializer never merges, dedupes or
   * reorders any of this; it only renders it.
   */
  head: ResolvedHead
  /**
   * GLOBAL- and page-scope stylesheet refs to link into the document, in cascade order (global
   * first, then this page's own). A Comet's own CSS is never here — it renders at that Comet's own
   * tree position, from `defineComet` itself.
   */
  cssHrefs: StylesheetRef[]
  /** This request's own resolved design-token overrides — a complete, sanitized `:root{...}` rule
   * string from `serializeThemeStyle()`, or `undefined` when no theme resolver is configured.
   * Rendered after `cssHrefs` so document order lets it override the static stylesheet's own token
   * declarations. */
  themeStyle?: string
  /** See {@linkcode DocumentPwa}. `undefined` for an app with no `pwa` configured. */
  pwa?: DocumentPwa
  /** The per-request CSP nonce, when a nonce-based policy is in effect — applied to every
   * `<script>`/`<style>` this framework itself emits. `undefined` when CSP is disabled for this
   * page, or a custom static policy (no nonce coordination) is set. */
  nonce?: string
  /** Serialized into a `<script>` that runs before hydration, read back on the client via
   * `readInitialState()`. `undefined` when this render has no state to hand off. */
  initialState?: unknown
  /** Client entry module(s) that hydrate the page, as plain module URLs. */
  bootstrapModules?: string[]
  /** Dev-only client script options. `undefined` outside `znx space dev` — never present in a
   * production render. */
  devClient?: DevClientScriptOptions
}

/**
 * The document semantics every serializer must agree on — what
 * `@tests/functional/render/document-parity.test.tsx` extracts from each renderer's real HTML
 * output and compares, instead of comparing the HTML strings themselves.
 *
 * Deliberately a small, flat, comparable shape: two documents are equivalent when these values are
 * equal, regardless of how each renderer spelled them. `h1Count` is included because it is
 * genuinely useful to assert parity ON — a fixture rendering one `<h1>` must render exactly one
 * under either renderer — but note that this is a statement about the two renderers agreeing, NOT a
 * statement that a document needs an `<h1>` to be valid. `@zanix/space` has no such requirement:
 * the presence of a heading is a scaffolding convention of `zanix generate page` and, separately, a
 * non-normative build diagnostic — never part of the document contract.
 */
export type DocumentSemantics = {
  /** Every `<title>` in the document, in order. A conforming document has exactly one. */
  titles: string[]
  /** `<meta>` tags keyed by identity (`name:x`/`property:x`/`httpEquiv:x`) → `content`. */
  meta: Record<string, string>
  /** `<link>` tags as `rel|href|hreflang` triples, in document order. */
  links: Array<{ rel: string; href: string; hreflang?: string }>
  /** The `lang` attribute on `<html>`, or `undefined` if absent. */
  lang?: string
  /** Whether the document declares `<!doctype html>`, an `<html>` element and a `<body>` element. */
  isDocument: boolean
  /** Whether a `<meta charset>` is present. Note that this framework always ALSO declares the
   * encoding at the protocol level, via the `content-type` response header, which is what actually
   * satisfies the HTML Standard's encoding-declaration requirement. */
  hasMetaCharset: boolean
  /** The `content` of `<meta name="viewport">`, or `undefined` if absent. */
  viewport?: string
  /** Number of `<h1>` elements. See this type's own doc on why this is a parity signal and not a
   * validity requirement. */
  h1Count: number
  /** Visible text content of the body, collapsed — used to assert that SSR actually emitted
   * content, not that the content is any good. */
  hasTextContent: boolean
}

/** Re-exported so a consumer of {@linkcode DocumentModel} never has to reach into
 * `router/head-descriptor.ts` separately for the shapes its own `head` field is made of. */
export type { HeadLinkTag, HeadMetaTag, ResolvedHead }
