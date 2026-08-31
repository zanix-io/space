## Logging — the browser-safe client logger and its `/api/log` relay

Server-side code (handlers, interactors, repositories, `main.ts`) logs the same way any Zanix
backend does — `import logger from '@zanix/logger'`. This guide covers the other half: how
**client-bundled** code (Comet hydration today) logs from the browser without shipping any of
`@zanix/logger`'s server-only machinery (`WorkerManager`, `Deno.readTextFile`) into the client
bundle.

### Why a separate logger for client code

Importing the regular `@zanix/logger` from a file that ends up in a client bundle pulls in its
file-based storage backend transitively — invisible at runtime (no thrown error, no console warning;
a Comet still hydrates and works fine), but real dead weight shipped to every visitor's browser.
`@zanix/utils/logger/client` (`createClientLogger`) is a genuinely browser-safe entry point instead,
and this package uses it everywhere a module is reachable from
`@zanix/space/client`/`@zanix/space/client/preact`.

### The shared client logger

`modules/client/client-logger.ts` builds ONE shared instance and every client-bundled module in this
package imports it:

```ts
import { createClientLogger } from '@zanix/logger/client' // alias for jsr:@zanix/utils/logger/client

function postLog(fmtLog) {
  fetch('/api/log', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(fmtLog),
  }).catch(() => {})
}

const logger = createClientLogger(postLog)
export default logger
```

This is a single, shared instance on purpose — `createClientLogger` constructs a real `Logger`, and
a `Logger`'s constructor claims `globalThis.logger` by default; three independent instances (one per
file that logs) would race to own it. `hydrate-comets.ts`, `hydrate-comets-preact.ts` and
`comet-persistence.ts` all log through this one instance instead. It is an internal implementation
detail, not re-exported from `@zanix/space/client`/`@zanix/space/client/preact`.

A failed `fetch()` (offline, a proxy blocking the request) is swallowed silently — a logging call
must never be what breaks the page.

### Isolation from the server-side logger

`modules/client/client-logger.ts` and the server's own default `@zanix/logger` instance never share
state, and can't accidentally overwrite one another:

- **Different module graphs.** `client-logger.ts` imports `@zanix/logger/client`
  (`@zanix/utils/logger/client`) only — never `@zanix/logger` — and is reachable only from
  `@zanix/space/client`/`@zanix/space/client/preact`'s own client-bundled files
  (`hydrate-comets.ts`, `hydrate-comets-preact.ts`, `comet-persistence.ts`). `log.controller.ts`
  (the `/api/log` handler) imports the SERVER `@zanix/logger` only. Neither file imports the other.
- **Different runtimes.** Even setting the module graph aside, a browser tab's `globalThis` and the
  server process's `globalThis` are never the same object — a client-side `Logger` instance
  physically cannot reach the server's own global logger.
- **`createClientLogger` never claims a global anyway.** `createClientLogger` always builds with
  `disableGlobalAssign: true` by default — it never assigns itself as `globalThis.logger` in the
  browser in the first place. This package depends on `@zanix/utils@^4.0.0` (`deno.lock` resolves
  `@zanix/logger/client`'s alias to `4.1.0`), so this is already true today — a third, independent
  layer on top of the two above, not the only thing keeping this isolated.

The server's own SSR/backend code keeps using `import logger from '@zanix/logger'` exactly as before
— nothing about this feature changes that.

### The `POST /api/log` relay

Every `@zanix/space` app automatically registers `POST /api/log` as part of `defineSpaceApp`'s own
`setup()` — this is core observability plumbing, not an opt-in `SpaceAppConfig` field the way
`assetsApi` is: there's no infrastructure to compose (the handler only ever calls the
already-configured `@zanix/logger` default instance), so there's no meaningful "off" state to offer.

#### Making sure it's actually reachable — `getBootstrapSpaceAppConfig`

Registering the route is necessary but not sufficient on its own. `@zanix/server`'s own
`bootstrapServers` only SERVES a request type (`rest`/`socket`/`graphql`/`ssr`) if it's either
explicitly named, or no type at all is named — the moment a caller names even one type (every real
`mod.ts` does, since it needs `ssr` at minimum), every OTHER type is excluded from being served
regardless of how many routes it has. A hand-written

```ts
await bootstrapRemoteApp(spaceApp, { server: { ssr: {} } })
```

