import { assertEquals, assertStringIncludes } from '@std/assert'
import { join } from '@std/path'
import { createElement as reactCreateElement } from 'react'
import { createElement as preactCreateElement } from 'preact'
// Test-only VALUE import — proven byte-identical to `@zanix/cli`'s own `compileCatalog` output by
// that package's own golden tests (`compile-messages.test.ts`). Used here to build a genuinely
// precompiled AST fixture without a second TEMP path into `cli` just to re-derive the same value —
// see this project's own `deno.jsonc` for the full reasoning.
import { parse } from '@formatjs/icu-messageformat-parser'
import { getTemporaryFolder } from '@zanix/helpers'
import { IntlProvider as ReactIntlProvider, useIntl as useReactIntl } from '@zanix/space-ui/intl'
import {
  IntlProvider as PreactIntlProvider,
  useIntl as usePreactIntl,
} from '@zanix/space-ui/intl/preact'
import { loadMessages } from 'modules/i18n/load-messages.ts'
import { resetMessagesDir, setMessagesDir } from 'modules/i18n/messages-registry.ts'
import { SpacePageController } from 'modules/router/mod.ts'
import { setPageTree } from 'modules/router/page-tree-registry.ts'
import { mockPageContext } from 'modules/testing/mod.ts'
import { extractDocumentSemantics } from 'modules/render/document-semantics.ts'
import { comparableSemantics } from '../../support/document-parity.ts'
import { renderPageResponse as renderReact } from 'modules/router/render-page-react.tsx'
import { renderPageResponse as renderPreact } from 'modules/router/render-page-preact.ts'

/**
 * The full pipeline this feature exists to prove, end to end, for real:
 *
 *   source ICU JSON (mixed: a plain string + a real precompiled AST)
 *     → loadMessages()                          (@zanix/space, completely opaque to either shape)
 *     → space-ui's IntlProvider/useIntl/formatMessage  (React AND Preact, independent bindings)
 *     → a real SSR render through this package's own page renderer
 *
 * Not a subprocess/poisoned-import-map test — that's `i18n-renderer-isolation.test.ts`'s job
 * (proving EXCLUSIVITY: a Preact render never evaluates React at all, and vice versa). This file
 * proves CORRECTNESS: the formatted output is right, and it's right identically on both renderers.
 *
 * Renderer parity is asserted via `DocumentSemantics` (`comparableSemantics`), same contract
 * `document-parity.test.tsx` already establishes for this package — never a raw HTML string diff,
 * which would fail on meaningless differences (attribute order, void-element closing) between
 * `react-dom/server` and `preact-render-to-string`. The actual FORMATTED TEXT (interpolation,
 * plural, mixed-catalog resolution) is checked via `assertStringIncludes` on each render's own
 * output — `DocumentSemantics` deliberately only tracks `hasTextContent: boolean` (see
 * `document-model.ts`'s own doc), not what the text says, so content correctness has no other way
 * to be checked than reading the body.
 *
 * @module
 */

console.error = () => {}

async function buildMixedCatalog(dir: string): Promise<void> {
  await Deno.mkdir(join(dir, 'en'), { recursive: true })
  await Deno.writeTextFile(
    join(dir, 'en', 'index.json'),
    JSON.stringify({
      // Plain — not yet compiled.
      'home/title': 'Welcome',
      'home/greet': 'Hello, {name}!',
      // Precompiled — a real AST, mixed into the SAME catalog as the two plain values above. This
      // is the exact scenario `loadMessages()`'s own test suite already proves it never inspects:
      // this file proves the OTHER end of that same claim — that space-ui's formatter consumes it
      // correctly too, through a real SSR render, not just a unit-level `createFormatter()` call.
      'home/cart': parse('{count, plural, one {# item} other {# items}}'),
    }),
  )
}

