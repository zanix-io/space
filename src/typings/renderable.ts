/**
 * The renderer-neutral vocabulary this framework describes documents with — what a renderable child
 * is, and what a component is — stated structurally, so that neither `--renderer=react` nor
 * `--renderer=preact` is the one this package's shared types are written against.
 *
 * **Why this module exists.** `LayoutProps` used to default its `children` to React's `ReactNode`,
 * and `SpacePageController` used to default its `component` to React's `ComponentType<any>`. Both
 * were deliberate ergonomic choices at the time (a React app never had to know the type parameter
 * existed), and both had the same architectural cost: the DEFAULT meaning of a shared, conceptually
 * renderer-agnostic type was one specific renderer's, so `--renderer=preact` was expressible only
 * by opting out of the default, and `typings/page.ts` — a module about pages, not about React —
 * imported React.
 *
 * **What makes these types renderer-agnostic rather than merely React-free.** They are not `any`,
 * not `unknown`, and not a union of both renderers' types (which would put both renderers into
 * the shared layer instead of neither). Each is the smallest structure that BOTH renderers'
 * corresponding type satisfies, verified by real assignability checks in
 * `@tests/unit/typings/renderable-types.test.ts` — in both directions, because both directions are
 * used: this package's own composition code produces values of these types, and an app's own
 * layout/page consumes them inside its renderer's own JSX.
 *
 * **What they deliberately do not do.** Nothing here inspects, detects or infers which renderer is
 * active; the renderer is declared once, by `defineSpaceApp({ renderer })`, and read from
 * `getActiveRenderer()` at the few boundaries that genuinely need it. These types describe a shape,
 * not an environment.
 *
 * **On the `any`s below: deliberate type erasure at the common boundary, not an escape hatch.**
 * Every one of them sits in a position whose real type belongs to a renderer this layer refuses to
 * name, and each was audited against the alternative rather than chosen for convenience:
 *
 * - `SpaceElement.type`/`props` — erased. `unknown` was tried and rejected on evidence: React's own
 *   `ReactElement` constrains `type` under a bound `unknown` cannot satisfy, so an `unknown`-typed
 *   element is not assignable to `ReactNode` and every React layout stops compiling. These fields
 *   are unreachable without narrowing (`children.props` is an error on the union), and the values
 *   are produced exclusively by a renderer's own `createElement`; nothing in this package reads
 *   them.
 * - `SpaceComponent`'s `P = any` default — the SAME strength the React-specific default it replaced
 *   had (`ComponentType<any>`). It never applies where props can actually be checked: `defineComet`
 *   INFERS `P` from the component it is given, so a missing, mistyped or unknown prop on a wrapped
 *   comet is still a compile error.
 * - `SpaceComponent`'s `...rest: any[]` and its return — erased. The extra parameter is each
 *   renderer's own legacy context argument, and the return value is that renderer's node type. A
 *   stricter return was tried (requiring {@linkcode SpaceChildren}) and rejected on evidence: it
 *   rejects every Preact CLASS component, whose `render()` returns `ComponentChildren`.
 *
 * The erasure is confined to those positions: `Params`, a page's `component`-ness, a layout's
 * `children`-ness, a comet's props and both renderers' own types all remain fully checked. See
 * `@tests/unit/typings/renderable-types.test.ts`, whose `@ts-expect-error` directives fail the
 * suite the moment any of these widens into a real escape hatch.
 *
 * @module
 */

/**
 * The shape every renderer's own element object has: a tag or component, its props, and an optional
 * key.
 *
 * `type` and `props` are `any` on purpose, and it is the one place `any` is correct here: their
 * real types belong to the renderer (React's `ReactElement` constrains `type` to
 * `string | JSXElementConstructor<any>`; Preact's `VNode` constrains it differently), and this
 * layer never reads either field. `unknown` was tried first and rejected by evidence, not by taste
 * — React's own `ReactElement` declares `type: T` under a constraint that `unknown` cannot satisfy,
 * so an `unknown`-typed element is not assignable to `ReactNode` and a React layout could not
 * render it. `key` is `string | null` because that is the intersection both renderers accept.
 *
 * This is a structural description of a value this package passes THROUGH, never one it builds:
 * elements are always built by a renderer's own `createElement` (see `comets/element-factory.ts`).
 */
export type SpaceElement = {
  /** The element's tag or component — the renderer's own concern. */
  // deno-lint-ignore no-explicit-any
  type: any
  /** The element's props — the renderer's own concern. */
  // deno-lint-ignore no-explicit-any
  props: any
  /** The element's key, when it has one. */
  key: string | null
}

/**
 * Anything a layout can receive as `children` and place into its own renderer's JSX — the neutral
 * default of {@linkcode LayoutProps}.
 *
 * Assignable to React's `ReactNode` AND to Preact's `ComponentChildren`, which is what makes
 * `<body>{children}</body>` type-check in a React layout and `createElement('body', null,
 * children)` type-check in a Preact one, from the SAME declaration. Both renderers' real elements
 * are in turn assignable to it, so composition in the other direction type-checks too.
 *
 * **One deliberate omission**: a bare `Promise` child (React 19 async components) is not part of
 * this union. Adding it was tried and reverted on evidence — a `Promise` arm makes the union itself
 * stop being assignable to `ReactNode` (React's own `Promise<AwaitedReactNode>` does not admit
 * nested promises/iterables), which would break the primary direction to buy a case this framework
 * never produces: layouts receive already-composed element trees. A layout that genuinely needs it
 * names its renderer's own type — `LayoutProps<ReactNode>` — exactly as a layout with any other
 * renderer-specific need does.
 */
export type SpaceChildren =
  | SpaceElement
  | string
  | number
  | bigint
  | boolean
  | null
  | undefined
  | Iterable<SpaceChildren>

/**
 * A component either renderer can render: a function component, or a class component.
 *
 * This is the shared concept behind `SpacePageController`'s own `component`, a `layout.tsx`'s
 * default export and a Comet's wrapped component (see {@linkcode CometComponent}, which is this
 * type under its Comet-facing name). React's `ComponentType` and Preact's are nominally
 * incompatible — a value of one is not assignable to the other (confirmed empirically, and the
 * reason `PageRenderer`/`app-shell-registry.ts` hold components as `unknown` at the registry
 * seam) — but both satisfy this structure, and this structure is assignable back to either, so it
 * needs no cast in either direction.
 *
 * **What it checks**: that the value is callable or constructible, and — when `P` is named — that
 * it accepts those props. `component = 42`, `component = { render() {} }` and a component whose
 * props do not match are all still errors.
 *
 * **What it cannot check**: that the return value is renderable. That check is irreducibly
 * renderer-specific (a stricter form was tried: requiring the return to be
 * {@linkcode SpaceChildren} rejects every Preact CLASS component, because Preact's own
 * `render()` returns `ComponentChildren`, which includes a bare `object`). A page or layout that
 * wants it names its own renderer's `ComponentType` explicitly — available identically to both
 * renderers now, rather than being React's for free and Preact's only on request.
 *
 * @template P - The component's own props. Defaults to `any` — the same strength the previous
 * React-specific default (`ComponentType<any>`) had, so nothing gets weaker by becoming neutral.
 */
export type SpaceComponent<
  // deno-lint-ignore no-explicit-any
  P = any,
> =
  // deno-lint-ignore no-explicit-any
  | ((props: P, ...rest: any[]) => any)
  // deno-lint-ignore no-explicit-any
  | (new (props: P, ...rest: any[]) => any)
