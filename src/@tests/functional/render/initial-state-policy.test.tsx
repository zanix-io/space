// Installs both renderers, exactly as a real app does.
import '../../../../mod-react.ts'
import '../../../../mod-preact.ts'
import { assert, assertEquals, assertFalse, assertInstanceOf, assertThrows } from '@std/assert'
import { InternalError } from '@zanix/errors'
import { createElement as reactCreateElement } from 'react'
import { createElement as preactCreateElement } from 'preact'
import { SpacePageController } from 'modules/router/mod.ts'
import { setPageTree } from 'modules/router/page-tree-registry.ts'
import { mockPageContext } from 'modules/testing/mod.ts'
import { renderPageResponse as renderReact } from 'modules/router/render-page-react.tsx'
import { renderPageResponse as renderPreact } from 'modules/router/render-page-preact.ts'
import { renderToResponse as renderToResponseReact } from 'modules/render/render-to-response.tsx'
import { renderToResponse as renderToResponsePreact } from 'modules/render/render-to-response-preact.ts'
import { CSP_SIGNATURE_NONE } from 'modules/router/csp-signature.ts'
import { decodeFromWire } from 'modules/render/serialization-codec.ts'
import { readInitialState } from 'modules/client/mod.ts'
import { defineComet } from 'modules/comets/define-comet.ts'
import { setCometManifest } from 'modules/comets/comet-manifest.ts'
import { setActiveRenderer } from 'modules/router/active-renderer.ts'
import { defineSpaceApp } from 'modules/runtime/mod.ts'
import {
  getInitialStatePolicy,
  resetExtendedSerialization,
  resetInitialStatePolicy,
  setExtendedSerialization,
  setInitialStatePolicy,
} from 'modules/render/serialization-registry.ts'
import { parseStateOption } from 'modules/render/initial-state-policy.ts'
import type { InitialStateOption } from 'typings/manifest.ts'
import { stripHydrationComments } from '../../support/strip-hydration-comments.ts'

/**
 * `serialization.state` through the REAL page render path of BOTH renderers: a page's `loader`
 * result is rendered as the component's props, and the app's policy decides what is serialized into
 * `self.__ZANIX_SPACE_STATE__`.
 *
 * The decisive assertions are the ones about what does NOT change: the document, minus that one
 * script, is the same in every mode, and the component always renders with the whole loader result.
 *
 * @module
 */

console.error = () => {}

type Renderer = 'react' | 'preact'

const MESSAGES = { 'home/greeting': 'Hola, mundo', 'home/farewell': 'Adiós' }
const SOURCE_URL = `file://${Deno.cwd()}/comets/state-widget.tsx`
const NONCE = 'abc123nonce'

function ReactWidget(props: { label?: string }) {
  return reactCreateElement('span', null, props.label ?? 'widget')
}
function PreactWidget(props: { label?: string }) {
  return preactCreateElement('span', null, props.label ?? 'widget')
}

type PageProps = { messages: Record<string, string>; title: string }

function ReactView(props: PageProps) {
  const Widget = defineComet(ReactWidget, SOURCE_URL)
  return reactCreateElement(
    'main',
    null,
    reactCreateElement('p', null, props.messages['home/greeting']),
    reactCreateElement(Widget as never, { label: 'from props' }),
  )
}

function PreactView(props: PageProps) {
  const Widget = defineComet(PreactWidget, SOURCE_URL)
  return preactCreateElement(
    'main',
    null,
    preactCreateElement('p', null, props.messages['home/greeting']),
    preactCreateElement(Widget as never, { label: 'from props' }),
  )
}

class ReactPage extends SpacePageController {
  public override component = ReactView as never
}

class PreactPage extends SpacePageController {
  public override component = PreactView as never
}

function reset() {
  resetInitialStatePolicy()
  resetExtendedSerialization()
  setCometManifest(undefined)
  setActiveRenderer('react')
}

