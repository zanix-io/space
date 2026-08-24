/**
 * The render phase of build validation — renders real routes and validates the documents they
 * actually produce.
 *
 * **How the renderer is obtained, and how it is not.** The probe is HANDED the active renderer by
 * its caller, which reads it from the page-renderer registry that `defineSpaceApp({ renderer })`
 * populates. The registry is still the single source of truth; the probe simply does not import it.
 *
 * That indirection is not stylistic: a page renderer registered eagerly would make
 * `@zanix/space/vite` — a BUILD-TOOL entry point — transitively pull `react-dom/server` into every
 * process that touches it, per its own module graph. Injection keeps the build entry free of the
 * SSR runtime while leaving the renderer decision exactly where it was.
 *
 * The chain is:
 *
 * ```
 * defineSpaceApp({ renderer })  →  page renderer registry  →  caller reads it  →  probe renders  →  DocumentSemantics  →  validation
 * ```
 *
 * and never:
 *
 * ```
 * files / imports  →  heuristic  →  assumed renderer  →  validation
 * ```
 *
 * Nothing here inspects imports, reads `deno.json`, scans `.tsx` sources, or looks for `react`/
 * `preact` anywhere in the tree. It does not even ASK which renderer is active: it calls whatever
 * renderer it was given. A probe that had to know would be a second place the renderer is decided,
 * and this package has exactly one.
 *
 * **What the probe measures.** The final document, never a renderer's internals. It renders, extracts
 * {@linkcode DocumentSemantics}, and hands that to the same `validateRenderedDocument` every other
 * consumer uses. It has no rules of its own and invents no diagnostics: a route that renders
 * something broken produces ordinary document diagnostics, so the reader learns what is wrong with
 * the document rather than that "the probe failed".
 *
 * **What it deliberately cannot cover.** Rendering needs data, and data needs a `loader`, so a route
 * with dynamic segments has no representative value a build could invent. Those routes are skipped
 * and REPORTED as skipped — partial coverage stated rather than implied.
 *
 * @module
 */
import type { ClassConstructor } from '@zanix/server'
import type { Diagnostic, ValidationConfig } from 'modules/validation/mod.ts'
import { validateRenderedDocument } from 'modules/validation/mod.ts'
import { extractDocumentSemantics } from 'modules/render/document-semantics.ts'
import { mockPageContext } from 'modules/testing/mock-page-context.ts'
import { getPageRenderer } from 'modules/router/page-renderer-registry.ts'
import type { PageRenderer } from 'modules/router/page-renderer-registry.ts'
import type { SpacePageController } from 'modules/router/space-page-controller.tsx'
import type { DiscoveredPage } from './discover-pages.ts'

/**
 * A page class this probe can render, under EITHER renderer.
 *
 * `SpacePageController<never>`, never the bare form and never `any`: `Params` appears
 * CONTRAVARIANTLY inside `SpacePageExtensions` (a page's own `loader` takes `PageContext<Params>`),
 * so `never` is the one type argument every page class is assignable TO, whatever param shape it
 * declared — a real structural supertype rather than a widening, and the same one
 * `page-tree-registry.ts` and both renderers' own `renderPageResponse` use. `TComponent` needs no
 * argument at all: it defaults to the renderer-neutral `SpaceComponent` (`typings/renderable.ts`),
 * so no widening is needed here to accept a correctly-typed Preact page alongside a React one.
 *
 * This probe never reads `Target` as a component anyway — it only forwards it to whichever renderer
 * it was handed.
 */
export type ProbeablePage = ClassConstructor<SpacePageController<never>>

/** Options for {@linkcode runRenderProbe}. */
export type RenderProbeOptions = {
  /** Pages from `discoverPages` — the same single pass everything else in the build reads. */
  pages: DiscoveredPage[]
  /**
   * Resolves a route's page class and its component. Injected rather than imported so the probe
   * never has to know how modules are loaded, and so it is testable without a real route tree.
   *
   * Returning `undefined` skips the route silently — it is the caller's job to say why, in the
   * `skipped` list it already maintains.
   */
  loadPage: (page: DiscoveredPage) => Promise<
    { Target: ProbeablePage; Component: unknown } | undefined
  >
  /**
   * The page renderer to probe with. **Omit it** — the default is the renderer the application
   * itself installed by importing `@zanix/space/react` or `@zanix/space/preact`, which is the only
   * correct answer for a build: the project already declared its renderer through
   * `defineSpaceApp({ renderer })`, and nothing here may second-guess that.
   *
   * Passing one explicitly is for isolation only (this package's own probe tests render both
   * renderers in one process, where no single installed runtime could serve both).
   *
   * `PageRenderer` is named directly: the registry reaches no renderer at all (0 value AND 0 type
   * edges, asserted in `renderer-agnostic-layer.test.ts`), so naming its type costs the build entry
   * point nothing. The entry-point split keeps `page-renderer-registry.ts` from statically importing
   * React's renderer as an eager default — the edge that would otherwise drag `react-dom/server`
   * into `@zanix/space/vite`.
   *
   * @throws {InternalError} When omitted and no renderer entry point has been imported — the same
   * actionable error every other consumer of the registry gets. There is deliberately no fallback
   * to React.
   */
  renderPage?: PageRenderer
  /** Origin used to build the request URL. Only affects what a page's own `ctx.url` reports. */
  origin?: string
  config?: ValidationConfig
}

