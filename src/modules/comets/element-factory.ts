import { InternalError } from '@zanix/errors'
import { getActiveRenderer } from '../router/active-renderer.ts'
import type { RendererKind } from '../router/active-renderer.ts'

/**
 * The one `createElement` `defineComet` builds its boundary markup with, resolved per active
 * renderer at render time.
 *
 * This registry exists because `defineComet` builds its boundary markup with JSX, and this
 * package's `jsxImportSource` is fixed to `'react'` at the `deno.jsonc` level, independent of which
 * renderer an app actually runs. Every element `CometBoundary` produces is therefore React-shaped —
 * including the `<Component />` invocation itself — and `preact-render-to-string` silently discards
 * a React-shaped element (it is not a Preact vnode; the renderer returns `""` without throwing,
 * warning, or ever calling the component). Under `--renderer=preact`, that would make a Comet
 * vanish entirely from the response: no marker, no content, and a well-formed 200 hiding it.
 * Resolving `createElement` per active renderer through this registry, instead of a single
 * statically-imported one, is what keeps that element Preact-shaped under `--renderer=preact` and
 * React-shaped under `--renderer=react`. See `define-comet-preact.test.ts` for the test coverage of
 * this behavior.
 *
 * The shape follows this package's existing renderer seams (`page-renderer-registry.ts`,
 * `active-renderer.ts`) rather than inventing a new one. There is no eager React default here:
 * importing React's own `createElement` statically as the default would make `defineComet` — a
 * renderer-agnostic API at runtime — drag React into every app that imports `@zanix/space`, Preact
 * projects included. Both renderers instead register through the same seam, from
 * `@zanix/space/react` and `@zanix/space/preact` respectively (see `router/renderer-runtime.ts`),
 * so the core names neither.
 *
 * @module
 */

/**
 * A renderer's own `createElement`, typed loosely on purpose: React's and Preact's are nominally
 * incompatible types, so no single concrete signature can describe both — the same reason
 * `PageRenderer` types its own `Component` parameter as `unknown` (see
 * `page-renderer-registry.ts`'s own doc). Both real implementations accept exactly this call
 * shape.
 */
export type CometElementFactory = (
  type: unknown,
  // `object`, not `Record<string, unknown>`: a Comet's own props are a caller-supplied
  // `P extends object`, which TypeScript does not consider index-signature-compatible with a
  // `Record` — and widening at the one real call site would mean casting away the props' actual
  // type, which is worse. Both renderers accept any plain object here.
  props: object | null,
  ...children: unknown[]
) => unknown

// One slot per renderer, not a single slot: this package's own test suite renders both renderers in
// the same process, and `getActiveRenderer()` is what selects between them per render — collapsing
// the two would make the last entry point imported win globally, which is a different (and wrong)
// contract from the one `active-renderer.ts` already establishes.
const factories: { react?: CometElementFactory; preact?: CometElementFactory } = {}

/**
 * Registers one renderer's own `createElement` as the factory `defineComet` uses whenever that
 * renderer is active. Called once, at module load, by `installRendererRuntime`
 * (`router/renderer-runtime.ts`) — which is reached only by importing `@zanix/space/react` or
 * `@zanix/space/preact`.
 *
 * @param kind - Which renderer this factory belongs to. Passed explicitly by the entry point that
 * owns it; never inferred from the function itself.
 * @param factory - That renderer's real `createElement`. Never a hand-written shim.
 */
export function setCometElementFactory(kind: RendererKind, factory: CometElementFactory): void {
  factories[kind] = factory
}

/**
 * The `createElement` to build a Comet boundary with, for the renderer that is active right now.
 *
 * @returns The registered factory for `getActiveRenderer()`'s current value.
 * @throws {InternalError} If that renderer's factory was never registered — i.e. a Comet is being
 * rendered without this project's own renderer entry point having been imported. Failing loudly
 * here matters: the alternative is a boundary that silently renders as nothing, with no marker, no
 * content, and no error to explain why. This check applies symmetrically to both renderers — neither
 * React nor Preact is this package's implicit default.
 */
export function getCometElementFactory(): CometElementFactory {
  const renderer = getActiveRenderer()
  const factory = factories[renderer]
  if (!factory) {
    throw new InternalError(
      `The active renderer is '${renderer}', but no ${renderer} element factory is registered — a ` +
        'Comet cannot be rendered without it (the boundary would silently render as nothing). ' +
        "Import this project's own renderer entry point once, from its main module: " +
        `\`import '@zanix/space/${renderer}'\`.`,
    )
  }
  return factory
}

/**
 * Test-only reset — drops every registered factory, restoring the state a fresh process starts in.
 * Never called by library code.
 */
export function resetCometElementFactories(): void {
  delete factories.react
  delete factories.preact
}
