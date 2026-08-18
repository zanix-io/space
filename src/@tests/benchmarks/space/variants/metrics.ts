/**
 * The in-page instrumentation every variant is measured with — installed via
 * `page.addInitScript()` BEFORE navigation, so `PerformanceObserver`s are already active from the
 * very first byte of the response (long tasks and LCP both need to be captured live; querying them
 * retroactively after the page settles would miss whatever already happened during hydration
 * itself, the exact window this benchmark cares about).
 *
 * @module
 */

/** Injected into the page via `addInitScript` — runs before any of the page's own scripts. */
export const INIT_SCRIPT = `
window.__bench = { longTasks: [], lcp: null };
try {
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      window.__bench.longTasks.push({ start: entry.startTime, duration: entry.duration });
    }
  }).observe({ type: 'longtask', buffered: true });
} catch {}
try {
  new PerformanceObserver((list) => {
    const entries = list.getEntries();
    if (entries.length) window.__bench.lcp = entries[entries.length - 1].startTime;
  }).observe({ type: 'largest-contentful-paint', buffered: true });
} catch {}
`

export interface CollectedMetrics {
  htmlTransferredBytes: number
  jsTransferredBytes: number
  jsRequestCount: number
  firstContentfulPaintMs: number | null
  largestContentfulPaintMs: number | null
  domContentLoadedMs: number
  loadEventMs: number
  longTaskCount: number
  longTaskTotalMs: number
  hydratedBoundaryCount: number
}

/** Evaluated in-page, once, after `load` + a settle window — reads real Navigation/Resource
 * Timing plus whatever `INIT_SCRIPT`'s observers accumulated. */
export function collectMetrics(): CollectedMetrics {
  const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming
  const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[]
  const jsResources = resources.filter((r) => r.name.endsWith('.js'))
  const paints = performance.getEntriesByType('paint')
  const fcp = paints.find((p) => p.name === 'first-contentful-paint')
  const bench =
    (window as unknown as { __bench: { longTasks: { duration: number }[]; lcp: number | null } })
      .__bench

  return {
    htmlTransferredBytes: nav.transferSize,
    jsTransferredBytes: jsResources.reduce((sum, r) => sum + r.transferSize, 0),
    jsRequestCount: jsResources.length,
    firstContentfulPaintMs: fcp ? fcp.startTime : null,
    largestContentfulPaintMs: bench.lcp,
    domContentLoadedMs: nav.domContentLoadedEventEnd,
    loadEventMs: nav.loadEventEnd,
    longTaskCount: bench.longTasks.length,
    longTaskTotalMs: bench.longTasks.reduce((sum, t) => sum + t.duration, 0),
    hydratedBoundaryCount: document.querySelectorAll('[data-comet]').length,
  }
}
