import { setDevClientEnabled } from '../dev/dev-client-registry.ts'
import { resetMessagesCache } from '../i18n/load-messages.ts'

export { resetMessagesCache }

/**
 * Forces `loadMessages()` — and therefore `renderPageForTest`/a page's own `loader` — to read the
 * live `messagesDir` source, the same way `zanix space dev` does, instead of
 * `{clientBuildDir}/messages/...`. Needed for any app whose `defineSpaceApp()` config declares
 * BOTH `messagesDir` and `clientBuildDir` (the realistic, documented production shape): outside a
 * real `zanix space dev`/`zanix space build` run, `loadMessages()` has no way to tell a `deno test`
 * process apart from a production one, and silently resolves an empty catalog from a
 * `clientBuildDir` that only a real build populates — see `loadMessages()`'s own doc for the exact
 * `isDevClientEnabled()` gate this flips.
 *
 * Deliberately NOT a re-export of `@zanix/space/dev`'s own `setDevClientEnabled`: that barrel also
 * carries `SpaceDevSocket`, whose `@Socket(...)` decorator registers a real WebSocket route the
 * instant the barrel is imported — safe for `zanix space dev`'s own single orchestrator process,
 * but not for a test file, where importing `space.app.ts` (and therefore this package's root
 * barrel) repeatedly across isolated fixtures in the same process is the norm, and a second
 * evaluation of `space-dev-socket.ts` throws (`Route path "socket=>..." is already defined`). This
 * function reaches `dev-client-registry.ts` directly instead — one of the individually audited,
 * side-effect-free files `@zanix/space`'s own render/router path already imports directly, for the
 * same reason.
 *
 * Also clears `loadMessages()`'s own process-lifetime cache ({@linkcode resetMessagesCache}, also
 * exported from here), so a call resolved under a DIFFERENT enabled state in a previous test never
 * leaks into this one.
 *
 * Call in a test's own setup — never at a fixture's module top level, since a test that
 * legitimately wants to exercise the COMPILED (`clientBuildDir`) path must still be able to import
 * this module without side effects. Call `mockLiveMessages(false)` to restore the default
 * (compiled-catalog) resolution before a later test in the same file needs it.
 *
 * @example
 * ```ts
 * import { mockLiveMessages, renderPageForTest } from '@zanix/space/testing'
 *
 * Deno.test('renders the real profile heading', async () => {
 *   mockLiveMessages()
 *   const { html } = await renderPageForTest(ProfilePage, {}, {
 *     url: new URL('http://localhost/es/profile'),
 *   })
 *   assertStringIncludes(html, 'Tu perfil en MyApp')
 * })
 * ```
 */
export function mockLiveMessages(enabled = true): void {
  setDevClientEnabled(enabled)
  resetMessagesCache()
}
