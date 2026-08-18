// deno-coverage-ignore-file

import { createElement } from 'preact'
import type { VNode } from 'preact'
import type { HeadDescriptor } from 'modules/router/head-descriptor.ts'

/** The app's own not-found head — the same named `head` export a `layout.tsx` may declare, resolved
 * through the same `resolveHead`. Replaces this package's own `DEFAULT_NOT_FOUND_HEAD`. */
export const head: HeadDescriptor = {
  title: 'Not found',
  meta: [
    { name: 'description', content: 'This page does not exist.' },
    { name: 'robots', content: 'noindex' },
  ],
  link: [{ rel: 'canonical', href: 'https://example.com/404' }],
}

// `VNode<any>` — the same structural limit `document-shell-preact.ts` documents: `VNode<P>` makes
// `P` contravariant, so a vnode carrying concrete props is not assignable to the bare `VNode`.
// deno-lint-ignore no-explicit-any
export default function CustomNotFound(): VNode<any> {
  return createElement('p', { 'data-testid': 'preact-not-found' }, 'nothing here')
}
