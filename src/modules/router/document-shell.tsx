import type { ComponentType, ReactElement } from 'react'
import type { LayoutProps } from 'typings/page.ts'

/**
 * The document shell used when there's no root `layout.tsx` to provide one — see
 * {@linkcode applyDocumentShell}'s own doc for exactly when this applies. React 19 recognizes
 * `<html>` as the root of a real document (verified directly: it emits `<!DOCTYPE html>` and
 * hoists a `<title>`/`<meta>` rendered anywhere in the tree into this `<head>`, not just ones
 * written literally inside it), so this is the one place that needs to exist at all — everything
 * else about document-level metadata already works through ordinary JSX.
 */
function DefaultDocumentShell({ children }: { children: ReactElement }): ReactElement {
  return (
    <html lang='en'>
      <head>
        <meta charSet='utf-8' />
        <meta name='viewport' content='width=device-width, initial-scale=1' />
      </head>
      <body>{children}</body>
    </html>
  )
}

/**
 * Wraps `content` in `RootLayout` if one was found (trusted to render `<html>`/`<body>` itself,
 * same contract as Next.js's own App Router — nothing here double-checks that it actually does),
 * or in {@linkcode DefaultDocumentShell} when there isn't one, so a page — or the not-found page,
 * see `createNotFoundHandler` — is always served as a real, spec-valid document.
 *
 * @param RootLayout - The app's own root `layout.tsx` component, if `loadRoutes()` found one.
 * @param content - The tree to place inside it.
 * @param params - Forwarded to `RootLayout` as its own `params` prop; irrelevant (and omitted) for
 * the default shell, which never reads route params.
 */
export function applyDocumentShell(
  RootLayout: ComponentType<LayoutProps> | undefined,
  content: ReactElement,
  params: Record<string, string> = {},
): ReactElement {
  if (RootLayout) return <RootLayout params={params}>{content}</RootLayout>
  return <DefaultDocumentShell>{content}</DefaultDocumentShell>
}
