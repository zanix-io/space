import logger from './client-logger.ts'
import {
  COMET_EXPORT_ATTR,
  COMET_ID_ATTR,
  COMET_MODULE_ATTR,
  COMET_PERSIST_ATTR,
  COMET_PROPS_ATTR,
  COMET_REUSED_ATTR,
} from '../comets/marker.ts'
import { parseCometProps } from '../render/serialization-codec.ts'

/**
 * What a renderer's own `hydrateBoundary` hands back for EVERY top-level boundary it just mounted
 * — the ONLY renderer-specific surface this whole module ever touches. React's closure captures
 * the real `Root` object `hydrateRoot`/`createRoot` returned (`root.render(...)`/
 * `root.unmount()`); Preact's closure just calls `render(...)` again on the SAME container (Preact
 * keeps its own reconciliation state on the node itself — no separate root object to capture, see
 * `hydrate-comets-preact.ts`'s own doc). Neither renderer file imports the other's package to
 * produce this — both just implement the same two-function shape, exactly like `hydrateComets`
 * itself is already implemented twice, once per renderer.
 *
 * Registered for EVERY hydrated top-level boundary, not just `persist`-tagged ones (the name
 * predates that broadening — this used to be persist-only, see {@linkcode disposeOutletComets}'s
 * own doc for the real bug that widened it) — `reuse` is simply never called for a non-persisted
 * boundary (nothing ever puts one in {@linkcode RetainedCometCache}), while `dispose` is now the
 * one thing EVERY boundary needs regardless: the real hook this module gives `orbit.ts` to
 * actually unmount a Comet whose DOM is about to be ripped out from under it.
 */
export interface OrbitCometHandle {
  /** Re-renders the already-mounted instance with new props, in place — never a fresh mount.
   * Only ever invoked for a `persist`-tagged boundary being reused from the cache. */
  reuse: (props: unknown) => void
  /** Tears the instance down for good — `root.unmount()`/`render(null, boundary)`. Called for a
   * `persist`-tagged boundary on LRU eviction or an identity mismatch, and now for EVERY ordinary
   * boundary right before its own DOM node is discarded by an Orbit swap (`disposeOutletComets`) —
   * the real unmount signal neither renderer would otherwise ever get. */
  dispose: () => void
}

/** `boundary element -> its own OrbitCometHandle`, for every top-level Comet boundary a renderer
 * has EVER hydrated on this page load — not just `persist`-tagged ones, and not just the ones
 * currently detached/retained. A `WeakMap` (not a plain property stashed on the element) so a
 * boundary whose DOM node is later discarded is simply garbage-collected along with it; nothing
 * here ever needs explicit cleanup for that case. */
const cometHandles = new WeakMap<Element, OrbitCometHandle>()

/** Called once, by whichever renderer's `hydrateBoundary` just mounted ANY top-level boundary
 * (`persist`-tagged or not) — see {@linkcode OrbitCometHandle}'s own doc for what `handle` must
 * do. */
export function registerCometHandle(boundary: Element, handle: OrbitCometHandle): void {
  cometHandles.set(boundary, handle)
}

/** One retained, currently-detached comet instance — everything {@linkcode RetainedCometCache}
 * needs to decide reuse-eligibility (`moduleUrl`/`exportName`) and to tear itself down
 * (`dispose`), plus the opaque `node` itself (a real `Element` in production; a plain object in
 * this class's own unit tests — see that file's own doc for why this stays generic). */
export interface RetainedCometEntry<Node> {
  moduleUrl: string
  exportName: string
  node: Node
  dispose: () => void
}

/**
 * A small, bounded, key-addressed LRU cache of detached-but-still-mounted comet instances —
 * generic over `Node` (never `Element` directly) specifically so this class's own correctness
 * (insertion, eviction order, reuse-or-reject, duplicate-key safety) is fully unit-testable with
 * plain mock objects, no DOM/browser required at all. The one production instance of this class
 * (below) is parameterized with real `Element`; nothing about the class itself assumes that.
 *
 * Deliberately NOT scoped by URL/history entry — a `persist` key is already the author's own
 * declared "this is the same logical instance" signal (see `CometProps.persist`'s own doc), so a
 * flat, key-addressed cache is both simpler and more correct than nesting retention by page: it
 * naturally survives A → B → A (nothing evicts it just because an intermediate page didn't
 * reference it) while staying bounded regardless of how many DIFFERENT pages get visited in
 * between (only the `limit` most-recently-touched instances are ever retained; everything older
 * is torn down for real, not merely dropped from view).
 */
export class RetainedCometCache<Node> {
  readonly #entries = new Map<string, RetainedCometEntry<Node>>()
  readonly #limit: number

  public constructor(limit: number) {
    this.#limit = limit
  }

  /** Number of currently-retained (detached, not yet reused) instances. */
  public get size(): number {
    return this.#entries.size
  }

