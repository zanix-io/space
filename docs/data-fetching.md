## Data fetching — REST/GraphQL clients, server-side vs. client-side

Two genuinely different places call out to an external API, and they use two different mechanisms —
never the same one:

- A page's own `loader` runs **server-side**, in the same Deno process as the rest of the request.
  It uses `@zanix/server`'s `RestClient`/`GraphQLClient`.
- A Comet's own event handler (a button click, an effect) runs **client-side**, in the browser,
  after hydration. It uses a plain `fetch()` — `@zanix/server` is a Deno/server-oriented package
  with no business being in a client bundle.

Picking the wrong one for the wrong side either doesn't compile (importing `@zanix/server` from a
`'use comet'` module pulls a server-oriented dependency graph into the browser build) or silently
loses the point of SSR (fetching only client-side means every visitor sees a loading state on first
paint, even though the page was already server-rendered).

### Server-side: `RestClient`/`GraphQLClient`

`@zanix/server` exports two ready base classes to extend — never instantiate directly, they're
abstract-in-spirit shells around `this.http.get/post/put/patch/delete/head/options`:

```ts
'server-only'

import { RestClient } from '@zanix/server'

export interface User {
  id: number
  name: string
  email: string
}

class UsersClient extends RestClient {
  constructor() {
    super({ baseUrl: 'https://api.example.com' })
  }

  public getUsers(): Promise<User[]> {
    return this.http.get<User[]>('/users')
  }
}

export const usersClient = new UsersClient()
```

Both classes already handle JSON parsing, default headers, conditional `GET` caching (a response's
`ETag` is remembered and sent back as `If-None-Match`), and structured errors (`RestClientError`,
whose `realHttpStatus` distinguishes a real non-2xx upstream response from a transport-level failure
— DNS, timeout, connection refused). `GraphQLClient extends RestClient` and adds one method:

```ts
'server-only'

import { GraphQLClient } from '@zanix/server'
import { GET_USER } from '../gql/users.gql.ts'

class CatalogClient extends GraphQLClient {
  constructor() {
    super({ baseUrl: 'https://api.example.com/graphql' })
  }

  public getUser(id: string) {
    return this.query<{ user: User }>(GET_USER, { variables: { id } })
  }
}
```

`.query()` still goes through `this.http.post` underneath — it's `RestClient`'s own transport, never
reimplemented. Both have no persistent connection to establish or tear down (`initialize`/ `close`
are no-ops), so a module-level singleton instance, exported once and reused across requests, is the
normal shape — same as `usersClient` above.

**Always lead a `<domain>.client.ts` file with the `'server-only'` directive**, the same grammar
slot as `'use comet'`, before any import. `cometPlugin` enforces it at build time: if a Comet's own
module graph ever reaches a `'server-only'`-marked module, the build fails with the exact import
chain that caused it, instead of silently bloating the client bundle with a Deno-oriented dependency
graph that has no business shipping to a browser. Cheap to add, and it turns a mistake (importing a
server-side client from a Comet by accident) into a clear build error instead of a bundle-size
regression nobody notices until much later.

#### Organizing query text: `gql/`

A query/mutation's own text doesn't have to live inline in the client method that sends it, the way
the first draft of `CatalogClient` above did. As the number of operations grows, a `gql/` directory
next to `clients/` keeps the two separate:

```
src/space/
  clients/
    users.client.ts        # GraphQLClient subclass — imports queries from gql/
  gql/
    users.gql.ts            # exported consts holding each query/mutation's text
```

One `<domain>.gql.ts` per resource, named after its matching `<domain>.client.ts` — never one file
per operation. Each export is a `const` holding a single query or mutation's text, named for what it
does:

```ts
// src/space/gql/users.gql.ts
export const GET_USER = `query ($id: ID!) { user(id: $id) { id name email } }`
export const GET_USERS = `query { users { id name email } }`
```

`CatalogClient` imports `GET_USER` from there instead of inlining it, as shown above — that's the
whole convention: pure text organization, nothing more.

