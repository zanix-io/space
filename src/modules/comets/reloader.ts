/**
 * The shape a `RestClient`/`GraphQLClient` call's `reloadDescriptor` carries (`jsr:@zanix/server`'s
 * own `reload: true` option) — hand-defined here, not imported from `@zanix/server`: this
 * module is reachable from a Comet's own client bundle, and `@zanix/server` never is (see
 * `docs/comets.md`'s "Server-only code boundary" — the same reasoning `@zanix/server`'s own
 * `GraphQLErrorLike` type already documents for its own connector, mirrored here on the other
 * side of the same wire format).
 */
export interface ReloadDescriptor {
  /** The fully resolved request URL. */
  endpoint: string
  /** The HTTP method the original call used. */
  method: string
  /** The (already allowlist-filtered) headers to replay. */
  headers: Record<string, string>
  /** The exact body string to replay, if any. */
  body?: string
}

/**
 * Builds a ready-to-call reload function from a `reloadDescriptor` descriptor — the client-side half
 * of the `reload: true` mechanism `jsr:@zanix/server`'s `RestClient`/`GraphQLClient` expose. A
 * Comet that received `reloadDescriptor` as a plain prop (the same way it already receives its
 * initial data — see `docs/data-fetching.md`) calls this once, then calls the function it gets
 * back whenever it needs to redo the exact same request:
 *
 * ```tsx
 * const reload = createReloader<{ data: { countries: Country[] } }>(reloadDescriptor)
 * try {
 *   const { data } = await reload()
 * } catch (error) {
 *   // handle it however this Comet already handles its own errors
 * }
 * ```
 *
 * Always rejects on failure rather than swallowing it — no `onError` option or similar: this
 * module stays renderer-neutral (works identically in a React or Preact Comet, see
 * `defineComet`'s own doc for why that matters throughout `@zanix/space`), and any callback meant
 * to drive a Comet's own state (`useState`, a signal, ...) would tie this to one particular
 * renderer's own state model for no real gain — the caller's own `try`/`catch` around `reload()`
 * already gets the same error, with nothing this function could add.
 *
 * Deliberately protocol-agnostic — `endpoint`/`method`/`headers`/`body` are already fully
 * resolved (see `ReloadDescriptor`'s own doc), so this needs no REST-vs-GraphQL branching of its
 * own to issue the request. The one exception is the GraphQL `errors`-array check below: safe to
 * run unconditionally, since an ordinary REST response never has a top-level `errors` field in
 * this shape, so the check simply never fires for one — the same reasoning
 * `GraphQLClient.query()`'s own `errors` check already relies on, server-side.
 *
 * Deliberately does NOT try to unwrap a GraphQL response's own `.data` — unlike `errors`, `data`
 * is common enough as a real REST field name (a paginated list response, for instance) that
 * guessing would risk silently returning the wrong thing for some REST APIs. The caller reads
 * `.data` itself for a GraphQL reload, the same way it already does for the initial one.
 *
 * @template T - The expected shape of the parsed JSON response.
 * @param descriptor - The `reloadDescriptor` received as a prop.
 * @returns A function that replays the call and resolves with the parsed JSON response, or
 * rejects — never swallowed.
 */
export function createReloader<T = unknown>(descriptor: ReloadDescriptor): () => Promise<T> {
  return async () => {
    const response = await fetch(descriptor.endpoint, {
      method: descriptor.method,
      headers: descriptor.headers,
      body: descriptor.body,
    })

    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`)
    }

    const parsed = await response.json()

    if (Array.isArray(parsed?.errors) && parsed.errors.length) {
      const messages = (parsed.errors as { message: string }[]).map((e) => e.message)
      throw new Error(messages.join('; '))
    }

    return parsed as T
  }
}
