import { assert, assertEquals } from '@std/assert'
import { createElement as reactElement } from 'react'
import type { ComponentType as ReactComponentType, ReactElement, ReactNode } from 'react'
import { createElement as preactElement } from 'preact'
import type { ComponentChildren, ComponentType as PreactComponentType, VNode } from 'preact'
import type { SpaceChildren, SpaceComponent } from 'typings/renderable.ts'
import type { LayoutProps } from 'typings/page.ts'

/**
 * The evidence behind `typings/renderable.ts`'s own claims — the assignability checks its module
 * doc says exist, written as code so they run in CI rather than being asserted in prose.
 *
 * `deno test` type-checks this file, so every assignment below is a real assertion: a positive one
 * fails the suite by failing to compile, and every negative one is a `@ts-expect-error` that fails
 * the suite (TS2578, "unused '@ts-expect-error' directive") the moment it stops being an error.
 * That is the whole point — these two types are only worth having if they are simultaneously
 * permissive enough for BOTH renderers and strict enough to still reject a non-component or a
 * non-renderable child. Widening either one to `any` to "fix" something would turn every negative
 * into an unused directive, and this file red.
 *
 * Every check runs against REAL values (real React elements, real Preact vnodes, real components),
 * passed in as arguments — never `declare const` placeholders, so nothing here is a compile-only
 * artifact.
 *
 * @module
 */

// ================================================================================================
// SpaceChildren — the neutral default of LayoutProps
// ================================================================================================

/** Both directions of the children contract, checked on real values. */
function childrenContract(
  neutral: SpaceChildren,
  realReactElement: ReactElement,
  realPreactVNode: VNode,
): {
  intoReact: ReactNode
  intoPreact: ComponentChildren
  fromReact: SpaceChildren
  fromPreact: SpaceChildren
} {
  // 1. Usable where EACH renderer expects its own children type — the direction that makes
  //    `<body>{children}</body>` (React) and `createElement('body', null, children)` (Preact)
  //    type-check from ONE renderer-free declaration.
  const intoReact: ReactNode = neutral
  const intoPreact: ComponentChildren = neutral
  // 2. Each renderer's own real element fits INTO the neutral slot, so a layout nesting another
  //    layout's output type-checks too.
  const fromReact: SpaceChildren = realReactElement
  const fromPreact: SpaceChildren = realPreactVNode
  return { intoReact, intoPreact, fromReact, fromPreact }
}

/** The negatives: the neutral type is not `any`. */
function childrenRejections(): unknown[] {
  // @ts-expect-error an arbitrary object is not a renderable child
  const notChildren: SpaceChildren = { nope: true }
  // @ts-expect-error a function is not a renderable child
  const alsoNotChildren: SpaceChildren = () => 1
  return [notChildren, alsoNotChildren]
}

// ================================================================================================
// SpaceComponent — the neutral default of SpacePageController's `component`
// ================================================================================================

function ReactView(props: { id: string }): ReactElement {
  return reactElement('p', null, props.id)
}
function PreactView(props: { id: string }): VNode {
  return preactElement('p', null, props.id)
}
class ReactClassView {
  constructor(public props: { id: string }) {}
  public render(): ReactNode {
    return reactElement('p', null, this.props.id)
  }
}
class PreactClassView {
  constructor(public props: { id: string }) {}
  public render(): ComponentChildren {
    return preactElement('p', null, this.props.id)
  }
}

/** Every component shape of either renderer satisfies the neutral type... */
function componentContract(): SpaceComponent<{ id: string }>[] {
  const fromReactFunction: SpaceComponent<{ id: string }> = ReactView
  const fromPreactFunction: SpaceComponent<{ id: string }> = PreactView
  const fromReactClass: SpaceComponent<{ id: string }> = ReactClassView
  const fromPreactClass: SpaceComponent<{ id: string }> = PreactClassView
  return [fromReactFunction, fromPreactFunction, fromReactClass, fromPreactClass]
}

/** ...and it is assignable BACK to either renderer's own type, so nothing downstream of a page
 * needs a cast to hand `component` to the renderer that will actually call it. */