  /**
   * Retains `entry` under `key` — moving it to the most-recently-used position if `key` was
   * already present (the same `Map`-reinsertion trick `RetainedCometCache` relies on throughout:
   * a `Map`'s own iteration order already IS insertion order, so deleting then re-setting a key
   * is the entire "mark as recently used" operation, no separate ordering structure needed). A
   * key already holding a DIFFERENT entry (two live boundaries sharing one `persist` key,
   * detached in the same pass — an authoring mistake, not a normal case) disposes the one being
   * replaced immediately, rather than leaking it silently.
   *
   * Evicts (and disposes) the least-recently-touched entries, oldest first, whenever this push
   * leaves the cache over `limit` — the only mechanism that ever bounds its size; nothing here is
   * tied to a URL, a history entry, or a page-navigation count.
   */
  public set(key: string, entry: RetainedCometEntry<Node>): void {
    const existing = this.#entries.get(key)
    if (existing && existing.node !== entry.node) {
      logger.warn(
        `Duplicate persist key "${key}" — a previously retained Comet instance under this key ` +
          'is being discarded in favor of a newer one from the same page.',
      )
      existing.dispose()
    }
    this.#entries.delete(key)
    this.#entries.set(key, entry)

    while (this.#entries.size > this.#limit) {
      const oldestKey = this.#entries.keys().next().value
      if (oldestKey === undefined) break
      const oldest = this.#entries.get(oldestKey)
      this.#entries.delete(oldestKey)
      oldest?.dispose()
    }
  }

  /**
   * Looks up `key`, removing it from the cache either way (a taken entry is live again, no
   * longer "waiting"; a stale one is discarded for good) — never a peek.
   *
   * @returns The retained `node` if `key` exists AND its `moduleUrl`/`exportName` matches
   * `moduleUrl`/`exportName` — i.e. the incoming boundary is genuinely still the same comet type,
   * not just a same-key coincidence across two different comets. A key that exists but whose
   * identity no longer matches is treated as stale: disposed here, not silently ignored, and
   * `undefined` is returned either way so the caller falls through to its own normal fresh-mount
   * path.
   */
  public take(key: string, moduleUrl: string, exportName: string): Node | undefined {
    const entry = this.#entries.get(key)
    if (!entry) return undefined
    this.#entries.delete(key)
    if (entry.moduleUrl !== moduleUrl || entry.exportName !== exportName) {
      entry.dispose()
      return undefined
    }
    return entry.node
  }

  /** Whether `key` currently has a retained entry — read-only, never removes it (unlike
   * {@linkcode take}). Exists for tests; production code only ever needs `take`. */
  public has(key: string): boolean {
    return this.#entries.has(key)
  }

