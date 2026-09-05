'use comet'
import { useEffect } from 'react'
import { defineComet } from './define-comet.ts'
import { attachNetworkStatus, DEFAULT_NETWORK_STATUS_ATTRIBUTE } from './network-status.ts'
import type { NetworkStatusOptions } from './network-status.ts'
import type { CometBoundaryComponent, CometProps } from 'typings/comet.ts'

export type { NetworkStatusOptions }

/**
 * Ready-made Comet wiring {@linkcode attachNetworkStatus} into React's own `useEffect`, writing
 * the live status as a `data-*` attribute rather than a prop callback (a Comet's own props must be
 * plain JSON — see this module's own `NetworkStatusOptions` doc). Renders nothing.
 *
 * ```tsx
 * import { NetworkStatus } from '@zanix/space/comet/react'
 *
 * // usually once, near the root layout
 * <NetworkStatus />
 * ```
 *
 * ```css
 * [data-network-status="offline"] .requires-network { display: none; }
 * ```
 */
export function NetworkStatus(props: NetworkStatusOptions): null {
  const { targetId, attribute = DEFAULT_NETWORK_STATUS_ATTRIBUTE } = props
  useEffect(
    () =>
      attachNetworkStatus((online) => {
        const target = targetId
          ? globalThis.document?.getElementById(targetId)
          : globalThis.document?.documentElement
        target?.setAttribute(attribute, online ? 'online' : 'offline')
      }),
    [targetId, attribute],
  )
  return null
}

/**
 * {@linkcode NetworkStatus}, wrapped as a real Comet boundary — import this directly:
 * `import { NetworkStatus } from '@zanix/space/comet/react'` (a NAMED import — see
 * `mod-react.ts`'s own module doc for why this subpath has no single default). See
 * `form-draft-persistence-react.tsx`'s own comment on this same `as` clause — identical
 * no-slow-types reasoning.
 */
export default defineComet(NetworkStatus, import.meta.url) as CometBoundaryComponent<
  NetworkStatusOptions & CometProps
>