function componentRoundTrip(
  neutral: SpaceComponent<{ id: string }>,
): { react: ReactComponentType<{ id: string }>; preact: PreactComponentType<{ id: string }> } {
  const react: ReactComponentType<{ id: string }> = neutral
  const preact: PreactComponentType<{ id: string }> = neutral
  return { react, preact }
}

/** The negatives: still a real check, not `unknown`/`any`. */
function componentRejections(): unknown[] {
  // @ts-expect-error a number is not a component
  const notComponent: SpaceComponent = 42
  // @ts-expect-error a plain object carrying a render method is not a component
  const alsoNotComponent: SpaceComponent = { render: () => null }
  // @ts-expect-error props are still checked when they are named
  const wrongProps: SpaceComponent<{ id: string }> = (_props: { id: number }) => null
  return [notComponent, alsoNotComponent, wrongProps]
}

// ================================================================================================
// LayoutProps — the neutral default in place
// ================================================================================================

// The BARE form (no type argument) declares a layout for EITHER renderer, with no cast anywhere.
function ReactLayout({ children, params }: LayoutProps): ReactElement {
  return reactElement('div', { 'data-params': JSON.stringify(params) }, children)
}
// `VNode<any>` for the same structural reason `document-shell-preact.ts` documents at length: a
// Preact `VNode<P>` makes `P` appear contravariantly, so a vnode built with real props is not
// assignable to a bare `VNode`. Nothing to do with this file's own subject.
// deno-lint-ignore no-explicit-any
function PreactLayout({ children, params }: LayoutProps): VNode<any> {
  return preactElement('div', { 'data-params': JSON.stringify(params) }, children)
}

Deno.test(
  'SpaceChildren: assignable to both renderers own children types, and both renderers own real ' +
    'elements are assignable to it',
  () => {
    const result = childrenContract(
      reactElement('span', null, 'x'),
      reactElement('span', null, 'x'),
      preactElement('span', null, 'x'),
    )
    // Real values made it through every position — nothing here was a type-only placeholder.
    assertEquals(typeof result.intoReact, 'object')
    assertEquals(typeof result.intoPreact, 'object')
    assertEquals(typeof result.fromReact, 'object')
    assertEquals(typeof result.fromPreact, 'object')
  },
)

Deno.test(
  'SpaceChildren: rejects values that are not renderable at all — the neutral default is not `any`',
  () => {
    // The assertion that matters is the pair of `@ts-expect-error` directives inside; if either
    // stopped being an error, this file would not compile.
    assertEquals(childrenRejections().length, 2)
  },
)

Deno.test(
  'SpaceComponent: accepts function AND class components of both renderers, and round-trips back ' +
    'to either renderer own ComponentType with no cast',
  () => {
    assertEquals(componentContract().length, 4)
    const { react, preact } = componentRoundTrip(ReactView)
    assert(typeof react === 'function')
    assert(typeof preact === 'function')
    const { react: r2, preact: p2 } = componentRoundTrip(PreactView)
    assert(typeof r2 === 'function')
    assert(typeof p2 === 'function')
  },
)

Deno.test(
  'SpaceComponent: rejects non-components and mismatched props — still a real check',
  () => {
    assertEquals(componentRejections().length, 3)
  },
)

Deno.test(
  'LayoutProps: the BARE form (no type argument) declares a working layout under both renderers',
  () => {
    const reactTree = ReactLayout({
      children: reactElement('span', null, 'react-child'),
      params: { id: '1' },
    })
    const preactTree = PreactLayout({
      children: preactElement('span', null, 'preact-child'),
      params: { id: '1' },
    })
    assertEquals(typeof reactTree, 'object')
    assertEquals(typeof preactTree, 'object')

    // The renderer-bound forms still work — what this package's own boundaries use.
    const reactBound: LayoutProps<ReactNode> = { children: reactTree, params: {} }
    const preactBound: LayoutProps<ComponentChildren> = { children: preactTree, params: {} }
    assertEquals(reactBound.params, {})
    assertEquals(preactBound.params, {})
  },
)