**A domain that outgrows one file** can become a `<domain>/` directory instead, holding any number
of freely-named files — the matching rule stays the same either way, a file or a directory named
after the domain, next to that domain's own `<domain>.client.ts`:

```
gql/
  countries/                 # was countries.gql.ts, split once it outgrew one file
    list.gql.ts
    detail.gql.ts
    mutations.gql.ts
```

#### `schemaApplication`: declaring which schema a client's queries belong to

`GraphQLClient`'s constructor accepts an optional `schemaApplication`, alongside `baseUrl`:

```ts
'server-only'

import { GraphQLClient } from '@zanix/server'
import { GET_USER } from '../gql/users.gql.ts'

class CatalogClient extends GraphQLClient {
  constructor() {
    super({ baseUrl: 'http://localhost:8000/graphql', schemaApplication: 'main' })
  }

  public getUser(id: string) {
    return this.query<{ user: User }>(GET_USER, { variables: { id } })
  }
}
```

It never reaches an actual request — a read-only, build-time-only hint, read by
`zanix space
build`/`zanix space dev`'s real GraphQL check (`@zanix/cli`'s `graphql-check.ts`).
Unrelated to `reload`/`reloadDescriptor` below — a completely different, already-implemented
mechanism; don't conflate the two. Four states:

- Omitted (the default): try this project's own default local Application (`'main'`). Only
  meaningful for a `spacecraft` project (`space` and `server` sharing one process — see
  `@zanix/cli`'s `zanix new` guide, "Spacecraft" section, for the real two-Application composition
  behind that sentence) **whose resolver lives under `src/server/`**; harmless and ignored
  everywhere else, including a plain `space` project with no server half at all, or a resolver
  reachable only through an `apps`-scoped Application (see the caveat below).
- A string: a different local Application's name, for a `spacecraft` with more than one — same
  `src/server/`-only caveat applies.
