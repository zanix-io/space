import { assert, assertEquals, assertFalse, assertThrows } from '@std/assert'
import { InternalError } from '@zanix/errors'
import { renderToResponse } from '../../../../mod-react.ts'
import { defineComet } from 'modules/comets/define-comet.ts'
import { setCometManifest } from 'modules/comets/comet-manifest.ts'
import { stripHydrationComments } from '../../support/strip-hydration-comments.ts'

console.error = () => {}

function Counter({ initial }: { initial: number }) {
  return <button type='button'>{initial}</button>
}

const FIXTURE_SOURCE_URL = `file://${Deno.cwd()}/comets/counter.tsx`

Deno.test(
  'defineComet: renders the real component, wrapped in a marker carrying its metadata',
  async () => {
    setCometManifest({
      [`${Deno.cwd()}/comets/counter.tsx`]: '/assets/counter-hash.js',
    })
    try {
      const Comet = defineComet(Counter, FIXTURE_SOURCE_URL)

      const response = await renderToResponse(
        <Comet initial={3} comet='visible' />,
      )
      const html = stripHydrationComments(await response.text())

      assert(html.includes('data-comet-strategy="visible"'), html)
      assert(
        html.includes('data-comet-module="/assets/counter-hash.js"'),
        html,
      )
      assert(html.includes('data-comet-export="Counter"'), html)
      assert(html.includes('data-comet-props="{&quot;initial&quot;:3}"'), html)
      assert(html.includes('<button type="button">3</button>'), html)
    } finally {
      setCometManifest(undefined)
    }
  },
)

Deno.test(
  'defineComet: with no manifest loaded, derives a dev-mode URL from the project root',
  async () => {
    setCometManifest(undefined)
    const Comet = defineComet(Counter, FIXTURE_SOURCE_URL)

    const response = await renderToResponse(<Comet initial={0} />)
    const html = await response.text()

    assert(html.includes('data-comet-module="/comets/counter.tsx"'), html)
  },
)

Deno.test(
  'defineComet: a manifest with no entry for this comet falls back to the raw source URL',
  async () => {
    setCometManifest({ '/some/other/file.tsx': '/assets/other-hash.js' })
    try {
      const Comet = defineComet(Counter, FIXTURE_SOURCE_URL)

      const response = await renderToResponse(<Comet initial={0} />)
      const html = await response.text()

      assert(html.includes(`data-comet-module="${FIXTURE_SOURCE_URL}"`), html)
    } finally {
      setCometManifest(undefined)
    }
  },
)

Deno.test('defineComet: defaults to the "load" strategy when comet is omitted', async () => {
  const Comet = defineComet(Counter, FIXTURE_SOURCE_URL)

  const response = await renderToResponse(<Comet initial={0} />)
  const html = await response.text()

  assert(html.includes('data-comet-strategy="load"'), html)
})

Deno.test('defineComet: comet="none" renders the plain component, no marker at all', async () => {
  const Comet = defineComet(Counter, FIXTURE_SOURCE_URL)

  const response = await renderToResponse(<Comet initial={5} comet='none' />)
  const html = stripHydrationComments(await response.text())

  assertEquals(html, '<button type="button">5</button>')
  assertFalse(html.includes('data-comet'))
})

Deno.test(
  'defineComet: comet="only" renders the marker with no server-rendered content',
  async () => {
    const Comet = defineComet(Counter, FIXTURE_SOURCE_URL)

    const response = await renderToResponse(<Comet initial={7} comet='only' />)
    const html = stripHydrationComments(await response.text())

    assert(html.includes('data-comet-strategy="only"'), html)
    assertFalse(
      html.includes('<button'),
      'the real component must not render server-side for "only"',
    )
  },
)

Deno.test('defineComet: forwards cometMedia as the media marker attribute', async () => {
  const Comet = defineComet(Counter, FIXTURE_SOURCE_URL)

  const response = await renderToResponse(
    <Comet initial={1} comet='media' cometMedia='(max-width: 768px)' />,
  )
  const html = await response.text()

  assert(html.includes('data-comet-media="(max-width: 768px)"'), html)
})

Deno.test(
  'defineComet: the wrapper defaults to display:contents so it never breaks a parent grid/flex layout',
  async () => {
    const Comet = defineComet(Counter, FIXTURE_SOURCE_URL)

    const response = await renderToResponse(
      <Comet initial={0} comet='visible' />,
    )
    const html = await response.text()

    assert(html.includes('style="display:contents"'), html)
  },
)

Deno.test('defineComet: throws for an anonymous component', () => {
  assertThrows(
    () => defineComet(() => null, FIXTURE_SOURCE_URL),
    InternalError,
    'defineComet() requires a named component',
  )
})

Deno.test(
  'defineComet: unserializable props (a circular reference) fail with a clear, Space-authored ' +
    'InternalError naming the Comet — not a raw JSON.stringify TypeError escaping the render ' +
    "(initial-state-global.ts's own serialization contract)",
  async () => {
    const Comet = defineComet(Counter, FIXTURE_SOURCE_URL)
    // deno-lint-ignore no-explicit-any
    const circularProps: any = { initial: 0 }
    circularProps.self = circularProps

    let reported: unknown
    const response = await renderToResponse(
      <Comet {...circularProps} comet='visible' />,
      { onError: (error) => (reported = error) },
    )

    // Same shape as any other render error reaching this function (see
    // 'a shell render error yields status 500 and calls onError', above) — a Comet's own props
    // are evaluated as part of a normal render pass, so an uncaught throw here already propagates
    // through the exact same machinery, it's just a clear InternalError instead of a raw one.
    assertEquals(response.status, 500)
    assert(reported instanceof InternalError, String(reported))
    assert(
      (reported as InternalError).message.includes('Counter'),
      (reported as InternalError).message,
    )
    assert(
      (reported as InternalError).message.includes('not JSON-serializable'),
      (reported as InternalError).message,
    )
  },
)
