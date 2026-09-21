import type { PwaConfig } from 'typings/pwa.ts'

/**
 * The Web Push settings of a service worker, with every default of {@linkcode PwaConfig.push}
 * applied. Read by the build (`resolvePwaPluginOptions`) and by the runtime worker route
 * (`registerPwa`) alike, so the worker a build writes and the one served without a build output
 * can never disagree. Lives here, dependency-free, for the reason `icon-naming.ts` documents: the
 * deployed server process must never import `sharp`.
 *
 * @returns `undefined` when `config.push` is unset.
 */
export function resolvePwaPush(
  config: PwaConfig,
): { fallbackTitle: string; defaultUrl: string } | undefined {
  if (!config.push) return undefined
  return {
    fallbackTitle: config.push.fallbackTitle ?? config.name,
    defaultUrl: config.push.defaultUrl ?? '/',
  }
}

/** Whether the app's own configuration asks for a service worker beyond the cached shell: Web Push
 * handlers, or a script of its own. Such an app needs a worker to exist in every mode, including
 * when no client build output does. */
export function requestsServiceWorkerLogic(config: PwaConfig): boolean {
  return Boolean(config.push || config.serviceWorkerScript)
}