- `'external'`: explicit — this client talks to a schema outside this project's own composition (a
  third-party API, or even a Zanix backend living in a different repo/process). Always external,
  regardless of what the default would otherwise try. Skips schema validation entirely, syntax
  (`gql/`'s own text) is still checked.
- `{ external: true }`: same as `'external'` — genuinely not local, never triggers the "unmatched
  Application" warning below — but ALSO opts into real schema-match validation, against a schema
  fetched once via GraphQL introspection and cached on disk. See "Validating an external schema"
  below for the full mechanism. The object form itself is the opt-in — there's no separate boolean
  option to also set, and mixing "checked" with a local Application name isn't possible: it's a type
  error, not a silently-ignored flag.

Deliberately **not** inferred from `baseUrl` — a `spacecraft`'s own `space` and `server` halves can
bind different ports, so "local vs. external" can't be read reliably off the URL alone; it has to be
stated, not guessed.

**What the check actually does, today.** Two layers, both real: **Layer 1** (syntax) `parse()`s
every exported string in `gql/**/*.gql.ts` with `graphql-js`, always, independent of
`schemaApplication` or any local server — a broken query text is caught even for an `'external'`
client. **Layer 2** (schema match) additionally `validate()`s a non-`'external'` client's matched
`gql/<name>` content against a real, locally compiled schema — but only when that schema is actually
reachable, which today means **only a resolver auto-discovered under `src/server/`** (`'main'`,
populated by `Zanix.compose()`/ `Zanix.start()`'s own directory scan). A resolver reachable only
through an `apps`-scoped Application — a plain `space`'s own `server: { graphql: {...} }`
(`defineBootstrapSpaceAppConfig`), or even a `spacecraft`'s own space half — is invisible to this
check by design: `Zanix.compose()` deliberately never activates an `apps` entry (it could carry real
`dependencies`/`onStart` side effects a safe, static build-time check has no business triggering),
so `{}` comes back and that client is silently treated the same as `'external'` — no failure, no
false pass, just nothing checked. See `@zanix/cli`'s `docs/new.md`, "Declaring `server: {...}` on a
plain `space` doesn't make it a spacecraft," for the full reasoning and the `spacecraft`-specific
escape hatch (put the resolver in `src/server/`, not behind the space app's own `setup()`).

**Validating an external schema — `{ external: true }`.** A truly external client (a third-party
API, or a Zanix backend in another repo) has no local source code to statically compose — the only
way to know its schema is a real GraphQL introspection call against it. That's a genuinely different
risk profile from Layer 2's local check (network-dependent, can be slow or fail if the remote API is
down), so it's never done automatically as part of `zanix space build`/`zanix space dev`. Instead:

1. Opt in: `schemaApplication: { external: true }` on the client's constructor (instead of the plain
   `'external'` string):

   ```ts
   'server-only'

   import { GraphQLClient } from '@zanix/server'
   import { GET_COUNTRIES } from '../gql/countries.gql.ts'

   class CountriesClient extends GraphQLClient {
     constructor() {
       super({
         baseUrl: 'https://countries.trevorblades.com/graphql',
         schemaApplication: { external: true },
       })
     }

     public getCountries() {
       return this.query<{ countries: Country[] }>(GET_COUNTRIES)
     }
   }
   ```

2. Run `zanix generate graphql-schema` (`@zanix/cli`) — a separate, explicit command, never
   triggered by `build`/`dev`. It discovers every `{ external: true }` client in the project, calls
   its real `GraphQLClient.introspect()` (an actual network request against that client's own
   `baseUrl`), and caches the result as real SDL text at `gql/<name>.schema.graphql` — a `#`-comment
   header marks it auto-generated and warns against hand-editing (real GraphQL SDL syntax, invisible
   to `parse()`/`buildSchema()`). Covers every opted-in client in the project in one run, each
   attempted independently — one client's failure (introspection disabled, network down) never
   blocks another's.
3. From then on, `zanix space build`/`zanix space dev` read that cache file back and `validate()`
   against it — the exact same code path a local, `src/server/`-compiled schema already goes
   through; the check doesn't know or care whether the schema came from `Zanix.compose()` or a cache
   file on disk.

This cache is meant to be committed, the same way `deno.lock` is — deliberately generated, but
checked in, so a build stays reproducible without needing network access to the external API (CI
included). It doesn't auto-refresh: a remote API's schema can change independently of anything in
this project, so re-run `zanix generate graphql-schema` by hand when you know it has. If a
`{ external: true }` client has no cache file yet (the command was never run for it), that's a
warning, never a build failure — it means there's nothing to validate against yet, not that
something is broken.

`zanix space build` throws (a real failure, the build stops) on a syntax or schema mismatch;
`zanix
space dev` only logs it (`ZNX-ERROR`, never crashes the dev server). `--no-graphql-check`
opts out of both layers entirely. GraphQL Code Generator, the mainstream tool for this kind of
thing, was evaluated and set aside on purpose: not every `@zanix/space` consumer owns the schema it
queries against (some call a third-party GraphQL API with no schema at all to validate against), and
generated types/functions would need to be statically imported, which doesn't fit
`zanix space dev`'s "never compile, always read the source live" pattern the way plain `gql/` text
already does — `.query<T>()`'s own `<T>` stays hand-written and hand-trusted either way; this check
only validates the query text against the schema, it doesn't generate or check the response type.
`zanix space build`/`zanix space dev`'s own check reads from `gql/`, never writes back into it — the
same "compiled output never rewrites the hand-authored source" contract `messagesDir` already has
(see
[`docs/i18n.md#compilation-lands-in-its-own-directory--messagesdir-is-never-rewritten`](./i18n.md#compilation-lands-in-its-own-directory--messagesdir-is-never-rewritten)).

Call it from a page's `loader` — a plain function, not a class method, with no access to
`@zanix/server`'s DI container:

```tsx
import { Page, SpacePageController } from '@zanix/space'
import { usersClient } from '../clients/users.client.ts'
import type { User } from '../clients/users.client.ts'

function UsersView({ users }: { users: User[] }) {
  return (
    <ul>
      {users.map((user) => <li key={user.id}>{user.name}</li>)}
    </ul>
  )
}

@Page()
export default class UsersPage extends SpacePageController {
  public override loader = () => usersClient.getUsers().then((users) => ({ users }))
  public override component = UsersView
}
```

**A `space-server` project has a second option**:
`zanix generate connector <name> --slot
rest|graphql` (`@zanix/cli`) generates a
`@Connector()`-decorated subclass instead — resolvable via `this.connectors.get(SomeConnector)` from
an `@Interactor`/`@Handler` class, `@zanix/server`'s own DI container.
`--slot rest`/`--slot graphql` are NOT real core connector slots the way
`--slot
database`/`--slot cache:<subtype>` are (those require a package like `@zanix/datamaster` to
register the slot at runtime) — they're just two more shapes this generator can produce, so the
decorator stays bare `@Connector()`. A plain `space` project (no server half) has no DI container at
all, so it always uses the direct-instantiation shape above — there's nothing to generate a `--slot`
shell into.

### Refetching the same call from a Comet: `reload: true` and `createReloader`

A Comet's own "reload" button often needs to redo the EXACT same request its page's `loader` already
made server-side — hand-duplicating the endpoint/query a second time, client-side, risks the two
drifting out of sync (this is the case covered here; a Comet's own NEW client-only interaction — a
search box, pagination — has no matching server-side call to replay, and stays a plain `fetch()`,
see the next section). `RestClient.http.*`/`GraphQLClient.query()` accept `reload: true` for this,
opt-in per call — omit it (or pass `false`) and the return value is exactly what it always was:

```ts
'server-only'

import { GraphQLClient } from '@zanix/server'
import { GET_COUNTRIES } from '../gql/countries.gql.ts'

class CountriesClient extends GraphQLClient {
  constructor() {
    super({ baseUrl: 'https://countries.trevorblades.com/graphql', schemaApplication: 'external' })
  }

  public async getCountries() {
    const { data, reloadDescriptor } = await this.query<{ countries: Country[] }>(GET_COUNTRIES, {
      reload: true,
    })
    return { countries: data.countries, reloadDescriptor }
  }
}
```

With `reload: true`, the return becomes `{ data, reloadDescriptor }` for `GraphQLClient.query()`
(REST methods get the same `{ data, reloadDescriptor }` wrapping around their own plain value) —
`reloadDescriptor` is a fully-resolved, ready-to-replay descriptor: `endpoint`, `method`, `headers`,
`body`, already built from whatever this specific call actually sent.

Forward it through the `loader` untouched, as ordinary serializable data — the same mechanism
`initialCountries` already relies on:

```ts
public override loader = () => countriesClient.getCountries()
// -> { countries, reloadDescriptor }, forwarded straight through as the page's own props
```

The Comet builds a ready-to-call reload function from it with `createReloader`
(`@zanix/space/comet`):

```tsx
'use comet'

import { createReloader, defineComet } from '@zanix/space/comet'
import type { ReloadDescriptor } from '@zanix/space/comet'
import { useState } from 'react'
import type { Country } from '../clients/countries.client.ts'

interface CountriesProps {
  initialCountries: Country[]
  reloadDescriptor: ReloadDescriptor
}

export function Countries({ initialCountries, reloadDescriptor }: CountriesProps) {
  const [countries, setCountries] = useState(initialCountries)

  async function reload() {
    const { data } = await createReloader<{ data: { countries: Country[] } }>(reloadDescriptor)()
    setCountries(data.countries)
  }

  // ...render `countries`, call `reload()` from a click handler, same as any other Comet state...
}

export default defineComet(Countries, import.meta.url)
```

`createReloader` is deliberately minimal and renderer-neutral: no `onError`/state-callback option —
it always rejects on failure, and the caller's own `try`/`catch` around `reload()` is the only error
path, exactly like any other Comet state update, whether the Comet is written for React or Preact.
It doesn't try to unwrap a GraphQL response's own `.data` either — a real REST API can legitimately
have its own unrelated `data` field (a paginated list response, for instance), so guessing would
risk silently returning the wrong thing; the caller reads `.data` itself, the same way it already
does for the initial `getCountries()` call above.

#### `reloadableHeaders`: what's safe to expose to the browser

`reloadDescriptor` gets serialized into the page's initial client-side state — anything in its own
`headers` is, in effect, visible in the browser. Neither `RestClient` nor `GraphQLClient` ever
copies every header a call actually sent into it — only the names listed in `reloadableHeaders`:

```ts
protected reloadableHeaders: string[] = ['content-type']
```

Override it in a subclass to allowlist more — a genuinely public API key, for instance — never to
forward something secret:

```ts
class CountriesClient extends GraphQLClient {
  protected override reloadableHeaders = ['content-type', 'x-public-key']
  // ...
}
```

An `Authorization` header, or any other credential-carrying one, that isn't in this list is never
even looked at while building `reloadDescriptor` — it still reaches the real upstream request as
normal, it just never gets copied into the descriptor that crosses to the browser.

**What this doesn't protect**: the `endpoint` itself — the browser needs to know where to replay the
request, so that URL is always visible regardless of `reloadableHeaders`. For an API whose very
existence/URL must stay server-only (not just its headers), `reload: true`/`createReloader` is the
wrong tool for that specific call — point the client at a route your own space app owns instead,
which does the real upstream call server-side and returns only the resulting data to the browser.

### Client-side: plain `fetch()` in a Comet

The pattern above covers redoing a call the `loader` already made. A Comet's own genuinely NEW
client-only interaction — a search-as-you-type, pagination, anything with no matching server-side
call to replay — has nothing to attach `reload: true` to, and stays a plain `fetch()`, issued
directly from the Comet's own event handler after hydration:

```tsx
'use comet'

import { useState } from 'react'
import { defineComet } from '@zanix/space/comet'
import { Button } from '@zanix/space-ui'
import type { User } from '../clients/users.client.ts'

const USERS_ENDPOINT = 'https://api.example.com/users'

interface UsersListProps {
  /** Resolved server-side by the page's own `loader` — this Comet hydrates straight into it, so
   * there's no loading state on first paint. Only reached again by the button below. */
  initialUsers: User[]
}

export function UsersList({ initialUsers }: UsersListProps) {
  const [users, setUsers] = useState(initialUsers)

  async function reload() {
    const response = await fetch(USERS_ENDPOINT)
    setUsers(await response.json())
  }

  return (
    <div>
      <Button onClick={reload}>Reload</Button>
      <ul>
        {users.map((user) => <li key={user.id}>{user.name}</li>)}
      </ul>
    </div>
  )
}

export default defineComet(UsersList, import.meta.url)
```

The `initialUsers` prop is what makes this correct rather than redundant: the page's `loader`
already fetched the list once, server-side: the Comet receives that same list as its starting state
instead of re-fetching it a second time the moment it hydrates.

### CSP: allowing the external API's `connect-src`

The default CSP (see [`docs/middleware.md`](./middleware.md#default-csp-and-security-headers)) is
`default-src 'self'`, which blocks `connect-src` too (it falls back to `default-src` when unset) —
so a Comet's own `fetch()` to an external domain needs an explicit grant. A page rarely needs a
one-off CSP of its own, so register it once, app-wide, via `cspGuard`:

```ts
// src/space/middleware.ts — imported from space.app.ts so `zanix space dev` picks it up too
import { cspGuard, defineMiddleware } from '@zanix/space'

export default defineMiddleware([
  cspGuard((nonce) => ({
    'default-src': ["'self'"],
    'script-src': ["'self'", `'nonce-${nonce}'`],
    'style-src': ["'self'", `'nonce-${nonce}'`],
    'connect-src': ["'self'", 'https://api.example.com'],
  })),
])
```

This is the nonce-based form — the same shape `Page()`'s own zero-config default uses, kept so the
inline initial-state script `renderToResponse` always emits still survives a strict `script-src`.
See [`docs/middleware.md`](./middleware.md#default-csp-and-security-headers) for the full three-tier
precedence (a page's own `@Page({ headers: { csp } } )` still overrides this guard when set; the
server-side `loader`'s own request is a plain Deno `fetch()`, never subject to a browser's CSP at
all — only the Comet's client-side call needs this grant).
