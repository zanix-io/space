## Middleware — CSP/security headers, CSRF, language routing, population resolution

This is the full reference the README's
["Middleware (guards, default CSP and security
headers)"](../README.md#middleware-guards-default-csp-and-security-headers) section points to — the
four guard/pre-handler mechanisms `@zanix/space` ships: automatic CSP/security headers, `csrfGuard`,
`langPreHandler`/`langGuard`, and `populationGuard`.

### Default CSP and security headers

Every page gets `Content-Security-Policy` and a small set of security headers automatically, with no
configuration:

```tsx
@Page('products/:id')
export default class ProductPage extends SpacePageController<{ id: string }> {
  loader = async (ctx) => ({ product: await getProduct(ctx.params.id) })
  component = ProductView
}
// → Content-Security-Policy: default-src 'self'; script-src 'self' 'nonce-<random, per request>'
// → X-Frame-Options: SAMEORIGIN
// → Referrer-Policy: strict-origin-when-cross-origin
// → X-Content-Type-Options: nosniff
```

The default CSP is **nonce-based**, not `'unsafe-inline'`: `renderToResponse` always emits an inline
`<script>` for the page's initial-state block, so a naive default (`script-src 'self'` with no
exception) would make the framework block its own hydration. Instead, `SpacePageController`
generates a fresh, cryptographically random nonce on every request, puts it in both the CSP header
and that `<script>` tag's `nonce` attribute (via React's own `renderToReadableStream({ nonce })`
option), so the policy stays strict without needing `'unsafe-inline'`. Verified end to end in
`page-default-security.test.tsx` — the header's nonce and the rendered script's `nonce` attribute
are asserted to match, not just each existing independently.

**Customize per page** via a single `static headers` on the page class (or `@Page({ headers })`) —
`csp` is just one field among the rest, not a separate option, since it's still fundamentally a
response header:

```tsx
export default class CheckoutPage extends SpacePageController {
  static headers = {
    // A custom, static CSP — loses the automatic nonce coordination; permit 'unsafe-inline' or
    // build your own nonce-based policy with cspGuard's function form if this page also needs the
    // initial-state script to survive a strict script-src.
    csp: {
      'default-src': ["'self'"],
      'frame-src': ['https://payments.example.com'],
    },
    frameOptions: 'DENY' as const, // overrides just this one field; the rest keep their own default
  }
  component = CheckoutView
}
```

`headers: false` disables everything (CSP included) for that page. `headers: { csp: false }`
disables just CSP while keeping the rest of the defaults.

**Customize app-wide, once, instead of repeating it on every page** — CSP/security headers are
conventionally configured once per app in practice (this is what `helmet`/Next.js middleware/etc.
do), not per page, so `defineSpaceApp()` — the one file every app already writes — takes the same
`headers` shape as a page's own `static headers`:

```ts
// space.app.ts
import { defineSpaceApp } from '@zanix/space'

export default defineSpaceApp({
  name: 'storefront',
  headers: { frameOptions: 'DENY', csp: { 'default-src': ["'self'"] } },
})
// every page now gets this policy — unless that specific page sets its own `headers`, which still
// wins (precedence: page's own `headers` > this app-wide default > the framework's built-in default)
```

**A page overriding one field never loses the rest of the app-wide default** — the two levels are
merged field by field, not swapped as whole objects:

```ts
// app-wide (above): { frameOptions: 'DENY', csp: {...} }

export default class SomePage extends SpacePageController {
  static headers = { noSniff: false } // only this one field is touched
  // frameOptions stays 'DENY' and csp stays the app-wide policy — neither reverts to the
  // framework's own built-in defaults just because this page customized something else.
}
```

`csp` itself is the one field merged as a whole, not directive-by-directive — a page setting its own
`csp` replaces the app-wide policy entirely (still leaving every _other_ field, like `frameOptions`,
merged normally).

