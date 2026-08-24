import logger from './client-logger.ts'
import {
  COMET_EXPORT_ATTR,
  COMET_MODULE_ATTR,
  COMET_PERSIST_ATTR,
  COMET_PROPS_ATTR,
  COMET_REUSED_ATTR,
} from '../comets/marker.ts'
import { parseCometProps } from '../render/serialization-codec.ts'

/**
 * What a renderer's own `hydrateBoundary` hands back for a `persist`-tagged boundary, once
 * `hydrateRoot`/`hydrate` has actually mounted it — the ONLY renderer-specific surface this whole
 * module ever touches. React's closure captures the real `Root` object `hydrateRoot`/`createRoot`
 * returned (`root.render(...)`/`root.unmount()`); Preact's closure just calls `render(...)` again
 * on the SAME container (Preact keeps its own reconciliation state on the node itself — no
 * separate root object to capture, see `hydrate-comets-preact.ts`'s own doc). Neither renderer
 * file imports the other's package to produce this — both just implement the same two-function
 * shape, exactly like `hydrateComets` itself is already implemented twice, once per renderer.
 */
export interface OrbitPersistHandle {
  /** Re-renders the already-mounted instance with new props, in place — never a fresh mount. */
  reuse: (props: unknown) => void
  /** Tears the instance down for good. Only ever called on LRU eviction or an identity mismatch
   * (a `persist` key reused for a different comet module/export) — never as part of an ordinary
   * detach, and never when a retained instance is about to be reused. */
  dispose: () => void
}

/** `boundary element -> its own OrbitPersistHandle`, for every `persist`-tagged boundary a
 * renderer has EVER hydrated on this page load — not just the ones currently detached/retained.
 * A `WeakMap` (not a plain property stashed on the element) so a boundary that's never persisted
 * across a navigation, or one whose retained entry is later evicted, is simply garbage-collected
 * along with the DOM node itself; nothing here ever needs explicit cleanup for that case. */
const persistHandles = new WeakMap<Element, OrbitPersistHandle>()

/** Called once, by whichever renderer's `hydrateBoundary` just mounted a `persist`-tagged
 * boundary — see {@linkcode OrbitPersistHandle}'s own doc for what `handle` must do. */
export function registerPersistHandle(boundary: Element, handle: OrbitPersistHandle): void {
  persistHandles.set(boundary, handle)
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

/**
 * Pulls every `persist`-tagged boundary still live in `outlet` out of the DOM and into the
 * retained-comet cache — called by `swapOutlet` (`orbit.ts`) BEFORE the outlet's own contents are
 * replaced, while these nodes are still attached, so the React/Preact instance mounted on each
 * one is detached under this module's own control rather than orphaned by an external
 * `innerHTML`/`replaceChildren` wipe it never gets a chance to react to.
 *
 * A boundary whose lazy hydration strategy (`'idle'`/`'visible'`/`'media'`) never actually
 * triggered has no registered {@linkcode OrbitPersistHandle} at all — there is no live instance
 * to retain, so it's left exactly where it is, to be discarded normally by the caller's own
 * replace step, the same as any other non-persisted boundary.
 */
export function detachPersistedComets(outlet: ParentNode): void {
  const seenKeys = new Set<string>()
  const boundaries = outlet.querySelectorAll(`[${COMET_PERSIST_ATTR}]`)

  boundaries.forEach((boundary) => {
    const key = boundary.getAttribute(COMET_PERSIST_ATTR)
    if (!key) return
    const handle = persistHandles.get(boundary)
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

    const handle = persistHandles.get(node)
    // Third read site for `data-comet-props`, sharing the same decoder as both hydrate
    // modules — a retained comet must decode identically to a freshly hydrated one.
    const props = parseCometProps(placeholder.getAttribute(COMET_PROPS_ATTR))
    handle?.reuse(props)
    node.setAttribute(COMET_REUSED_ATTR, '')
    placeholder.replaceWith(node)
  })
}