confirmed live to 404 on `POST /api/log` — `rest` was never named, so it never got a listener, even
though the route itself was registered correctly. Use `getBootstrapSpaceAppConfig()` instead:

```ts
// mod.ts
import { getBootstrapSpaceAppConfig } from '@zanix/space'

await bootstrapRemoteApp(spaceApp, getBootstrapSpaceAppConfig())
```

With nothing else registered, this already defaults to `{ server: { ssr: {}, rest: {} } }` — the
same minimal `mod.ts` a plain `zanix new space` scaffold generates, now correct by default with no
extra wiring. An app needing more than that (a custom `rest` config, `remoteInstances` to announce
to the Control Plane, `uses`/`resources` bindings) registers it via `defineBootstrapSpaceAppConfig`
from `space.app.ts` (or anything it imports) instead of hand-editing `mod.ts` — same timing rule
[`docs/middleware.md`](./middleware.md)'s own `definePreHandler` already establishes, and the same
reason: `zanix space dev` reads this registration too, so a consumer's own bootstrap options behave
identically under both:

```ts
// space.app.ts (or any module it imports)
import { defineBootstrapSpaceAppConfig } from '@zanix/space'

defineBootstrapSpaceAppConfig({
  remoteInstances: { endpoint: 'http://my-space:8000' },
})
```

A registered `server.ssr`/`server.rest` always wins over the bare defaults above — this mechanism
only ever fills a gap, never overrides an explicit choice.

**No full auth (`@AuthTokenValidation`/session requirement) on this route — but it's not
unprotected.** This is the same genuinely-public posture `sitemap.xml`/`robots.txt` already use in
this package: the whole point of `/api/log` is accepting a POST from any anonymous browser tab that
ever loaded this app's client bundle, which by definition has no auth context to gate on.
`rateLimitGuard`'s own anonymous mode doesn't authenticate anyone either — it only bounds anonymous
traffic — so this stays genuinely anonymous, never "authenticated" in any real sense. This differs
from `assets-api`'s own deny-by-default posture (its routes do expensive, abusable work — spawning
`ffmpeg`, consuming storage — that must stay off until an integrator opts in): this endpoint's real
mitigations are already in place by default, in a different shape —
[`@zanix/server`'s own global 1 MiB request body-size cap](https://jsr.io/@zanix/server) (applies to
every request in this ecosystem, no code needed here) plus a mandatory default `rateLimitGuard` (see
below) bounding write-volume/storage amplification from any one anonymous origin.

#### The default rate limit, `logApi.rateLimit`, and `logApi.guards`

`createLogApiController` always builds this route with a default guard:

```ts
rateLimitGuard({
  windowSeconds: 60,
  anonymousLimit: 30, // sized for one human's own browser tab, not bulk traffic
  trustProxyHeader: true, // per-caller (IP+User-Agent hashed) buckets, not one shared bucket
})
```

30 requests/minute per anonymous caller is deliberately conservative: comfortably above what a real
human session's own page-load telemetry plus occasional warn/error bursts ever needs, while still
capping a runaway client-side retry loop (or a deliberately abusive caller) well short of meaningful
storage write amplification. `trustProxyHeader: true` is what makes the budget genuinely _per
caller_ rather than one shared bucket every anonymous visitor competes for — `false` would let a
single busy tab exhaust the quota for every other real user.

`SpaceAppConfig.logApi` exposes two DIFFERENT knobs over this same default guard — don't confuse
them:

- **`rateLimit`** — overrides `anonymousLimit`/`windowSeconds`/`trustProxyHeader` outright. This is
  the real "change the floor" surface, for an app whose traffic profile genuinely differs from the
  framework's own default, or whose deployment does (or doesn't) sit behind a trusted reverse
  proxy/CDN that overwrites client-IP headers — `trustProxyHeader` isn't just a taste knob, it's a
  deployment-topology fact this package can't safely assume the same way for every consumer. Every
  field is optional and falls back to the current default when omitted:

  ```ts
  export default defineSpaceApp({
    name: 'storefront',
    logApi: { rateLimit: { anonymousLimit: 60, trustProxyHeader: false } },
  })
  ```

