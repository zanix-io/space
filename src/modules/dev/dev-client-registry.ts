let enabled = false

/**
 * Set once by a dev-server orchestrator (`zanix space dev`) before serving any request — never by a
 * page author, and never true in a production build. Same pattern as `setPwaConfig`
 * (`modules/pwa/pwa-registry.ts`): a module-level flag read on every full-document response,
 * rather than threading a parameter through every render call site.
 *
 * Also flipped by a consumer's own test, via `@zanix/space/testing`'s `mockLiveMessages`
 * (`mock-messages.ts`) — that helper imports this file directly rather than `@zanix/space/dev`'s
 * barrel specifically because this file itself carries no import-time side effect, unlike that
 * barrel's `SpaceDevSocket`.
 */
export function setDevClientEnabled(value: boolean): void {
  enabled = value
}

/** Read by `SpacePageController`/`createNotFoundHandler` to decide whether to inject the dev
 * client script (`buildDevClientScript`) into a full-document response at all. */
export function isDevClientEnabled(): boolean {
  return enabled
}
