// Installs a renderer, exactly as a real app does: `@zanix/space` itself ships none, so a
// test that renders must import the entry point it is testing against.
import '../../../../mod-react.ts'
import '../../../../mod-preact.ts'
import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { createElement as preactElement } from 'preact'
import type { ComponentChildren, ComponentType as PreactComponentType } from 'preact'
import { createElement as reactElement } from 'react'
import type { ComponentType as ReactComponentType, ReactNode } from 'react'
import { defineComet } from 'modules/comets/define-comet.ts'
import type { CometProps } from 'typings/comet.ts'
import { setCometManifest } from 'modules/comets/comet-manifest.ts'
import { setActiveRenderer } from 'modules/router/active-renderer.ts'
import { renderToResponse as renderToResponsePreact } from 'modules/render/render-to-response-preact.ts'
import { renderToResponse as renderToResponseReact } from 'modules/render/render-to-response.tsx'
// Imported for its REAL registration side effect (Preact's own `createElement` as the Comet
// element factory) — the same wiring a `--renderer=preact` app reaches through `defineSpaceApp`.
import 'modules/router/render-page-preact.ts'
import { COMET_EXPORT_ATTR, COMET_ID_ATTR } from 'modules/comets/marker.ts'

/**
 * Regression suite for `defineComet`'s own SIGNATURE, as distinct from its runtime.
 *
 * The runtime has been renderer-agnostic since `element-factory.ts` existed (see
 * `define-comet-preact.test.ts`, which pins that). The signature was not: it named React's own
 * `ComponentType`/`ReactElement`, so a `--renderer=preact` app — whose Comets this same function
 * renders perfectly at runtime — could only call it through an `as unknown as ComponentType<...>`
 * cast. That cast was carried, and documented as a real type-level gap, by this package's own
 * Preact benchmark comets.
 *
 * Every `defineComet` call below is deliberately CAST-FREE, and each one passes a component typed
 * as its own renderer's real `ComponentType`. That is the actual assertion: this file failing to
 * TYPE-CHECK is the regression, exactly as much as any runtime assertion in it failing. The
 * runtime assertions are here so a type-only fix that broke real rendering could not pass either.
 *
 * @module
 */

console.error = () => {}

/** A Preact comet, typed as Preact's own `ComponentType` — never React's. */
const PreactWidget: PreactComponentType<{ label: string }> = ({ label }) =>
  preactElement('span', { class: 'widget' }, `preact:${label}`)
// Named for `defineComet`'s own `Component.name` contract (the client imports this export back).
Object.defineProperty(PreactWidget, 'name', { value: 'PreactWidget' })

/** The React counterpart, typed as React's own `ComponentType`. */
const ReactWidget: ReactComponentType<{ label: string }> = ({ label }) =>
  reactElement('span', { className: 'widget' }, `react:${label}`)
Object.defineProperty(ReactWidget, 'name', { value: 'ReactWidget' })

// No cast anywhere on either line — this is the fix, stated as code.
const PreactComet = defineComet(PreactWidget, 'file:///comets/preact-widget.tsx')
const ReactComet = defineComet(ReactWidget, 'file:///comets/react-widget.tsx')

// -- Type-level assertions ----------------------------------------------------------------------
//
// Checked by `deno test`'s own type-checking pass, not at runtime: each wrapper must be usable
// wherever its OWN renderer expects a component, which is what makes `<Widget comet="visible" />`
// compile inside a real page under either renderer.
const preactUsable: PreactComponentType<{ label: string } & CometProps> = PreactComet
const reactUsable: ReactComponentType<{ label: string } & CometProps> = ReactComet
// ...and the wrapped component's own props are still inferred and required — `label` below is
// checked against `PreactWidget`'s own props, not widened to `any`.
const propsStillChecked: (props: { label: string } & CometProps) => unknown = PreactComet

