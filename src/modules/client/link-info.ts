/// <reference lib="dom" />

/**
 * Finds the closest `<a>` ancestor of `target` (or `target` itself) — shared by every Orbit
 * trigger (click, hover, focus) that delegates a single listener on `document` rather than
 * attaching one per anchor, and needs to resolve "which link does this event actually concern."
 */
export function findAnchor(target: EventTarget | null): HTMLAnchorElement | undefined {
  if (!(target instanceof Element)) return undefined
  return target.closest('a') ?? undefined
}

/**
 * Resolves `href` against the current page and classifies it — shared by `orbit.ts`'s own
 * `shouldInterceptNavigation` (a real click) and `prefetch.ts`'s own `shouldPrefetch` (hover/focus/
 * viewport), so the exact same "same-origin," "same-document-hash-link" logic backs both: a link
 * Orbit would never intercept for a real click must never be prefetched either, and vice versa —
 * declared once here instead of risking the two definitions drifting apart.
 */
export function resolveLinkInfo(href: string | null): {
  resolved: URL | undefined
  isSameOrigin: boolean
  isSameDocumentHashLink: boolean
} {
  const resolved = href !== null ? new URL(href, location.href) : undefined
  return {
    resolved,
    isSameOrigin: resolved !== undefined && resolved.origin === location.origin,
    isSameDocumentHashLink: resolved !== undefined &&
      resolved.hash !== '' &&
      resolved.pathname === location.pathname &&
      resolved.search === location.search,
  }
}