async function render(
  renderer: Renderer,
  data: unknown,
  options: { fragmentOnly?: boolean; nonce?: string } = {},
): Promise<string> {
  setActiveRenderer(renderer)
  const Page = renderer === 'react' ? ReactPage : PreactPage
  setPageTree(Page, { filePath: `/fake/state-${renderer}.tsx`, segments: [] })
  const View = renderer === 'react' ? ReactView : PreactView
  const renderPage = renderer === 'react' ? renderReact : renderPreact
  const response = await renderPage(
    Page as never,
    View,
    mockPageContext({ url: new URL('https://example.com/es') }),
    data,
    options.fragmentOnly ?? false,
    options.nonce,
    undefined,
    CSP_SIGNATURE_NONE,
  )
  return await response.text()
}

const STATE_SCRIPT = /<script[^>]*>self\.__ZANIX_SPACE_STATE__=.*?<\/script>/s

/** The value of `self.__ZANIX_SPACE_STATE__` in a rendered document, or `undefined` when there is none. */
function readState(html: string): unknown {
  const match = html.match(/self\.__ZANIX_SPACE_STATE__=(.*?)(?:<\/script>|$)/s)
  if (!match) return undefined
  return JSON.parse(match[1])
}

/** A rendered document without the state script, which is the only thing a policy may change. */
function withoutState(html: string): string {
  return html.replace(STATE_SCRIPT, '')
}

const data = () => ({ lang: 'es', messages: MESSAGES, title: 'Hola' })

