import { createElement } from 'preact'
import type { ComponentChildren, ComponentType, VNode } from 'preact'
import type { LayoutProps } from 'typings/page.ts'

/**
 * The document shell used when there's no root `layout.tsx` to provide one — Preact counterpart to
 * `document-shell.tsx`'s own `DefaultDocumentShell`, structurally identical to it: an `<html lang>`
 * with a `<head>` carrying the encoding and viewport declarations, and a `<body>` holding the page.
 *
 * **This component never places the resolved head, and neither does a custom root layout.** Preact
 * has no equivalent of React 19's hoisting, so threading `title`/`meta`/`link`/`cssHrefs`/`pwaHead`
 * through as a `headExtras` prop instead — to this shell when the app has no root layout of its own,
 * and to that layout when it does — would make the document's entire metadata conditional on an
 * app-authored component destructuring a prop that is not part of the public {@linkcode LayoutProps}
 * type: a root layout written from this package's own README (or produced by `zanix generate
 * layout`) would silently serve every page with no `<title>`, no canonical, no hreflang and no
 * stylesheet links — under Preact only, while the identical source produces a complete document
 * under React.
 *
 * Head placement instead happens once, after render, in `render-to-response-preact.ts` via
 * `placeHeadMarkup` (`render/head-markup.ts`) — the same string-level technique that module already
 * uses for its trailing scripts. A root layout is what it is under React: a component that owns the
 * document's structure, with no obligation toward its metadata.
 */
function DefaultDocumentShell(
  { children, lang }: { children: VNode; lang?: string },
  // `VNode<any>`, not `VNode`/`VNode<Record<string, unknown>>` — a real, structural TypeScript
  // limit, not a shortcut: `VNode<P>`'s own `type: ComponentType<P>` field makes `P` appear
  // CONTRAVARIANTLY (a component class's constructor takes `props: P`), so `VNode<Specific>` is
  // only ever assignable to `VNode<X>` when `X` itself is assignable TO `Specific` — no non-`any`
  // supertype (not even `{}`/`Record<string, unknown>`) satisfies that for the different concrete
  // prop shapes `createElement` produces below. Confirmed empirically before landing on this.
  // deno-lint-ignore no-explicit-any
): VNode<any> {
  return createElement(
    'html',
    { lang: lang ?? 'en' },
    createElement(
      'head',
      null,
      createElement('meta', { charSet: 'utf-8' }),
      createElement('meta', {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      }),
    ),
    createElement('body', null, children),
  )
}

/**
 * Wraps `content` in `RootLayout` if one was found (trusted to render `<html>`/`<body>` itself, the
 * same contract as React's own `applyDocumentShell` and as Next.js's App Router — nothing here
 * double-checks that it actually does; the build's own document validation reports it instead), or
 * in {@linkcode DefaultDocumentShell} when there isn't one.
 *
 * **Signature-identical to React's own `applyDocumentShell`, deliberately.** The two renderers now
 * make the same decision from the same inputs, and neither carries a parameter the other lacks —
 * which is what makes "the same page and layout produce the same document under either renderer" a
 * property of the code rather than a claim in a doc comment.
 *
 * @param RootLayout - The app's own root `layout.tsx` component, if `loadRoutes()` found one.
 * @param content - The tree to place inside it.
 * @param params - Forwarded to `RootLayout` as its own `params` prop; irrelevant (and omitted) for
 * the default shell, which never reads route params. Required rather than defaulted, unlike React's
 * own counterpart: a default parameter cannot precede an optional one, and `lang` below has to come
 * after it to keep the two renderers' argument order aligned.
 * @param lang - The document language for the default shell's own `<html lang>`. Ignored when a
 * custom `RootLayout` is present — that layout renders `<html>` itself and therefore owns the
 * attribute. Defaults to `'en'`, exactly what this shell hardcoded before the value was threaded.
 * @param data - `RootLayout`'s own resolved `loader` data (see `LayoutProps.data`'s own doc,
 * `typings/page.ts`) — `undefined` when it declares none, or for `createNotFoundHandler`'s own use
 * of this same root layout (see that type's own doc for why). Irrelevant for the default shell, same
 * as `params`. Added AFTER `lang`, not before it — every existing caller already passes `lang`
 * positionally at this 4th slot, and shifting it would break every one of them for a value they
 * don't even use (the default shell ignores `data` entirely).
 */
export function applyDocumentShell(
  RootLayout: ComponentType<LayoutProps<ComponentChildren>> | undefined,
  // `VNode<any>` — same structural reasoning as `DefaultDocumentShell`'s own return type above.
  // deno-lint-ignore no-explicit-any
  content: VNode<any>,
  params: Record<string, string>,
  lang?: string,
  data?: unknown,
  // deno-lint-ignore no-explicit-any
): VNode<any> {
  if (RootLayout) {
    return createElement(RootLayout, { params, data, children: content })
  }
  return createElement(DefaultDocumentShell, { children: content, lang })
}
