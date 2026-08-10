/**
 * The hydration timing for a "Comet" — the framework's unit of selective hydration. Marked at the
 * point of use in JSX (`<Counter comet="visible" />`), never only by file location, so the same
 * component can be static in one place and interactive in another without duplicating it.
 *
 * @module
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
}
