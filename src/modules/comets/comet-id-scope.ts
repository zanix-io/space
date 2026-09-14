import { InternalError } from '@zanix/errors'
import { getActiveRenderer } from '../router/active-renderer.ts'
import type { RendererKind } from '../router/active-renderer.ts'

/**
 * A renderer's own Context Provider component, wrapping a Comet's real content with THIS
 * instance's own stable-id scope (a plain string value, opaque to this file). Same "one slot per
 * renderer, resolved by `getActiveRenderer()` at render time" shape `element-factory.ts` already
 * establishes for `createElement` — not repeated here, see that file's own doc for the full "why
 * a registry, not a static import" reasoning (this package must never contain a runtime path that
 * loads React or Preact itself).
 */
// deno-lint-ignore no-explicit-any
export type CometIdScopeProvider = (props: { value: string; children?: any }) => unknown

// Stored on `globalThis`, not a plain module-scoped object — same reasoning as
// `element-factory.ts`'s own identical registry: a module-scoped object is only a real singleton
// if every reader and writer resolves through the SAME module instance, which a dev-server bundler
// serving a large Comet chunk under load doesn't always guarantee.
const PROVIDERS_KEY = '__znx_comet_id_scope_providers__'

function getProviders(): { react?: CometIdScopeProvider; preact?: CometIdScopeProvider } {
  const globalObject = globalThis as Record<string, unknown>
  if (!globalObject[PROVIDERS_KEY]) globalObject[PROVIDERS_KEY] = {}
  return globalObject[PROVIDERS_KEY] as {
    react?: CometIdScopeProvider
    preact?: CometIdScopeProvider
  }
}

/** Registers one renderer's own Provider — called once, at module load, by
 * `installRendererRuntime` (`router/renderer-runtime.ts`), the same seam `setCometElementFactory`
 * already uses. */
export function setCometIdScopeProvider(kind: RendererKind, provider: CometIdScopeProvider): void {
  getProviders()[kind] = provider
}

/**
 * The Provider to scope a Comet instance's own stable ids with, for the renderer that is active
 * right now — see `useCometStableId`'s own doc (`comet-id-scope-react.tsx`/`-preact.tsx`) for what
 * this closes.
 *
 * @throws {InternalError} Same condition and message shape as `getCometElementFactory` — a Comet
 * is being rendered without this project's own renderer entry point ever having been imported.
 */
export function getCometIdScopeProvider(): CometIdScopeProvider {
  const renderer = getActiveRenderer()
  const provider = getProviders()[renderer]
  if (!provider) {
    throw new InternalError(
      `The active renderer is '${renderer}', but no ${renderer} Comet id-scope provider is ` +
        "registered. Import this project's own renderer entry point once, from its main module: " +
        `\`import '@zanix/space/${renderer}'\`.`,
    )
  }
  return provider
}

/** Test-only reset — drops every registered provider, restoring the state a fresh process starts
 * in. Never called by library code. */
export function resetCometIdScopeProviders(): void {
  delete getProviders().react
  delete getProviders().preact
}