  /** Disposes and removes every retained entry — a full page reload/leaving the SPA already does
   * this implicitly (the whole in-memory `Map` dies with the page); this exists for tests and for
   * any future explicit-teardown caller, not part of the normal navigation flow. */
  public clear(): void {
    for (const entry of this.#entries.values()) entry.dispose()
    this.#entries.clear()
  }
}

/** Implementation detail, not a public/configurable option — the smallest bound that still
 * comfortably covers realistic back-and-forth browsing (A → B → A and a few pages deeper) without
 * ever retaining an unbounded number of mounted instances across a long session. */
const MAX_RETAINED_COMETS = 5

const liveCache = new RetainedCometCache<Element>(MAX_RETAINED_COMETS)

/** Whether `key` currently has a retained (detached but not yet reused) instance — read-only,
 * never mutates the cache, unlike navigating to the key's own page (which would `take()` it via
 * {@linkcode reuseRetainedComets}). Exists so `persist` behavior can be inspected without a live
 * browser round trip, and so a consuming app's own author-facing code (e.g. a dev-only "this
 * widget's state IS/ISN'T currently preserved" badge) has a real way to ask. */
export function isCometPersisted(key: string): boolean {
  return liveCache.has(key)
}

/**
 * Pulls every `persist`-tagged boundary still live in `outlet` out of the DOM and into the
 * retained-comet cache — called by `swapOutlet` (`orbit.ts`) BEFORE the outlet's own contents are
 * replaced, while these nodes are still attached, so the React/Preact instance mounted on each
 * one is detached under this module's own control rather than orphaned by an external
 * `innerHTML`/`replaceChildren` wipe it never gets a chance to react to.
 *
 * A boundary whose lazy hydration strategy (`'idle'`/`'visible'`/`'media'`) never actually
 * triggered has no registered {@linkcode OrbitCometHandle} at all — there is no live instance
 * to retain, so it's left exactly where it is, to be discarded normally by the caller's own
 * replace step, the same as any other non-persisted boundary.
 */
export function detachPersistedComets(outlet: ParentNode): void {
  const seenKeys = new Set<string>()
  const boundaries = outlet.querySelectorAll(`[${COMET_PERSIST_ATTR}]`)

  boundaries.forEach((boundary) => {
    const key = boundary.getAttribute(COMET_PERSIST_ATTR)
    if (!key) return
    const handle = cometHandles.get(boundary)
    if (!handle) return

    if (seenKeys.has(key)) {
      logger.warn(
        `Duplicate persist key "${key}" on the same page — only the first instance is retained; ` +
          'the rest are torn down normally.',
      )
      handle.dispose()
      return
    }
    seenKeys.add(key)

    const moduleUrl = boundary.getAttribute(COMET_MODULE_ATTR) ?? ''
    const exportName = boundary.getAttribute(COMET_EXPORT_ATTR) ?? ''
    boundary.remove()
    liveCache.set(key, { moduleUrl, exportName, node: boundary, dispose: handle.dispose })
  })
}

/**
 * Disposes every NON-`persist`-tagged top-level Comet boundary still live in `outlet` — called by
 * `swapOutlet` (`orbit.ts`) right after {@linkcode detachPersistedComets} (which has, by then,
 * already pulled every `persist`-tagged boundary OUT of `outlet`, so this only ever reaches the
 * ones actually about to be discarded) and BEFORE the outlet's own contents are replaced, while
 * these nodes are still attached to a real, live renderer instance.
 *
 * **A real, confirmed bug this closes**: `outlet.replaceChildren(...)` (`orbit.ts`'s own `swap`)
 * only ever removes a boundary's DOM node — it never asks React/Preact to unmount it, because
 * neither renderer observes an external `replaceChildren`/`innerHTML` wipe as an unmount signal at
 * all (that's `dispose()`'s own job: `root.unmount()`/`render(null, boundary)`, per
 * {@linkcode OrbitCometHandle}'s own doc). Every ordinary (non-persisted) Comet using a hook with
 * a cleanup function — an event listener, a timer, a subscription — leaked it on EVERY Orbit
 * navigation before this fix: its own cleanup never ran, so the listener stayed attached to
 * whatever it was watching (commonly `window`) for the rest of the session, with its own closure
 * still pointing at the NOW-STALE page state it was created under.
 *
 * Confirmed, reproduced, real-world instance: `ScrollRestoration` (`@zanix/space/comet`) attaches a
 * `scroll` listener to `window` keyed by `location.pathname` at mount. Leaked across a navigation,
 * that stale listener kept firing on every scroll of a LATER, completely different page — still
 * saving under its own original (now wrong) key — so revisiting the original page later could
 * restore a position that actually belonged to whatever page the visitor happened to be scrolling
 * when the leaked listener's debounce last fired. Fixed at the actual leak, not by working around
 * its symptom.
 *
 * Boundaries with a lazy strategy (`'idle'`/`'visible'`/`'media'`) that never actually triggered
 * hydration have no registered handle at all — same real "nothing to dispose" case
 * {@linkcode detachPersistedComets}'s own doc already covers for the identical reason. A Comet
 * composed inside another one's own tree is never queried directly here either — it has no
 * `COMET_ID_ATTR` boundary of its OWN dispose handle to look up in the first place (only a
 * top-level boundary ever registers one; see `hydrateBoundary` in either renderer's own
 * `hydrate-comets*.ts`), so it's disposed transitively along with its parent, exactly like it
 * hydrates transitively alongside it.
 */
export function disposeOutletComets(outlet: ParentNode): void {
  const boundaries = outlet.querySelectorAll(`[${COMET_ID_ATTR}]`)

  boundaries.forEach((boundary) => {
    const handle = cometHandles.get(boundary)
    handle?.dispose()
  })
}

/**
 * Walks a freshly-parsed (not yet inserted into the real document) fragment for `persist`-tagged
 * placeholders and, for each one matching a retained instance (same key, same comet
 * module/export), replaces that placeholder with the RETAINED live node and updates it with the
 * placeholder's own fresh props via the renderer's native update path — never a fresh mount.
 * Called by `swapOutlet` on the parsed destination fragment BEFORE it's ever attached to
 * `outlet`, so the final tree `outlet.replaceChildren` receives already has any reused instances
 * spliced in.
 *
 * The reused node is marked with `COMET_REUSED_ATTR` so `hydrateComets`'s own boundary loop (run
 * AFTER this fragment is attached) skips it — it was already updated here, a fresh
 * `hydrateRoot`/`hydrate` call on it would be wrong (a second root fighting the first) as well as
 * redundant.
 */
export function reuseRetainedComets(fragmentRoot: ParentNode): void {
  const seenKeys = new Set<string>()
  const placeholders = fragmentRoot.querySelectorAll(`[${COMET_PERSIST_ATTR}]`)

  placeholders.forEach((placeholder) => {
    const key = placeholder.getAttribute(COMET_PERSIST_ATTR)
    if (!key) return

    if (seenKeys.has(key)) {
      logger.warn(
        `Duplicate persist key "${key}" in the same page — only the first is eligible for reuse.`,
      )
      return
    }
    seenKeys.add(key)

    const moduleUrl = placeholder.getAttribute(COMET_MODULE_ATTR) ?? ''
    const exportName = placeholder.getAttribute(COMET_EXPORT_ATTR) ?? ''
    const node = liveCache.take(key, moduleUrl, exportName)
    if (!node) return

    const handle = cometHandles.get(node)
    // Third read site for `data-comet-props`, sharing the same decoder as both hydrate
    // modules — a retained comet must decode identically to a freshly hydrated one.
    const props = parseCometProps(placeholder.getAttribute(COMET_PROPS_ATTR))
    handle?.reuse(props)
    node.setAttribute(COMET_REUSED_ATTR, '')
    placeholder.replaceWith(node)
  })
}
