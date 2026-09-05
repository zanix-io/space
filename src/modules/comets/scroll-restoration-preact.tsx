'use comet'
import { useEffect } from 'preact/hooks'
import { defineComet } from './define-comet.ts'
import { attachScrollRestoration } from './scroll-restoration.ts'
import type { ScrollRestorationOptions } from './scroll-restoration.ts'
import type { CometBoundaryComponent, CometProps } from 'typings/comet.ts'

/**
 * Identical to `@zanix/space/comet/react`'s `ScrollRestoration`, wiring the same hook-free
 * {@linkcode attachScrollRestoration} into `preact/hooks`' own `useEffect` instead — see that
 * module's own doc for the full contract.
 */
export function ScrollRestoration(props: ScrollRestorationOptions): null {
  useEffect(() => attachScrollRestoration(props), [
    props.storageKey,
    props.targetId,
    props.storage,
    props.debounceMs,
  ])
  return null
}

/**
 * {@linkcode ScrollRestoration}, wrapped as a real Comet boundary — import this directly:
 * `import { ScrollRestoration } from '@zanix/space/comet/preact'` (a NAMED import — see
 * `mod-react.ts`'s own module doc for why this subpath has no single default). See
 * `form-draft-persistence-react.tsx`'s own comment on this same `as` clause — identical
 * no-slow-types reasoning, not a Preact-specific concern.
 */
export default defineComet(ScrollRestoration, import.meta.url) as CometBoundaryComponent<
  ScrollRestorationOptions & CometProps
>
