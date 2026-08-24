/**
 * The hydration timing for a "Comet" — the framework's unit of selective hydration. Marked at the
 * point of use in JSX (`<Counter comet="visible" />`), never only by file location, so the same
 * component can be static in one place and interactive in another without duplicating it.
 *
 * @module
 */
import type { SpaceChildren, SpaceComponent } from './renderable.ts'

/**
 * When a Comet hydrates — declared at the point of use (`<Counter comet="visible" />`), so the same
 * component can be static in one place and interactive in another without being duplicated.
 */
export type CometStrategy =
  /** Hydrates immediately once the client runtime reaches this boundary. The default. */
  | 'load'
  /** Hydrates once the browser is idle (`requestIdleCallback`, falling back to a short timer). */
  | 'idle'
  /** Hydrates once the boundary scrolls into the viewport (`IntersectionObserver`). */
  | 'visible'
  /** Hydrates once a media query matches (see `cometMedia`). */
  | 'media'
  /** Renders nothing on the server — mounts fresh on the client only, immediately. */
  | 'only'
  /** Never hydrates — plain static server-rendered HTML, even if the component lives in a
   * `comets/` directory (whose own default is `'load'`). */
  | 'none'

/** Props every Comet-wrapped component gains, on top of its own — never declared by hand; a
 * component becomes eligible for these via `defineComet`. */
export type CometProps = {
  /** Overrides this instance's hydration timing. Defaults to `'load'`. */
  comet?: CometStrategy
  /** The media query `'media'` waits on. Only meaningful together with `comet="media"`. */
  cometMedia?: string
  /**
   * Opts this specific call site into surviving an Orbit navigation instead of being torn down
   * and freshly remounted — the author-supplied stable identity for "this is the same logical
   * instance" across two different server renders, exactly the same responsibility React's own
   * `key` prop already carries for list items. Two renders are treated as the same instance only
   * when BOTH this value AND the comet's own module/export identity match; encode whatever makes
   * two instances genuinely the same thing into the string itself (e.g. an entity id —
   * `persist={`reply-${post.id}`}` — so navigating to a DIFFERENT post naturally produces a
   * different key instead of incorrectly reusing state that belongs to a different page).
   *
   * Never inferred, never on by default — a comet's state resetting on navigation is the correct,
   * expected behavior for most comets; this is an explicit, deliberate opt-in for the few that
   * should genuinely carry state across pages (a draft the user is mid-typing, an in-progress
   * multi-field selection), not a general persistence mechanism.
   */
  persist?: string
}

/**
 * A component {@linkcode defineComet} can wrap — {@linkcode SpaceComponent} under its Comet-facing
 * name, kept as a named alias because a Comet's own props (`P`) are what `defineComet` infers and
 * re-exposes, so the name reads correctly at that call site.
 *
 * `defineComet`'s runtime has been renderer-agnostic since `element-factory.ts` existed: the
 * boundary is built with whichever `createElement` the ACTIVE renderer registered, and the wrapped
 * component itself is only ever read for its `.name` and handed back to that same renderer. Its
 * SIGNATURE, however, named React's own `ComponentType`, which made the one genuinely agreed-upon
 * type in the whole path the one that rejected Preact: a `--renderer=preact` app could not call
 * `defineComet` at all without an `as unknown as ComponentType<...>` cast (this package's own
 * Preact benchmark comets carried exactly that cast, and documented it as a real type-level gap).
 *
 * Deliberately NOT `unknown`/`any`: `P` is still inferred from the component that is passed, so the
 * returned boundary keeps requiring exactly that component's own props (plus
 * {@linkcode CometProps}), and passing a non-component value is still an error.
 *
 * @template P - The wrapped component's own props.
 */
export type CometComponent<P> = SpaceComponent<P>

/**
 * What {@linkcode defineComet} returns — the boundary component, usable directly in either
 * renderer's own JSX.
 *
 * A plain function type rather than `ReactElement`-returning `ComponentType`: the boundary IS a
 * function component, and its return value is whatever the active renderer's own `createElement`
 * produced (a React element under `--renderer=react`, a Preact vnode under `--renderer=preact`) —
 * a value this package deliberately never names with either renderer's type, exactly like
 * `PageRenderer`'s own `Component` parameter (`router/page-renderer-registry.ts`).
 *
 * The return is {@linkcode SpaceChildren}, NOT `any`. That distinction is the whole point of this
 * type existing separately from {@linkcode SpaceComponent}: `SpaceComponent` describes what may be
 * PASSED IN (and must therefore stay permissive enough for a Preact class component, whose
 * `render()` returns `ComponentChildren` — see that type's own doc), while this describes what
 * `defineComet` HANDS BACK, which is always the one element its own boundary just built. An `any`
 * here would let that value escape into consumer code unchecked: `const n: number = MyComet({ ... })`
 * would type-check, since calling a component outside JSX yields its declared return type.
 * `SpaceChildren` closes that without naming a renderer — it is still assignable to React's
 * `ReactNode` and to Preact's `ComponentChildren`, so the boundary remains usable in either
 * renderer's JSX with no cast.
 *
 * @template P - The wrapped component's own props, plus {@linkcode CometProps}.
 */
export type CometBoundaryComponent<P> = (props: P) => SpaceChildren
