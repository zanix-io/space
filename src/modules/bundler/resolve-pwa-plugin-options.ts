import { resolve } from '@std/path'
import type { PwaConfig } from 'typings/pwa.ts'
import type { PwaPluginOptions } from './pwa-plugin.ts'

/**
 * The "resolved plan" layer between `PwaConfig` (author-facing composition — what an author
 * declares via `defineSpaceApp({ pwa })`) and `pwaPlugin`'s own `PwaPluginOptions` (build-tool
 * activation) — a pure function, no I/O, matching the same composition → resolved-plan →
 * activation layering this ecosystem's own architecture already uses elsewhere (e.g.
 * `@zanix/server`'s `compileRuntime`). `buildSpaceClient` is the only caller: an author never
 * configures `pwaPlugin` separately from `PwaConfig` — see `PwaConfig`'s own doc for why.
 *
 * Resolves `config.icon` against `root` before handing it to `pwaPlugin` — `PwaConfig.icon` is
 * documented as relative to the project root, but `pwaPlugin` itself reads its own `source` via a
 * plain `Deno.readFile(source)`, resolved against the PROCESS's own cwd, never against Vite's own
 * `root` option (confirmed empirically: a root-relative path passed straight through threw a real
 * `NotFound` the moment `buildSpaceClient`'s own caller's cwd didn't happen to match `root`).
 *
 * @param config - See {@linkcode PwaConfig}.
 * @param root - The same project root `buildSpaceClient` itself was given.
 */
export function resolvePwaPluginOptions(config: PwaConfig, root: string): PwaPluginOptions {
  return {
    icons: { source: resolve(root, config.icon), sizes: config.iconSizes },
    offlineFallback: config.offlineFallback,
  }
}
