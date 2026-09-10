let preactDevTools: boolean | undefined

/**
 * Set once by `defineSpaceApp({ preactDevTools })`'s own eager assignment, as soon as that
 * function runs — before `zanix space dev`/`zanix space build` construct `spacePlugin()`. Same
 * pattern as `active-renderer.ts`'s `setActiveRenderer`: a build-time consumer config threaded
 * through a module-level flag rather than a parameter, since `spacePlugin()` is built independently
 * of `defineSpaceApp`'s own call site.
 *
 * Stays `undefined` when the consumer never set the field at all — never defaulted here, and never
 * defaulted by `spacePlugin()` either, so an app that never sets `preactDevTools` keeps
 * `@preact/preset-vite`'s OWN dev/prod default (enabled under `zanix space dev`, disabled under
 * `zanix space build`) instead of this registry silently forcing one value in both.
 */
export function setActivePreactDevTools(value: boolean | undefined): void {
  preactDevTools = value
}

/** Read by `zanix space dev`/`zanix space build`'s own `spacePlugin({ preactDevTools })` call —
 * see `SpacePluginOptions.preactDevTools`'s own doc (`space-plugin.ts`) for what this actually
 * controls. */
export function getActivePreactDevTools(): boolean | undefined {
  return preactDevTools
}
