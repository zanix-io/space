// Installs both renderers, exactly as `define-comet-preact.test.ts` does — this suite renders
// through both real SSR paths in one process.
import '../../../../mod-react.ts'
import '../../../../mod-preact.ts'
import { assert, assertEquals, assertNotEquals } from '@std/assert'
import { createElement } from 'preact'
import type { ComponentType as ComponentTypeReact } from 'react'
import { defineComet } from 'modules/comets/define-comet.ts'
import { hashSourceKey, normalizeSourceKey } from 'modules/comets/comet-manifest.ts'
import { useCometStableId } from 'modules/comets/comet-id-scope-react.tsx'
import { useCometStableId as useCometStablePreactId } from 'modules/comets/comet-id-scope-preact.tsx'
import { setActiveRenderer } from 'modules/router/active-renderer.ts'
import { renderToResponse } from '../../../../mod-react.ts'
import { renderToResponse as renderToResponsePreact } from 'modules/render/render-to-response-preact.ts'
import type { CometProps } from 'typings/comet.ts'

/**
 * Regression suite for `useCometStableId`: `useId()`'s own guarantee (same value server and
 * client) only holds within ONE hydration root, and a ready-made Comet hydrates as its own,
 * isolated root — so native `useId()` inside a Comet's content mismatches between the whole-page
 * server render and the Comet's own isolated client hydration (the real, reproduced NavDrawer
 * `aria-controls` defect in `@zanix/space-ui`). These tests exercise the FIX at its real seam: a
 * Comet's own SSR render (`define-comet.ts`'s `CometBoundary`, the same code path a real
 * whole-page render takes), never a hand-rolled Context test in isolation.
 *
 * @module
 */

console.error = () => {}

function IdField({ label }: { label: string }) {
  const id = useCometStableId()
  return <div id={id}>{label}</div>
}

function TwoIds({ label }: { label: string }) {
  const a = useCometStableId()
  const b = useCometStableId()
  return (
    <div>
      <span id={a} />
      <span id={b} />
      {label}
    </div>
  )
}

function PreactIdField(props: { label: string }) {
  const id = useCometStablePreactId()
  return createElement('div', { id }, props.label)
}

function PreactTwoIds(props: { label: string }) {
  const a = useCometStablePreactId()
  const b = useCometStablePreactId()
  return createElement(
    'div',
    null,
    createElement('span', { id: a }),
    createElement('span', { id: b }),
    props.label,
  )
}

/** Same cast `define-comet-preact.test.ts` centralizes — `defineComet`'s public API is
 * React-shaped regardless of the active renderer. */
function defineCometPreact<P extends object>(
  Component: (props: P) => unknown,
  sourceUrl: string,
): ComponentTypeReact<P & CometProps> {
  return defineComet(Component as unknown as ComponentTypeReact<P>, sourceUrl)
}

const FIELD_SOURCE_URL = `file://${Deno.cwd()}/comets/id-field.tsx`
const TWO_IDS_SOURCE_URL = `file://${Deno.cwd()}/comets/two-ids.tsx`
const PREACT_FIELD_SOURCE_URL = `file://${Deno.cwd()}/comets/preact-id-field.tsx`
const PREACT_TWO_IDS_SOURCE_URL = `file://${Deno.cwd()}/comets/preact-two-ids.tsx`

function extractIds(html: string): string[] {
  return [...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1])
}

function reset() {
  setActiveRenderer('react')
}

Deno.test(
  'useCometStableId (react): deterministic — the same source and props yield the same id across ' +
    'two independent renders, exactly what server render and client hydration each need to agree on',
  async () => {
    const Comet = defineComet(IdField, FIELD_SOURCE_URL)
    const htmlA = await (await renderToResponse(<Comet label='x' comet='visible' />)).text()
    const htmlB = await (await renderToResponse(<Comet label='x' comet='visible' />)).text()

    assertEquals(extractIds(htmlA), extractIds(htmlB))
  },
)

