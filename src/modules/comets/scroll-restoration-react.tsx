'use comet'
import { useEffect } from 'react'
import { defineComet } from './define-comet.ts'
import { attachScrollRestoration } from './scroll-restoration.ts'
import type { ScrollRestorationOptions } from './scroll-restoration.ts'
import type { CometBoundaryComponent, CometProps } from 'typings/comet.ts'

/**
 * Ready-made Comet wiring {@linkcode attachScrollRestoration} into React's own `useEffect` — the
 * default a consumer app reaches for to restore scroll position across a refresh or an Orbit
 * navigation. Renders nothing; every `ScrollRestorationOptions` field is a plain JSON-serializable
 * value, so it crosses the Comet boundary as ordinary props like any other.
 *
 * ```tsx
 * import { ScrollRestoration } from '@zanix/space/comet/react'
 *
 * // usually once, near the root layout — restores the WHOLE page's own scroll position
 * <ScrollRestoration />
 * ```
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
 * `import { ScrollRestoration } from '@zanix/space/comet/react'` (a NAMED import — see
 * `mod-react.ts`'s own module doc for why this subpath has no single default). See
 * `form-draft-persistence-react.tsx`'s own comment on this same `as` clause — identical
 * no-slow-types reasoning.
 */
export default defineComet(ScrollRestoration, import.meta.url) as CometBoundaryComponent<
  ScrollRestorationOptions & CometProps
>
