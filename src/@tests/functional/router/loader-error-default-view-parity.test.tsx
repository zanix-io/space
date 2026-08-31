import { assert, assertEquals } from '@std/assert'
import { extractDocumentSemantics } from 'modules/render/document-semantics.ts'
import { renderLoaderErrorResponse as renderLoaderErrorReact } from 'modules/router/render-loader-error-react.tsx'
import { renderLoaderErrorResponse as renderLoaderErrorPreact } from 'modules/router/render-loader-error-preact.ts'
import { DefaultErrorView as DefaultErrorViewReact } from 'modules/router/default-error-view.tsx'
import { DefaultErrorView as DefaultErrorViewPreact } from 'modules/router/default-error-view-preact.ts'

// ================================================================================================
// The built-in `DefaultErrorView` fallback — `loader-error-handler.ts`'s own counterpart to
// `not-found-parity.test.tsx`'s "the built-in default views carry NO <title> of their own" case,
// same reasoning: proves the same built-in view produces the same document semantics under either
// renderer, direct against `renderLoaderErrorResponse`, with no need for a full `loadRoutes()`/
// `handleGet` round trip (that full-flow coverage already lives in
// `functional/router/page-composition.test.tsx`'s own "no error.tsx anywhere" case).
// ================================================================================================

Deno.test(
  'DefaultErrorView [react and preact]: both render a real data-space="error" hook, a generic ' +
    'message, and NO <title> of their own — the head comes from the document model, exactly like ' +
    "DefaultNotFoundView's own contract",
  async () => {
    const cases = [
      ['react', DefaultErrorViewReact, renderLoaderErrorReact] as const,
      ['preact', DefaultErrorViewPreact, renderLoaderErrorPreact] as const,
    ]

    const results = await Promise.all(cases.map(async ([renderer, ErrorFallback, render]) => {
      const response = await render({
        ErrorFallback,
        RootLayout: undefined,
        error: new Error('should never be shown to an end user'),
        formattedError: {},
        params: {},
        fragmentOnly: false,
      })
      const html = await response.text()
      return { renderer, html, doc: extractDocumentSemantics(html) }
    }))

    for (const { renderer, html, doc } of results) {
      assert(html.includes('data-space="error"'), `[${renderer}] ${html}`)
      assert(html.includes('Something went wrong'), `[${renderer}] ${html}`)
      assert(
        !html.includes('should never be shown to an end user'),
        `[${renderer}] the built-in fallback must never render the raw error message: ${html}`,
      )
      assertEquals(doc.titles, [], `[${renderer}]`)
      assertEquals(doc.h1Count, 1, `[${renderer}]`)
    }
  },
)