Deno.test(
  'useCometStableId (react): two instances of the same Comet with DIFFERENT props get different ids',
  async () => {
    const Comet = defineComet(IdField, FIELD_SOURCE_URL)
    const htmlA = await (await renderToResponse(<Comet label='x' comet='visible' />)).text()
    const htmlB = await (await renderToResponse(<Comet label='y' comet='visible' />)).text()

    assertNotEquals(extractIds(htmlA), extractIds(htmlB))
  },
)

Deno.test(
  "useCometStableId (react): the generated id is scoped to this Comet's own source — carries the " +
    "same hash as data-comet's own value",
  async () => {
    const Comet = defineComet(IdField, FIELD_SOURCE_URL)
    const html = await (await renderToResponse(<Comet label='x' comet='visible' />)).text()

    const expectedHash = hashSourceKey(normalizeSourceKey(FIELD_SOURCE_URL))
    assert(extractIds(html)[0].startsWith(`${expectedHash}-`), html)
  },
)

Deno.test(
  'useCometStableId (react): sibling calls within the SAME instance share one counter — distinct, ' +
    "sequential ids (Menu's own per-item ids nested inside NavDrawer is the real shape this covers)",
  async () => {
    const Comet = defineComet(TwoIds, TWO_IDS_SOURCE_URL)
    const html = await (await renderToResponse(<Comet label='z' comet='visible' />)).text()

    const ids = extractIds(html)
    assertEquals(ids.length, 2)
    assertNotEquals(ids[0], ids[1])
  },
)

Deno.test(
  'useCometStableId (react): outside any Comet boundary, it is a plain passthrough to useId() — ' +
    'the overwhelmingly common case, every component in a normal page tree',
  async () => {
    const html = await (await renderToResponse(<IdField label='bare' />)).text()

    assertEquals(extractIds(html).length, 1)
  },
)

Deno.test(
  'useCometStableId (react): comet="none" renders the plain component with no id-scope Provider — ' +
    'falls back to useId() the same as outside any boundary',
  async () => {
    const Comet = defineComet(IdField, FIELD_SOURCE_URL)
    const html = await (await renderToResponse(<Comet label='bare' comet='none' />)).text()

    assertEquals(extractIds(html).length, 1)
  },
)

Deno.test(
  'useCometStableId (preact): deterministic, disambiguates by props, and scopes sibling calls to ' +
    'one shared counter — the same three guarantees as the React implementation',
  async () => {
    try {
      setActiveRenderer('preact')
      const FieldComet = defineCometPreact(PreactIdField, PREACT_FIELD_SOURCE_URL)
      const htmlA = await (await renderToResponsePreact(
        createElement(FieldComet as never, { label: 'x', comet: 'visible' }),
      )).text()
      const htmlB = await (await renderToResponsePreact(
        createElement(FieldComet as never, { label: 'x', comet: 'visible' }),
      )).text()
      const htmlC = await (await renderToResponsePreact(
        createElement(FieldComet as never, { label: 'y', comet: 'visible' }),
      )).text()

      assertEquals(extractIds(htmlA), extractIds(htmlB))
      assertNotEquals(extractIds(htmlA), extractIds(htmlC))

      const TwoIdsComet = defineCometPreact(PreactTwoIds, PREACT_TWO_IDS_SOURCE_URL)
      const htmlTwo = await (await renderToResponsePreact(
        createElement(TwoIdsComet as never, { label: 'z', comet: 'visible' }),
      )).text()
      const ids = extractIds(htmlTwo)
      assertEquals(ids.length, 2)
      assertNotEquals(ids[0], ids[1])
    } finally {
      reset()
    }
  },
)

Deno.test(
  'useCometStableId (preact): outside any Comet boundary, it is a plain passthrough to useId()',
  async () => {
    try {
      setActiveRenderer('preact')
      const html = await (await renderToResponsePreact(
        createElement(PreactIdField, { label: 'bare' }),
      )).text()

      assertEquals(extractIds(html).length, 1)
    } finally {
      reset()
    }
  },
)