for (const renderer of ['react', 'preact'] as const) {
  Deno.test(`state (${renderer}): by default nothing crosses — no script and no global`, async () => {
    try {
      assertEquals(getInitialStatePolicy(), { mode: 'none' })
      const html = await render(renderer, data())
      assertFalse(html.includes('__ZANIX_SPACE_STATE__'), 'a state script was emitted')
      assertFalse(html.includes('home/farewell'), 'a message key leaked into the document')
      assertEquals(readState(html), undefined)
    } finally {
      reset()
    }
  })

  Deno.test(`state (${renderer}): readInitialState returns undefined when the page carries no state`, async () => {
    try {
      const html = await render(renderer, data())
      const record = globalThis as Record<string, unknown>
      delete record.__ZANIX_SPACE_STATE__
      assertEquals(readInitialState(), undefined)
      assertEquals(readState(html), undefined)
    } finally {
      reset()
    }
  })

  Deno.test(`state (${renderer}): 'all' serializes everything the loader returned`, async () => {
    try {
      setInitialStatePolicy(parseStateOption('all'))
      const html = await render(renderer, data())
      assertEquals(readState(html), data())
    } finally {
      reset()
    }
  })

  Deno.test(`state (${renderer}): { omit } leaves the listed keys out and keeps the rest`, async () => {
    try {
      setInitialStatePolicy(parseStateOption({ omit: ['messages'] }))
      const html = await render(renderer, data())
      assertEquals(readState(html), { lang: 'es', title: 'Hola' })
      assertFalse(html.includes('home/farewell'), 'a message key leaked into the document')
    } finally {
      reset()
    }
  })

  Deno.test(`state (${renderer}): { pick } lets only the listed keys through, ignoring absent ones`, async () => {
    try {
      setInitialStatePolicy(parseStateOption({ pick: ['title', 'missing'] }))
      const html = await render(renderer, data())
      assertEquals(readState(html), { title: 'Hola' })
    } finally {
      reset()
    }
  })

  Deno.test(`state (${renderer}): a nested key of the same name is handled with its parent`, async () => {
    try {
      const nested = { messages: MESSAGES, title: 'x', nested: { messages: { kept: true } } }
      setInitialStatePolicy(parseStateOption({ omit: ['messages'] }))
      assertEquals(readState(await render(renderer, nested)), {
        title: 'x',
        nested: { messages: { kept: true } },
      })
      setInitialStatePolicy(parseStateOption({ pick: ['messages'] }))
      assertEquals(readState(await render(renderer, nested)), { messages: MESSAGES })
    } finally {
      reset()
    }
  })

  Deno.test(`state (${renderer}): the component renders with the whole loader result in every mode`, async () => {
    try {
      for (const option of ['none', 'all', { omit: ['messages'] }, { pick: ['title'] }] as const) {
        setInitialStatePolicy(parseStateOption(option as InitialStateOption))
        // deno-lint-ignore no-await-in-loop -- sequential on purpose: the policy is app-wide state
        const html = await render(renderer, data())
        assert(html.includes('Hola, mundo'), `${JSON.stringify(option)}: ${html}`)
      }
    } finally {
      reset()
    }
  })

  Deno.test(`state (${renderer}): the loader result is not mutated in any mode`, async () => {
    try {
      for (const option of ['none', 'all', { omit: ['messages'] }, { pick: ['title'] }] as const) {
        setInitialStatePolicy(parseStateOption(option as InitialStateOption))
        const loaded = data()
        // deno-lint-ignore no-await-in-loop -- sequential on purpose: the policy is app-wide state
        await render(renderer, loaded)
        assertEquals(Object.keys(loaded), ['lang', 'messages', 'title'])
        assertEquals(loaded.messages, MESSAGES)
      }
    } finally {
      reset()
    }
  })

  Deno.test(`state (${renderer}): only the state script differs between modes — comet props, nonce and the rest stay`, async () => {
    try {
      setCometManifest(
        { [SOURCE_URL]: { id: 'state-widget', url: '/assets/state-widget.js' } } as never,
      )
      const none = await render(renderer, data(), { nonce: NONCE })
      assert(none.includes('data-comet-props'), 'the fixture must render a comet')
      setInitialStatePolicy(parseStateOption('all'))
      const all = await render(renderer, data(), { nonce: NONCE })
      assert(readState(all) !== undefined)
      assertEquals(withoutState(all), none)
      setInitialStatePolicy(parseStateOption({ omit: ['messages'] }))
      assertEquals(withoutState(await render(renderer, data(), { nonce: NONCE })), none)
      setInitialStatePolicy(parseStateOption({ pick: ['title'] }))
      assertEquals(withoutState(await render(renderer, data(), { nonce: NONCE })), none)
    } finally {
      reset()
    }
  })

  Deno.test(`state (${renderer}): the comet's own props are unchanged by the policy`, async () => {
    try {
      setCometManifest(
        { [SOURCE_URL]: { id: 'state-widget', url: '/assets/state-widget.js' } } as never,
      )
      const props = (html: string) =>
        stripHydrationComments(html).match(/data-comet-props="([^"]*)"/)?.[1]
      const none = props(await render(renderer, data()))
      setInitialStatePolicy(parseStateOption('all'))
      const all = props(await render(renderer, data()))
      assert(none !== undefined && none.includes('from props'))
      assertEquals(all, none)
    } finally {
      reset()
    }
  })

  Deno.test(`state (${renderer}): it works together with the extended-types codec in every mode`, async () => {
    try {
      setExtendedSerialization(true)
      const when = new Date('2026-10-03T10:00:00.000Z')
      const loaded = () => ({ messages: MESSAGES, when, tags: new Set(['a']), title: 'x' })

      setInitialStatePolicy(parseStateOption('all'))
      const all = decodeFromWire(readState(await render(renderer, loaded()))) as {
        when: Date
        tags: Set<string>
        messages: unknown
      }
      assertInstanceOf(all.when, Date)
      assertInstanceOf(all.tags, Set)
      assertEquals(all.messages, MESSAGES)

      setInitialStatePolicy(parseStateOption({ omit: ['messages'] }))
      const omitted = decodeFromWire(readState(await render(renderer, loaded()))) as {
        when: Date
        messages?: unknown
      }
      assertEquals(omitted.when.toISOString(), when.toISOString())
      assertEquals(omitted.messages, undefined)

      setInitialStatePolicy(parseStateOption({ pick: ['when'] }))
      const picked = decodeFromWire(readState(await render(renderer, loaded()))) as {
        when: Date
        title?: unknown
      }
      assertInstanceOf(picked.when, Date)
      assertEquals(picked.title, undefined)

      setInitialStatePolicy(parseStateOption('none'))
      assertEquals(readState(await render(renderer, loaded())), undefined)
    } finally {
      reset()
    }
  })

  Deno.test(`state (${renderer}): an Orbit fragment carries no state in any mode`, async () => {
    try {
      const none = await render(renderer, data(), { fragmentOnly: true })
      setInitialStatePolicy(parseStateOption('all'))
      const all = await render(renderer, data(), { fragmentOnly: true })
      assertEquals(readState(none), undefined)
      assertEquals(all, none)
      assert(all.includes('Hola, mundo'))
    } finally {
      reset()
    }
  })

  Deno.test(`state (${renderer}): what readInitialState returns on the client is what was emitted`, async () => {
    try {
      setInitialStatePolicy(parseStateOption({ pick: ['lang', 'title'] }))
      const html = await render(renderer, data())
      const record = globalThis as Record<string, unknown>
      record.__ZANIX_SPACE_STATE__ = readState(html)
      assertEquals(readInitialState(), { lang: 'es', title: 'Hola' })
    } finally {
      delete (globalThis as Record<string, unknown>).__ZANIX_SPACE_STATE__
      reset()
    }
  })

  Deno.test(`state (${renderer}): omit and pick serialize data that is not a plain object as it is`, async () => {
    try {
      setInitialStatePolicy(parseStateOption({ omit: ['messages'] }))
      assertEquals(readState(await render(renderer, [{ messages: 'kept' }])), [{
        messages: 'kept',
      }])
      setInitialStatePolicy(parseStateOption({ pick: ['x'] }))
      assertEquals(readState(await render(renderer, [{ messages: 'kept' }])), [{
        messages: 'kept',
      }])
    } finally {
      reset()
    }
  })

  Deno.test(`state (${renderer}): an explicit renderToResponse initialState is always emitted, whatever the policy`, async () => {
    try {
      const renderManual = renderer === 'react' ? renderToResponseReact : renderToResponsePreact
      const element = renderer === 'react'
        ? reactCreateElement('html', null, reactCreateElement('body', null, 'x'))
        : preactCreateElement('html', null, preactCreateElement('body', null, 'x'))
      setActiveRenderer(renderer)
      for (const option of ['none', 'all', { omit: ['id'] }, { pick: ['other'] }] as const) {
        setInitialStatePolicy(parseStateOption(option as InitialStateOption))
        // deno-lint-ignore no-await-in-loop -- sequential on purpose: the policy is app-wide state
        const html = await (await renderManual(element as never, { initialState: { id: '1' } }))
          .text()
        assertEquals(readState(html), { id: '1' }, JSON.stringify(option))
      }
    } finally {
      reset()
    }
  })
}