function ReactInner() {
  const { formatMessage } = useReactIntl()
  return reactCreateElement(
    'main',
    null,
    reactCreateElement('h1', null, formatMessage('home/title')),
    reactCreateElement(
      'p',
      { 'data-testid': 'greet' },
      formatMessage('home/greet', { name: 'Ada' }),
    ),
    reactCreateElement('p', { 'data-testid': 'cart' }, formatMessage('home/cart', { count: 3 })),
  )
}

function PreactInner() {
  const { formatMessage } = usePreactIntl()
  return preactCreateElement(
    'main',
    null,
    preactCreateElement('h1', null, formatMessage('home/title')),
    preactCreateElement(
      'p',
      { 'data-testid': 'greet' },
      formatMessage('home/greet', { name: 'Ada' }),
    ),
    preactCreateElement('p', { 'data-testid': 'cart' }, formatMessage('home/cart', { count: 3 })),
  )
}

async function renderPipeline(
  renderer: 'react' | 'preact',
): Promise<{ semantics: ReturnType<typeof extractDocumentSemantics>; html: string }> {
  const messages = await loadMessages({ lang: 'en' })

  const View = renderer === 'react'
    ? () =>
      reactCreateElement(
        ReactIntlProvider,
        { locale: 'en', messages },
        reactCreateElement(ReactInner),
      )
    : () =>
      preactCreateElement(
        PreactIntlProvider,
        { locale: 'en', messages },
        preactCreateElement(PreactInner, null),
      )

  class Page extends SpacePageController {
    public override component = View
    public static override head = { title: 'i18n E2E' }
  }
  setPageTree(Page as never, { filePath: `/fake/i18n-e2e-${renderer}.tsx`, segments: [{}] })

  const pageCtx = mockPageContext({ url: new URL('https://example.com/en/i18n-e2e') })
  const render = renderer === 'react' ? renderReact : renderPreact
  const response = await render(
    Page as never,
    View,
    pageCtx,
    undefined,
    false,
    undefined,
    undefined,
  )
  const html = await response.text()
  return { semantics: extractDocumentSemantics(html), html }
}

// --- setup/teardown --------------------------------------------------------------------------

function withMessagesDir(run: (dir: string) => Promise<void>): () => Promise<void> {
  return async () => {
    const dir = await Deno.makeTempDir({ dir: getTemporaryFolder(import.meta.url) })
    try {
      await buildMixedCatalog(dir)
      setMessagesDir(dir)
      await run(dir)
    } finally {
      resetMessagesDir()
      await Deno.remove(dir, { recursive: true })
    }
  }
}

// --- content correctness, per renderer -----------------------------------------------------------

Deno.test(
  'i18n pipeline (react): a plain message, interpolation, an ICU plural, and a precompiled-AST ' +
    'value from the SAME mixed catalog all format correctly through a real SSR render',
  withMessagesDir(async () => {
    const { html } = await renderPipeline('react')
    assertStringIncludes(html, '<h1>Welcome</h1>')
    assertStringIncludes(html, 'Hello, Ada!')
    assertStringIncludes(html, '3 items')
  }),
)

Deno.test(
  "i18n pipeline (preact): the identical mixed catalog formats identically through Preact's own " +
    'real SSR render',
  withMessagesDir(async () => {
    const { html } = await renderPipeline('preact')
    assertStringIncludes(html, '<h1>Welcome</h1>')
    assertStringIncludes(html, 'Hello, Ada!')
    assertStringIncludes(html, '3 items')
  }),
)

// --- renderer parity, via DocumentSemantics — never a raw HTML string diff -----------------------

Deno.test(
  'i18n pipeline: React and Preact produce a document-level-equivalent document for the exact ' +
    'same fixture — compared via DocumentSemantics, not HTML strings',
  withMessagesDir(async () => {
    const react = await renderPipeline('react')
    const preact = await renderPipeline('preact')
    assertEquals(comparableSemantics(react.semantics), comparableSemantics(preact.semantics))
    // Both real renders, not an empty shell that would pass this comparison vacuously.
    assertEquals(react.semantics.hasTextContent, true)
    assertEquals(preact.semantics.hasTextContent, true)
  }),
)