// -- The boundary's RETURN does not leak as `any` ------------------------------------------------
//
// `CometBoundaryComponent` returns `SpaceChildren`, never `any` — calling a comet outside JSX
// (legal, if unusual) must never hand the consumer an `any` that then flows into any position at
// all, unchecked. The directives below are the assertion — each one fails this suite (TS2578,
// "unused '@ts-expect-error'") the moment that return widens to `any`.
function returnDoesNotLeak(): unknown[] {
  // @ts-expect-error a rendered comet is not a number
  const asNumber: number = ReactComet({ label: 'a' })
  // @ts-expect-error ...nor a string
  const asString: string = PreactComet({ label: 'a' })
  return [asNumber, asString]
}

// What it IS, in both renderers' own vocabulary — the same value, no cast in either direction.
function returnStaysRenderable(): [ReactNode, ComponentChildren] {
  const forReact: ReactNode = ReactComet({ label: 'a' })
  const forPreact: ComponentChildren = PreactComet({ label: 'a' })
  return [forReact, forPreact]
}

Deno.test(
  'defineComet types [1/3]: a Preact-typed component needs NO cast and still renders a real ' +
    'Comet boundary through the Preact SSR path',
  () => {
    setActiveRenderer('preact')
    setCometManifest({ 'file:///comets/preact-widget.tsx': '/assets/preact-widget.js' })
    try {
      // `preactUsable`, not a cast — the point is that the wrapper IS a Preact component type.
      const response = renderToResponsePreact(preactElement(preactUsable, { label: 'a' }))
      return response.text().then((html) => {
        assertEquals(response.status, 200)
        assertStringIncludes(html, COMET_ID_ATTR)
        assertStringIncludes(html, `${COMET_EXPORT_ATTR}="PreactWidget"`)
        // The real component ran — not an empty boundary.
        assertStringIncludes(html, 'preact:a')
      })
    } finally {
      setCometManifest(undefined)
      setActiveRenderer('react')
    }
  },
)

Deno.test(
  'defineComet types [2/3]: the React path is unchanged by the same signature — a React-typed ' +
    'component still renders its own boundary and content',
  async () => {
    setActiveRenderer('react')
    setCometManifest({ 'file:///comets/react-widget.tsx': '/assets/react-widget.js' })
    try {
      // `reactUsable`, not a cast — same point, from the other renderer.
      const response = await renderToResponseReact(reactElement(reactUsable, { label: 'b' }))
      const html = await response.text()
      assertEquals(response.status, 200)
      assertStringIncludes(html, COMET_ID_ATTR)
      assertStringIncludes(html, `${COMET_EXPORT_ATTR}="ReactWidget"`)
      assertStringIncludes(html, 'react:b')
    } finally {
      setCometManifest(undefined)
    }
  },
)

Deno.test(
  "defineComet types [2b/3]: the boundary's return is SpaceChildren, not `any` — it does not " +
    'leak into a consumer position, and is still what both renderers accept as renderable',
  () => {
    setActiveRenderer('react')
    setCometManifest({ 'file:///comets/react-widget.tsx': '/assets/react-widget.js' })
    try {
      // Real calls, not type-only: both directives above must be real errors, and both of these
      // must produce a real element.
      const [reactNode, preactChildren] = returnStaysRenderable()
      assertEquals(typeof reactNode, 'object')
      assertEquals(typeof preactChildren, 'object')
      assertEquals(returnDoesNotLeak().length, 2)
    } finally {
      setCometManifest(undefined)
    }
  },
)

Deno.test(
  'defineComet types [3/3]: the exported name still comes from the component itself, under ' +
    'either renderer — the one thing `defineComet` reads off the component it wraps',
  () => {
    assert(
      preactUsable !== undefined && reactUsable !== undefined && propsStillChecked !== undefined,
    )
    assertEquals(PreactComet.name, 'CometBoundary')
    assertEquals(ReactComet.name, 'CometBoundary')
  },
)
