import type { OnErrorHandler } from './not-found-handler.ts'

/**
 * The REAL shape this package's own error-recovery handlers already follow —
 * {@link createNotFoundHandler}'s own returned function resolves `undefined` for any error it
 * doesn't recognize, "not handled, fall through" (see that function's own doc), even though it's
 * cast to {@link OnErrorHandler} (native `Deno.ServeOptions['onError']`, which never declares
 * `undefined` as a valid return) at its own return statement to satisfy `server.ssr.onError`'s
 * outward-facing contract. {@link globalErrorHandler} is the one place that convention needs to be
 * honest rather than cast away, since composing several such handlers means actually branching on
 * whether each one declined — write a recovery function against THIS type, not `OnErrorHandler`,
 * whenever it's meant to be composed here (e.g. `@zanix/auth`'s own `recoverRotatedSessionCookie`).
 */
export type ComposableErrorHandler = (
  error: unknown,
) => Response | Promise<Response> | undefined

/**
 * Composes multiple {@link OnErrorHandler}s into one — `bootstrapServers`/`bootstrapRemoteApp`'s
 * `server.ssr.onError` (`@zanix/server`) accepts exactly one handler, but a real app routinely
 * needs more than one concern wired there: `createNotFoundHandler()` (this package's own built-in
 * 404 recovery) alongside something app-specific, e.g. `@zanix/auth`'s own
 * `recoverRotatedSessionCookie()`. `@zanix/server`'s own guard pipeline skips its registered
 * response interceptors whenever a guard throws, so a guard that already rotated a session token
 * before a LATER guard/pipe rejects the request never delivers the replacement cookie through the
 * normal response path; that recovery function reads the rotated token back off the thrown error
 * and reattaches it here instead. Without this composer, an app has to hand-write the same "try
 * each handler in order, first real `Response` wins" loop itself, or pick only one handler and
 * lose the other.
 *
 * Each handler is tried IN ORDER against the same `error` — the first one that returns a real
 * `Response` wins, short-circuiting the rest. A handler that returns `undefined` (this package's
 * own established convention — see {@link createNotFoundHandler}'s own doc: "not handled, fall
 * through") is skipped, exactly as if it had never been in the list. If every handler returns
 * `undefined`, so does this composed one — the same "fall through to `@zanix/server`'s own default
 * `httpErrorResponse`" contract every individual `OnErrorHandler` already has, unchanged.
 *
 * Order matters and is entirely the caller's choice — this function imposes no priority of its
 * own (e.g. "not-found always wins"). A handler that only cares about ONE specific error shape
 * (like {@link createNotFoundHandler}'s own `HttpError('NOT_FOUND')` check) is naturally safe to
 * place anywhere in the list, since it already returns `undefined` for everything else.
 *
 * @param handlers - The {@link ComposableErrorHandler}s to try, in order — {@link
 * createNotFoundHandler}'s own return value already satisfies this structurally, no cast needed
 * at the call site. Each receives the SAME raw `error` — this function never wraps or transforms
 * it between handlers.
 * @returns A single `OnErrorHandler` — pass it directly as `server.ssr.onError`.
 *
 * @example
 * ```ts
 * import { createNotFoundHandler, globalErrorHandler } from '@zanix/space'
 * import { recoverRotatedSessionCookie } from '@zanix/auth'
 *
 * await bootstrapRemoteApp(spaceApp, {
 *   server: {
 *     ssr: {
 *       onError: globalErrorHandler(recoverRotatedSessionCookie(), createNotFoundHandler()),
 *     },
 *   },
 * })
 * ```
 */
export function globalErrorHandler(...handlers: ComposableErrorHandler[]): OnErrorHandler {
  const combined = async (error: unknown): Promise<Response | undefined> => {
    for (const handler of handlers) {
      // deno-lint-ignore no-await-in-loop
      const response = await handler(error)
      if (response) return response
    }
    return undefined
  }

  return combined as OnErrorHandler
}
