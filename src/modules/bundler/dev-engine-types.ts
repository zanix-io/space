/**
 * `SsrModuleChangedEvent`'s own dedicated, dependency-free file — split out of `dev-engine.ts`
 * (where the interface itself is still re-exported from, unchanged, for every existing consumer)
 * specifically so a caller that only needs the TYPE never has to resolve `dev-engine.ts`'s own
 * real value imports (`vite`, `@deno/vite-plugin`) to get it. `import type` still requires
 * resolving the WHOLE file a type is declared in — `dev-engine.ts`'s own top-level `import {
 * createServer, createServerModuleRunner } from 'vite'` would otherwise materialize for any
 * consumer of `SsrModuleChangedEvent` alone, exactly the class of leak
 * `docs/comets.md`'s own `'server-only'` boundary exists to catch for a Comet's client bundle, and
 * the same one confirmed real for this package's root `.` entry point (`socket-exports.ts`'s own
 * doc, before this split, documented it as a known, unresolved gap). `changeType` mirrors Vite's
 * own `HotUpdateOptions['type']` locally (`"create" | "update" | "delete"` — confirmed against
 * `vite@8.2.2`'s own `dist/node/index.d.ts`) instead of importing it, the same reason: referencing
 * `HotUpdateOptions` at all would still force resolving `vite`'s own module to get the literal
 * union, defeating the whole point of this split.
 *
 * @module
 */

/**
 * Reported once per file change that affects the `ssr` environment's module graph — never for
 * the `client` environment (see `createSpaceDevEngine`'s own doc, `dev-engine.ts`, for why).
 */
export interface SsrModuleChangedEvent {
  /** Absolute path of the file Vite detected as changed. */
  file: string
  /** Whether the file was created, edited, or deleted. */
  changeType: 'create' | 'update' | 'delete'
  /** Route-boundary module ids reachable from `file`, per `computeAffectedRoutes` (`dev-engine.ts`). */
  affectedRoutes: string[]
  /**
   * Whether `file` itself (not one of `affectedRoutes`) starts with the `'use comet'` directive —
   * lets a caller tell "the route's own file, or a server-only dependency (a `layout.tsx`, a
   * `loader`), changed — a connected browser genuinely needs a fresh document" apart from "only a
   * Comet changed, and it already reports its own `client-module-changed` update separately (see
   * `onClientModuleChanged`'s own doc, `dev-engine.ts`) — that alone is enough to bring a connected
   * page up to date, without discarding whatever client-only state (a Comet's own `useState`, a
   * form draft) a full reload would".
   *
   * A Comet is reachable from the `ssr` environment's own module graph too (its initial HTML is
   * still server-rendered), so editing one fires `onSsrModuleChanged` exactly the same as editing
   * the route file itself would — this field is what lets a caller choose to still refresh this
   * app's own route registry/compiled dispatch table (so the NEXT real, fresh request reflects the
   * edit) while skipping only the "tell an already-connected browser to reload" side effect for
   * this one case.
   */
  isComet: boolean
}
