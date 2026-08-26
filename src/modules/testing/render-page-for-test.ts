import type { ClassConstructor, HandlerContext } from '@zanix/server'
import type { SpacePageController } from 'modules/router/space-page-controller.ts'
import { mockHandlerContext } from './mock-handler-context.ts'

/** What {@linkcode renderPageForTest} resolves to. */
export type RenderPageForTestResult = { response: Response; html: string }

/**
 * Runs a `SpacePageController` subclass's real `loader`→`component`→render pipeline in-process —
 * the "functional" level of the framework's own testing convention (unit/functional/integration) —
 * without a real HTTP server. Builds a `HandlerContext` (via {@linkcode mockHandlerContext}),
 * instantiates `Controller`, and calls its `handleGet` directly.
 *
 * @template Params - The route's dynamic segments, inferred from `Controller`'s own `Params`
 * generic — never needs naming explicitly.
 * @template TComponent - The real component type `Controller`'s own `component` field must
 * satisfy, matching {@linkcode SpacePageController}'s own `TComponent` template param. Defaults to
 * `any` and is never inferred from `Controller` (see the `NoInfer` wrapper below): every renderer's
 * page — React's default `ComponentType`, Preact's, or any other — is accepted without naming this
 * explicitly, since this function never reads `component` itself.
 * @param Controller - The page class to render. Never instantiate it yourself and call `handleGet`
 * for this — `renderPageForTest` handles the context wiring `handleGet` expects.
 * @param params - The route's dynamic segments (e.g. `{ id: '1' }` for a `[id]/page.tsx` file).
 * Typed against `Controller`'s own `Params` generic — a page declared as
 * `SpacePageController<{ id: string }>` requires `{ id: string }` here, not just any
 * `Record<string, string>`.
 * @param ctxOverrides - Any other `HandlerContext` field to override (e.g. `req` for a custom
 * `Accept`/cookie header a guard reads).
 *
 * @example
 * ```ts
 * import { renderPageForTest } from '@zanix/space/testing'
 *
 * const { html } = await renderPageForTest(ProductPage, { id: '1' })
 * ```
 */
export async function renderPageForTest<
  Params = Record<string, string>,
  // deno-lint-ignore no-explicit-any
  TComponent = any,
>(
  // `NoInfer` keeps `TComponent` from ever being inferred from `Controller` itself — every
  // concrete page's own `component = X` field narrows to `typeof X` rather than the class's
  // declared `TComponent` default, and inferring `TComponent` from that narrowed type here would
  // make the resulting `SpacePageController<Params, never, TComponent>` a structurally different
  // (invariant, through `HandlerBaseClass`'s index signature) type from `Controller`'s own —
  // rejecting the page regardless of its renderer. `NoInfer` leaves `TComponent` at its `any`
  // default unless a caller names it explicitly, which stays validated against `Controller` like
  // any other explicit type argument.
  Controller: ClassConstructor<SpacePageController<Params, never, NoInfer<TComponent>>>,
  params: Params = {} as Params,
  ctxOverrides: Partial<HandlerContext> = {},
): Promise<RenderPageForTestResult> {
  const ctx = mockHandlerContext({
    ...ctxOverrides,
    payload: {
      params: params as unknown as Record<string, string>,
      search: {},
      body: undefined,
      ...ctxOverrides.payload,
    },
  })

  const instance = new Controller(ctx as never)
  const response = await instance.handleGet(ctx)
  const html = await response.clone().text()

  return { response, html }
}
