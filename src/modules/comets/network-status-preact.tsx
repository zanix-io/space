'use comet'
import { useEffect } from 'preact/hooks'
import { defineComet } from './define-comet.ts'
import { attachNetworkStatus, DEFAULT_NETWORK_STATUS_ATTRIBUTE } from './network-status.ts'
import type { NetworkStatusOptions } from './network-status.ts'
import type { CometBoundaryComponent, CometProps } from 'typings/comet.ts'

export type { NetworkStatusOptions }

/**
 * Identical to `@zanix/space/comet/react`'s `NetworkStatus`, wiring the same hook-free
 * {@linkcode attachNetworkStatus} into `preact/hooks`' own `useEffect` instead — see that
 * subpath's own `NetworkStatus`/`NetworkStatusOptions` doc for the full contract.
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
 * `import { NetworkStatus } from '@zanix/space/comet/preact'` (a NAMED import — see
 * `mod-react.ts`'s own module doc for why this subpath has no single default). See
 * `form-draft-persistence-react.tsx`'s own comment on this same `as` clause — identical
 * no-slow-types reasoning, not a Preact-specific concern.
 */
export default defineComet(NetworkStatus, import.meta.url) as CometBoundaryComponent<
  NetworkStatusOptions & CometProps
>