There's no separate `<Helmet>`-style component for this, deliberately — an HTTP response header has
to be decided _before_ the response body starts streaming, so nothing rendered by the component tree
can ever influence it in time; a component-based API would be actively misleading here. (Document
`<head>` tags — `<title>`/`<meta>`/`<link>` — are a different, already-solved problem: React 19
hoists those natively from anywhere in the tree, no Helmet needed for that either.)

**For a guard that isn't CSP/security headers** (rate limiting, custom auth-like checks), reuse
`@zanix/server`'s real guard mechanism directly — `@zanix/space` doesn't wrap or reimplement it:

```ts
import { Guard } from '@zanix/server'
import { rateLimitGuard } from '@zanix/auth'
import { Page, SpacePageController } from '@zanix/space'

@Page('checkout')
@Guard(rateLimitGuard({ windowSeconds: 60, anonymousLimit: 20 }))
export default class CheckoutPage extends SpacePageController {
  component = CheckoutView
}
```

`defineMiddleware(guards)` registers one or more `MiddlewareGuard`s for every SSR page route in the
process at once, via `@zanix/server`'s own `registerGlobalGuard`, scoped to `'ssr'` routes only —
the right tool for something that isn't CSP/security headers and genuinely needs to apply everywhere
(there's no per-`Application` scoping: a guard passed here applies to every `'ssr'` route in the
process, regardless of which `Application` owns it).

**Every security header this framework manages — CSP included — resolves through the same three-tier
chain**: this page's own explicit config (via `Page({ headers })`, or the app-wide
`defineSpaceApp({ headers })` default when this page sets none of its own) beats a guard registered
via `defineMiddleware`/`@Guard` (`cspGuard()`/`securityHeadersGuard()`), which in turn beats this
page's own zero-config default — the same order each header resolves in when nothing else is
configured at all. Applies uniformly to `csp`, `frameOptions`, `referrerPolicy`, `noSniff`, and
every other field `securityHeadersGuard()` manages:

```ts
defineMiddleware([
  cspGuard({ 'default-src': ["'self'"] }),
  securityHeadersGuard({ frameOptions: 'DENY' }),
])

export default class SomePage extends SpacePageController {
  static headers = { csp: { 'default-src': ["'unsafe-inline'"] } }
}
// → Content-Security-Policy: default-src 'unsafe-inline' (this page's own policy, tier 1)
// → X-Frame-Options: DENY (this page configured nothing for this field — the guard's, tier 2)

export default class OtherPage extends SpacePageController {}
// → Content-Security-Policy: default-src 'self' (the guard's policy, tier 2)
// → X-Frame-Options: DENY (the guard's policy, tier 2)
```

`false` is tier 1 too, for every field that accepts it — an explicit "no header for this page" that
wins even over a registered guard, ending up with that header **completely absent** from the
response (never an empty value, never the guard's policy, and never the two combined into one
comma-joined value):

```ts
export default class CheckoutPage extends SpacePageController {
  static headers = { csp: false, frameOptions: false }
}
// → no Content-Security-Policy header at all, even with the guard above registered
// → no X-Frame-Options header at all, even with the guard above registered
```

A page in an app with no guard registered for a given field at all falls through to tier 3, that
field's own zero-config default (nonce-based for CSP;
`SAMEORIGIN`/`strict-origin-when-cross-origin`/ `nosniff` for
`frameOptions`/`referrerPolicy`/`noSniff` — the three that have one at all), exactly as before this
precedence chain existed. A field with no zero-config default of its own
(`permissionsPolicy`/`strictTransportSecurity`/the three cross-origin-isolation fields, all off by
default) simply stays absent in that case, same as always.

