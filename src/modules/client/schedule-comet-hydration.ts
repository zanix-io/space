/// <reference lib="dom" />
import type { CometStrategy } from 'typings/comet.ts'

/**
 * Real browser timing primitives `scheduleCometHydration` defers to when a strategy doesn't get
 * one injected explicitly — the production defaults. Exposed as a type (not baked in) so tests can
 * substitute deterministic fakes instead of depending on an actual browser environment.
 */
export type CometSchedulingDeps = {
  requestIdleCallback?: (run: () => void) => void
  IntersectionObserverCtor?: typeof IntersectionObserver
  matchMedia?: (query: string) => MediaQueryList
}

/**
 * Decides *when* to call `run()` for a single Comet boundary, based on its declared strategy —
 * the piece of `hydrateComets` that's actually worth unit testing in isolation, since the
 * DOM/React orchestration around it (`hydrateRoot`, `document.querySelectorAll`) only makes sense
 * in a real browser. `run()` is called at most once, regardless of strategy.
 *
 * @param strategy - The boundary's own `CometStrategy` (`'none'` is a no-op — `hydrateComets`
 * filters it out before ever reaching here, but handled defensively regardless).
 * @param element - The boundary element `'visible'` observes for intersection.
 * @param media - The media query `'media'` waits on. Ignored by every other strategy.
 * @param run - Invoked once the strategy's condition is met.
 * @param deps - Overrides for the underlying browser primitives — see {@linkcode CometSchedulingDeps}.
 */
export function scheduleCometHydration(
  strategy: CometStrategy,
  element: Element,
  media: string | undefined,
  run: () => void,
  deps: CometSchedulingDeps = {},
): void {
  switch (strategy) {
    case 'load':
    case 'only':
      run()
      return
    case 'none':
      return
    case 'idle': {
      const schedule = deps.requestIdleCallback ??
        (typeof requestIdleCallback === 'function'
          ? requestIdleCallback
          : (cb: () => void) => setTimeout(cb, 1))
      schedule(run)
      return
    }
    case 'visible': {
      const Ctor = deps.IntersectionObserverCtor ?? IntersectionObserver
      const observer = new Ctor((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect()
          run()
        }
      })
      observer.observe(element)
      return
    }
    case 'media': {
      if (!media) {
        run()
        return
      }
      const match = deps.matchMedia ?? matchMedia
      const mql = match(media)
      if (mql.matches) {
        run()
        return
      }
      const listener = () => {
        if (!mql.matches) return
        mql.removeEventListener('change', listener)
        run()
      }
      mql.addEventListener('change', listener)
      return
    }
  }
}