Deno.test('defineSpaceApp: serialization.state sets the policy when the app starts', () => {
  try {
    defineSpaceApp({ name: 'state-all', serialization: { state: 'all' } })
    assertEquals(getInitialStatePolicy(), { mode: 'all' })
    defineSpaceApp({ name: 'state-pick', serialization: { state: { pick: ['lang'] } } })
    assertEquals(getInitialStatePolicy(), { mode: 'pick', keys: ['lang'] })
    defineSpaceApp({ name: 'state-default' })
    assertEquals(getInitialStatePolicy(), { mode: 'none' })
  } finally {
    reset()
  }
})

Deno.test('defineSpaceApp: an invalid serialization.state throws when the app starts, with a message to act on', () => {
  try {
    const combined = assertThrows(
      () =>
        defineSpaceApp({
          name: 'state-combined',
          serialization: { state: { omit: ['a'], pick: ['b'] } as never },
        }),
      InternalError,
    )
    assert(combined.message.includes("cannot combine 'omit' and 'pick'"), combined.message)
    const unknown = assertThrows(
      () => defineSpaceApp({ name: 'state-bad', serialization: { state: 'some' as never } }),
      InternalError,
    )
    assert(unknown.message.includes("'some'"), unknown.message)
  } finally {
    reset()
  }
})