- **`guards`** — extra guards, run AFTER the (possibly overridden) default, in order,
  short-circuiting on the first denial. Unlike `assets-api`'s own `guards` option (which _replaces_
  its `[denyAllGuard]` placeholder the moment a real list is configured — there's no policy decided
  yet for that API), this endpoint's default rate limit **is** the decided policy:
  `SpaceAppConfig.logApi.guards` only ever _appends_, never removing or replacing it — a consumer
  that wants a genuinely different budget/window/IP-trust posture uses `rateLimit` above instead,
  not this option:

  ```ts
  export default defineSpaceApp({
    name: 'storefront',
    logApi: { guards: [myExtraAbuseCheckGuard] },
  })
  ```

Omitting `logApi` entirely (the default) still registers the route with just its own default rate
limit — there is no way to configure this endpoint down to "no guard at all."

#### Request/response contract

```
POST /api/log
Content-Type: application/json

{ "level": "warn", "message": "Something worth a look", ... }
```

- `level` — must be a real `LoggerMethods` value:
  `'info' | 'error' | 'high' | 'warn' | 'debug' |
  'success'`. Validated at the API boundary;
  everything else in the body is opaque as far as this endpoint is concerned. Named `level`, not
  `type`, because that's the real severity field `DefaultFormattedLog` (what the client `Logger`
  actually serializes) carries — `Logger#ingest`'s own parameter happens to be called `type`, but
  that's just its local name, not the wire field.
- `origin` — normally ABSENT: `client-logger.ts`'s own `postLog` deliberately never sends it, since
  this route's only real caller is always a browser client, and `Logger#ingest`'s own `'client'`
  default already covers that — asserting the same fact again in the request body would just
  duplicate it. A caller relaying from somewhere else entirely (not this package's own client) can
  still send an explicit `origin` to override that default.
- Everything except `level` (`message`, `origin` if present, plus whatever else a given log entry
  carried) is relayed as-is into the server's own logger.

```json
{ "ok": true }
```

Internally, the handler relays the request body per `@zanix/utils`'s own documented relay contract —
`Logger#ingest(type, origin = 'client', ...data)` — with one small addition: `data.message` is
`unknown` at this RTO's own boundary (it's captured, not validated), so the handler coerces it to a
`string` before it reaches `Logger#ingest`'s own required-`string` first data element, defaulting a
missing/non-string `message` to `''` rather than rejecting it:

```ts
import logger from '@zanix/logger' // the SERVER logger, already configured

const { level, data } = requestBody // already split apart by LogIngestRTO's own constructor
const origin = typeof data.origin === 'string' ? data.origin : undefined
logger.ingest(level, origin, String(data.message ?? ''), data)
```

Passing `undefined` through (rather than resolving `'client'` here) is deliberate —
`Logger#ingest`'s own default parameter is the ONE place that default actually lives; the handler
never duplicates it.

`Logger#ingest` redacts and persists the raw data given exactly as `warn`/`error`/etc. would — never
`noSave` — so a relayed browser log persists through whichever backend the server's own
`@zanix/logger` instance is already configured with (file, Elasticsearch, a custom sink), with no
separate wiring needed for browser-originated logs. `origin` itself lands as a TOP-LEVEL field on
the persisted log (`DefaultFormattedLog.origin`), sibling to `timestamp`/`level`/etc., not buried
inside `data` — so a stored/queried log can be filtered or aggregated by origin directly. `ingest`
also skips the console print step every other log method runs — the browser origin already surfaced
the entry through its own console, so printing it again here would misrepresent a relayed remote
event as a genuine local one.

This package depends on `@zanix/utils@^4.0.0` (`deno.lock` resolves `@zanix/logger`'s alias to
`4.1.0`), which carries `Logger#ingest`'s `origin` parameter — verified against the real installed
package, not just the type signature: a relayed entry's `message` lands correctly (never corrupted
by `origin`), `origin` lands as a genuine top-level field, and nothing prints twice to the server
console.

### See also

- [`docs/assets-api.md`](./assets-api.md) — the closest structural precedent for a small,
  single-endpoint HTTP module in this package, including why its own default guard denies everything
  (the opposite posture from this endpoint's, for the reasons explained above).
- [`docs/seo.md`](./seo.md) — `sitemap.xml`/`robots.txt`, the other genuinely public, unguarded
  routes this package registers.
- [`docs/middleware.md`](./middleware.md) — `definePreHandler`/`getUserPreHandler`
  (`langPreHandler`), the sibling registration mechanism a real `mod.ts` combines with
  `getBootstrapSpaceAppConfig` above.