**Cross-origin isolation** (`SharedArrayBuffer`, precise timers) is available but off by default —
`crossOriginOpenerPolicy`/`crossOriginEmbedderPolicy`/`crossOriginResourcePolicy` on `headers` (or
`securityHeadersGuard`'s own options) — off by default because the strict values break ordinary
OAuth/payment popups and third-party embeds unless the whole app is updated for it.

### CSRF protection (`csrfGuard`)

Real, standalone code — the double-submit-cookie pattern, not something reused from elsewhere. Not
applied by default (unlike CSP/security headers, this can reject a real request outright, so an
automatic default risks silently breaking any existing `action` that doesn't render the token yet):

```tsx
import { Guard } from '@zanix/server'
import { csrfGuard, Page, SpacePageController } from '@zanix/space'

@Page('checkout')
@Guard(csrfGuard())
export default class CheckoutPage extends SpacePageController {
  loader = (ctx) => ({ csrfToken: ctx.csrfToken })
  component = CheckoutView
  action = async (
    ctx,
  ) => {/* csrfGuard already validated by the time this runs */}
}

function CheckoutView({ csrfToken }: { csrfToken?: string }) {
  return (
    <form method='post'>
      <input type='hidden' name='_csrf' value={csrfToken} />
      {/* ... */}
    </form>
  )
}
```

On a `GET`, the guard issues (or reuses) a token in an `HttpOnly` cookie and makes it available as
`ctx.csrfToken` inside `loader` — hand it to `component` to render as the hidden field above. On any
other method, the request is rejected unless the submitted token (that `_csrf` field, or an
`X-Znx-Csrf-Token` header for a fetch/XHR-based action) matches the cookie.

**The cookie name must start with `X-Znx-` and contain `Csrf`** (default: `X-Znx-Csrf`), enforced at
construction: `csrfGuard()` throws (`@zanix/utils`'s `assertZnxCookieName`) if a custom `cookieName`
violates either rule. The prefix requirement exists because `@zanix/server`'s built-in cookie
filtering silently drops anything outside that prefix before `csrfGuard` ever runs — a cookie named
`znx-csrf` (lowercase, no `X-` prefix) is issued and echoed back correctly at the HTTP level while
staying invisible to the guard; see
[`@zanix/server`'s own `docs/middlewares.md`](https://github.com/zanix-io/server/blob/main/docs/middlewares.md#cookie-filtering)
for the full mechanism. The `Csrf` requirement exists so a customized name stays recognized by
`@zanix/utils`'s sensitive-key redaction pattern — dropping that word stops the token from being
redacted out of logs.

`@zanix/auth`'s own session cookies already default to `SameSite=Strict`, which mitigates most
classic CSRF on its own — `csrfGuard` is real defense-in-depth on top of that, or a substitute for
an app not using `@zanix/auth`'s cookies at all.

### Language routing (`langPreHandler`, `langGuard`)

A **`PreHandler`**, not a guard — `@zanix/server`'s pre-route-matching hook, since guards (and a
page's own `static headers`) only ever run AFTER a route has already matched, too late for a
redirect keyed on the URL not matching a language-prefixed route at all:

```ts
import { bootstrapServers } from '@zanix/server'
import { langPreHandler } from '@zanix/space'

await bootstrapServers({
  ssr: {
    preHandler: langPreHandler({ availableLangs: ['en', 'es'], defaultLang: 'en' }),
  },
})
```

Every page is expected to live under a `routes/[lang]/...` folder — `Space`'s own `[param]` folder
convention already maps that to a `:lang` route segment, nothing new there. A request whose first
path segment is already one of `availableLangs` falls through unchanged; otherwise it resolves a
language — a persisted `X-Znx-Lang` cookie, then `Accept-Language`, then `defaultLang` — and
301-redirects to that same path with it prepended (`/products` → `/en/products`, `/` → `/en`),
setting the cookie on that same response. Never redirects a framework-internal route (`/health`,
`/ready`, `/assets/`, `/icons/`, `/manifest.webmanifest`, `/sw.js`) — `ignorePrefixes` extends that
list for an app's own non-i18n routes, never replaces it.

The `PreHandler` alone only ever updates the cookie on an actual redirect — it can only return a
full `Response` or `null`, so an already-correctly-prefixed request (the common case: someone
browsing entirely under `/es/...` via a language switcher's own links) has no way to refresh a stale
cookie from an earlier visit through this hook. `langGuard` closes exactly that gap: it runs AFTER
route matching, where a guard's returned `headers` DO get merged into the response, and reads the
language back out of the matched route's own `:lang` param:

```tsx
import { defineMiddleware, langGuard } from '@zanix/space'

export default defineMiddleware([langGuard()])
```

Purely additive, same as `populationGuard` — never rejects a request, so it's safe to apply app-wide
via `defineMiddleware`. Pass it the same `cookieName` given to `langPreHandler` if that was
customized; both default to `X-Znx-Lang`, and both throw at construction (via `@zanix/utils`'s
`assertZnxCookieName`) if a custom name doesn't start with `X-Znx-`. Requires
`@zanix/server >=
3.2.0`, which merges multiple guards' `headers` on the same route instead of
letting same-name headers (here, `Set-Cookie`) silently clobber each other — needed for
`populationGuard` and `langGuard` to coexist on one page (see that package's own CHANGELOG).

**No per-route opt-out is provided**: every route is prefixed uniformly. Simpler, and nothing in
`@zanix/space` today has a proven need for mixing prefixed and unprefixed pages in the same app;
that flexibility can be added if a real case shows up, rather than built speculatively now.

### Population resolution (`populationGuard`)

Resolves which population (segment/tenant content variant) the current request is for — route param,
then query string, then a persisted cookie, in that order — and exposes it as `ctx.population`
inside `loader`. Purely additive, unlike `csrfGuard`: it never rejects a request, so (like
`cspGuard`/`securityHeadersGuard`) it's safe to apply to every page at once via `defineMiddleware`,
not just per-page:

```tsx
import { defineMiddleware, populationGuard } from '@zanix/space'

export default defineMiddleware([populationGuard()])
```

```tsx
loader = (ctx) => ({ population: ctx.population })
component = ({ population }) => <p>Showing content for: {population ?? 'default'}</p>
```

Resolved **on the server**, not just the client — `@zanix/space` is SSR-first specifically to avoid
a client-side-only personalization step causing a flash of the wrong content after hydration, so a
request carrying only the cookie (no param, no query) still gets the right population from the very
first response. When the value came from the param or query string and doesn't already match the
cookie, the response also sets it (`Set-Cookie`) — so the next visit, with neither in the URL, still
resolves correctly. **The cookie name must start with `X-Znx-`** (default: `X-Znx-Population`),
enforced at construction the same way as `csrfGuard`'s own cookie (`populationGuard()` throws via
`@zanix/utils`'s `assertZnxCookieName` if it doesn't) — see
[`@zanix/server`'s own `docs/middlewares.md`](https://github.com/zanix-io/server/blob/main/docs/middlewares.md#cookie-filtering)
for why the prefix matters — but deliberately **not** `HttpOnly`: unlike the CSRF token, client-side
code is expected to be able to read this one too.

If a shared HTTP cache ever sits in front of `@zanix/space`, that layer needs `Vary` on this cookie
— an SSR response that varies per-visitor cookie can't be cached the same way a uniform one can.
Nothing in `@zanix/space` itself assumes a shared cache exists today.

This guard only resolves _which_ population a request belongs to — the actual population-specific
_content_ (message/override files, merge precedence, caching) is `loadMessages`'s own job, see
[`docs/i18n.md`](./i18n.md).

## See also

- [`README.md`](../README.md#middleware-guards-default-csp-and-security-headers) — the "Middleware"
  section this guide is the full reference for.
- [`docs/i18n.md`](./i18n.md) — content resolution for the `(lang, population)` pair these guards
  resolve.
