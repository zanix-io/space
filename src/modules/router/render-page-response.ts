import type { ClassConstructor, HandlerContext } from '@zanix/server'
import type { PageContext } from 'typings/page.ts'
import { getPageRenderer } from './page-renderer-registry.ts'
import { resolvePageHeaders } from './default-page-headers.ts'
import { applySecurityGuards } from './page-security.ts'
import { getThemeResolver } from '../theme/theme-registry.ts'
import { serializeThemeStyle } from '../theme/theme-style.ts'
import type { PageHeaderOptions } from './space-page-controller.ts'
import { ORBIT_FRAGMENT_HEADER } from './orbit-protocol.ts'
import type { SpacePageController } from './space-page-controller.ts'

/**
 * The tail every page render finishes with — renderer indirection, `Vary`, optional status
 * override, security headers.
 *
 * Its own module because two callers now share it: `handleGet`, which has always run it, and
 * `handlePost`, which reuses it verbatim to re-render a page whose action payload failed
 * validation. Duplicating it would have been the easy path and a bad one — the `Vary` header below
 * is the kind of detail that is easy to get subtly wrong the second time, and a `422` that
 * differed from a `200` in caching semantics would be a bug nobody notices until a shared cache
 * serves the wrong shape.
 *
 * @module
 */

/**
 * Renders `component` for `pageCtx` and finishes the response.
 *
 * @param Target - The page class, forwarded to the active renderer for its statics.
 * @param component - The page's own component.
 * @param pageCtx - The request-scoped page context, including any validation errors.
 * @param data - Whatever this page's `loader` resolved.
 * @param fragmentOnly - `true` for an Orbit fragment request.
 * @param nonce - The CSP nonce, or `undefined` when this page has CSP disabled.
 * @param themeStyle - The serialized `theme.resolve` overrides, if any.
 * @param applySecurity - Applies this page's resolved security headers to the finished response.
 * @param status - `422` for a failed action re-render; omit for whatever the renderer produced.
 * @returns The finished response.
 */
export async function renderPageResponse<Params>(
  Target: ClassConstructor<SpacePageController>,
  component: unknown,
  pageCtx: PageContext<Params>,
  data: unknown,
  fragmentOnly: boolean,
  nonce: string | undefined,
  themeStyle: string | undefined,
  applySecurity: (response: Response) => Response,
  status?: number,
): Promise<Response> {
  const rendered = await getPageRenderer()(
    Target,
    component,
    pageCtx,
    data,
    fragmentOnly,
    nonce,
    themeStyle,
  )
  // A full document and an Orbit fragment never share a body even though they share a URL, so
  // `Vary` has to be set unconditionally — not only when this page also opts into
  // ETag/cache-control — or a shared HTTP cache sitting in front of this app could serve one shape
  // to a request that asked for the other.
  const response = status === undefined
    ? rendered
    : new Response(rendered.body, { status, headers: rendered.headers })
  response.headers.set('vary', ORBIT_FRAGMENT_HEADER)
  return applySecurity(response)
}

/** What {@linkcode resolvePageChrome} resolves before a page can be rendered. */
export type PageChrome = {
  /** Applies this page's resolved security headers to a finished response. */
  applySecurity: (response: Response) => Response
  /** The CSP nonce, or `undefined` when this page has CSP disabled or uses a static policy. */
  nonce: string | undefined
  /** Serialized `theme.resolve` overrides for this request, or `undefined` when none apply. */
  themeStyle: string | undefined
}

/**
 * Resolves the security headers, CSP nonce and theme overrides a render needs.
 *
 * Shared by `handleGet` and by the failed-action re-render so the two cannot drift: a `422` carries
 * exactly the chrome a `200` would, including the nonce — without which the re-rendered page's own
 * scripts would be blocked by its own CSP.
 *
 * @param ctx - The handler context, for the security guards.
 * @param pageHeaders - This page's own `headers` static, unresolved.
 * @param pageCtx - The page context, for the theme resolver's population/lang inputs.
 * @returns The chrome to hand to {@linkcode renderPageResponse}.
 */
export async function resolvePageChrome<Params>(
  ctx: HandlerContext,
  pageHeaders: PageHeaderOptions | false | undefined,
  pageCtx: PageContext<Params>,
): Promise<PageChrome> {
  const { headers: securityHeaders, nonce } = await applySecurityGuards(
    ctx,
    resolvePageHeaders(pageHeaders),
  )
  const resolvedTokens = getThemeResolver()?.({
    population: pageCtx.population,
    lang: (pageCtx.params as Record<string, string> | undefined)?.lang,
    request: pageCtx.request,
  })
  return {
    nonce,
    themeStyle: resolvedTokens ? serializeThemeStyle(resolvedTokens) : undefined,
    applySecurity: (response: Response): Response => {
      for (const [key, value] of Object.entries(securityHeaders)) {
        response.headers.set(key, value)
      }
      return response
    },
  }
}
