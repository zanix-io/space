// deno-coverage-ignore-file

// Authored with Preact's own `createElement`, never JSX syntax — deliberate, and the reason the
// previous end-to-end Preact case had to be removed rather than adapted. Every `.tsx` file in this
// project compiles against React's JSX factory (`compilerOptions.jsxImportSource`), so a fixture
// written as JSX produces REACT elements no matter which renderer is active. Rendering those under
// Preact is a mixed-renderer app, which this package forbids — see `renderer-invariant.test.ts`.
// The `.tsx` extension is still required: `loadRoutes` discovers root singletons by that exact
// filename.
import { createElement } from 'preact'
import type { ComponentChildren, VNode } from 'preact'
import type { LayoutProps } from 'typings/page.ts'

/**
 * A root layout that owns the document and cooperates with head management in NO way — no
 * `headExtras` prop, no `<title>`, nothing. That is the point: the resolved head must reach the
 * document regardless.
 */
export default function RootLayout(
  { children }: LayoutProps<ComponentChildren>,
  // deno-lint-ignore no-explicit-any
): VNode<any> {
  return createElement(
    'html',
    { lang: 'en' },
    createElement('head', null, createElement('meta', { charSet: 'utf-8' })),
    createElement('body', { 'data-testid': 'preact-app-shell' }, children),
  )
}