/** What {@linkcode runRenderProbe} returns. */
export type RenderProbeResult = {
  diagnostics: Diagnostic[]
  /** Routes that were actually rendered and validated. */
  probed: string[]
  /** Routes that could not be, each with the reason. */
  skipped: string[]
}

/** Whether a route path carries a dynamic segment, which makes it unprobeable. */
export function hasDynamicSegment(routePath: string): boolean {
  return routePath.split('/').some((segment) => segment.startsWith(':'))
}

/**
 * Renders and validates every probeable route.
 *
 * @param options - See {@linkcode RenderProbeOptions}.
 * @returns Diagnostics from the rendered documents, plus what was covered and what was not.
 */
export async function runRenderProbe(
  options: RenderProbeOptions,
): Promise<RenderProbeResult> {
  const { pages, loadPage, origin = 'https://example.test', config } = options
  // Resolved once, before the loop: an omitted `renderPage` means "whatever this application
  // installed", and if nothing did, this throws here rather than once per route.
  const renderPage = options.renderPage ?? getPageRenderer()

  const diagnostics: Diagnostic[] = []
  const probed: string[] = []
  const skipped: string[] = []

  for (const page of pages) {
    if (hasDynamicSegment(page.routePath)) {
      skipped.push(
        `Route '${page.routePath}' has dynamic segments — rendering it would need data a build ` +
          'cannot invent, so it is not probed.',
      )
      continue
    }

    // deno-lint-ignore no-await-in-loop
    const loaded = await loadPage(page)
    if (!loaded) {
      skipped.push(`Route '${page.routePath}' could not be loaded for rendering.`)
      continue
    }

    let html: string
    // Sequential on purpose: rendering mutates process-wide registries (the request cache, the
    // active page tree) and two concurrent renders would interleave on them. The ignores sit on
    // the awaiting statements themselves, not on the `try` that wraps them — a `deno-lint-ignore`
    // applies to the next statement, and on the `try` it silenced nothing while reporting itself
    // as unused.
    try {
      // `renderPage` IS the renderer decision — made by the application, when it imported its own
      // entry point. The probe never asks which renderer is active and never chooses one.
      // deno-lint-ignore no-await-in-loop
      const response = await renderPage(
        loaded.Target,
        loaded.Component,
        mockPageContext({ url: new URL(`/${page.routePath}`, origin) }),
        undefined,
        false,
        undefined,
        undefined,
      )
      // deno-lint-ignore no-await-in-loop
      html = await response.text()
    } catch (error) {
      // DEFENSIVE, and rarely reached: both serializers document a contract of always resolving, so
      // a component that throws comes back as an empty 500 rather than as an exception — which the
      // probe then validates like any other response, producing DOC003. This branch exists for a
      // failure BELOW that contract (a renderer registry misconfiguration, an unloadable module).
      // Even here it reports a skip rather than a diagnostic: the probe has no rule for "rendering
      // threw", and inventing one would put policy in the probe, where it would have no code, no
      // severity and no basis.
      skipped.push(
        `Route '${page.routePath}' threw while rendering: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
      continue
    }

    probed.push(page.routePath)
    diagnostics.push(
      ...validateRenderedDocument({
        filePath: page.filePath,
        routePath: page.routePath,
        semantics: extractDocumentSemantics(html),
        html,
        // What the static side resolved, so `FW003` can tell "the renderer dropped the head" apart
        // from "nothing declared a title". Omitted for a dynamic head, where the static value is not
        // what the document was supposed to carry.
        expectedTitle: page.headIsDynamic ? undefined : page.head.title,
      }, config),
    )
  }

  return { diagnostics, probed, skipped }
}
