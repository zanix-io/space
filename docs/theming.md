## Theming — design tokens for `@zanix/space` apps

This is the full reference the README's "Design tokens" section points to. Most of it is a **naming
and authoring convention**, not a runtime API — declaring tokens, the primitive/semantic split, and
base↔host composition need no new field on `SpaceAppConfig` at all: the mechanism that makes them
work (composing a host's own token overrides with a base app's own, without the host forking or even
reading the base app's CSS) is `globalCss`'s own composition behavior (`addGlobalCssPaths`, see the
README's own CSS section) plus plain CSS custom properties and the normal cascade — both already
exist. This document fixes the vocabulary so two independently-authored apps don't invent two
incompatible conventions for the same idea.

The one genuine runtime API this document covers is `defineSpaceApp({ theme: { resolve } })` — see
["Runtime, per-request personalization"](#runtime-per-request-personalization) below — for the one
thing a stylesheet genuinely can't express: a token whose VALUE depends on which request is being
served (e.g. per-tenant branding), not just on which app/host declared it. Everything else in this
document stays exactly what it's always been: **static, resolved once at build/composition time**.

### Declaring tokens

A token is a CSS custom property declared on `:root`, in a stylesheet passed to
`defineSpaceApp({ globalCss })`:

```css
/* tokens.css — part of this app's own globalCss */
:root {
  --space-blue-500: #2563eb;
  --space-gray-100: #f5f5f5;
  --space-gray-900: #171717;

  --space-color-primary: var(--space-blue-500);
  --space-color-bg: #ffffff;
  --space-color-fg: var(--space-gray-900);
  --space-space-sm: 0.5rem;
  --space-space-md: 1rem;
  --space-radius-md: 0.5rem;
}
```

### Primitive vs. semantic tokens — and why the distinction matters

- **Primitive tokens** are raw values with no meaning attached — a color swatch, a spacing unit
  (`--space-blue-500`, `--space-space-md`). They describe a SCALE, not a role.
- **Semantic tokens** name a ROLE and reference a primitive
  (`--space-color-primary: var(--space-blue-500)`, `--space-color-bg`, `--space-color-fg`). They
  describe WHAT something is used for, not what value it happens to hold today.

**A component must only ever consume semantic tokens, never primitives directly.** This is the one
rule that makes host overriding actually work without the host needing to know the base app's own
palette: a host re-theming `--space-color-primary` to point at a completely different color doesn't
need to know or reuse the base app's `--space-blue-500` scale at all — it only needs to know the
semantic name. If a component read `var(--space-blue-500)` directly, a host wanting a non-blue
primary color would have to either fight the name (`--space-blue-500: #16a34a` — a green value
living under a blue-named token, confusing for the next reader) or reimplement the component's CSS
from scratch. Reserve primitives for defining semantic tokens; never reference a primitive from
component CSS.

### Naming convention — avoiding collisions

- Prefix every token your app declares with `--space-*` (already established in this README) — never
  a bare name like `--primary` or `--color-bg`, which collides trivially with a consumer's own
  tokens, another vendor's library, or a future Zanix-reserved name.
- Never name a token after a THIRD-PARTY tool's own internal prefix (e.g. never declare
  `--tw-color-primary` — `--tw-*` is Tailwind's own internal custom-property namespace; colliding
  with it silently breaks Tailwind's own utilities in ways that are hard to trace back to this
  file).
- Semantic token names should read as a role, not an implementation: `--space-color-primary`, not
  `--space-blue-main`. A host overriding it is changing WHAT plays the "primary" role, not
  redefining what "blue" means.
- If your app is itself meant to be composed as a base for others (a package other teams import and
  re-theme), treat your semantic token names as a public contract — renaming one is a breaking
  change for every host that overrides it, exactly as renaming an exported function would be.

### Exposing tokens as CSS custom properties

Nothing beyond plain CSS — declare them on `:root` in a stylesheet listed in `globalCss`, as shown
above. No build step processes or validates them; `cssPlugin` treats this stylesheet like any other.

### Light/dark

No Zanix-specific mechanism — the same pattern this ecosystem already uses for any other theme-aware
surface applies here too, entirely in plain CSS:

```css
:root {
  --space-color-bg: #ffffff;
  --space-color-fg: var(--space-gray-900);
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) {
    --space-color-bg: var(--space-gray-900);
    --space-color-fg: #ffffff;
  }
}

:root[data-theme='dark'] {
  --space-color-bg: var(--space-gray-900);
  --space-color-fg: #ffffff;
}
```

`[data-theme]` is an ordinary attribute your app's own root-layout/client code sets when a user
picks an explicit light/dark preference (however that preference is stored — this package has no
opinion on it); omitted, the OS-level `prefers-color-scheme` decides. A host wanting to change ONLY
the dark palette composes (via `globalCss`) a stylesheet that redeclares just the dark-mode block —
the light block, if the host doesn't touch it, still resolves from the base app's own declaration.

### How a host overrides a base app's tokens — precedence base → host

Tokens ride the exact same composition `globalCss` already has (see the README's CSS section and
`SpaceAppConfig.globalCss`'s own doc for `addGlobalCssPaths`) — there is no separate "token
override" mechanism:

```css
/* the HOST's own globalCss stylesheet — composed AFTER the base app's own, automatically */
:root {
  --space-color-primary: #dc2626; /* red, instead of the base app's blue */
}
```

Because the base app's `defineSpaceApp({ globalCss: ['./tokens.css'] })` call executes first (it's
the dependency the host imports/activates), and the host's own
`defineSpaceApp({ globalCss:
['./host-tokens.css'] })` call executes after, `getGlobalCssPaths()`
resolves to `['./tokens.css', './host-tokens.css']` — normal CSS cascade means the host's later
`:root` rule wins for any custom property it redeclares, and any semantic token the host does NOT
touch still resolves from the base app's own value. The host never needs to read or reference the
base app's own stylesheet path, and never needs to know the base app's own primitive scale — only
the semantic token names it wants to change.

### What a component should do

- Reference semantic tokens via `var(--space-color-primary)` — from Tailwind
  (`bg-[var(--space-color-primary)]`), CSS Modules, or vanilla-extract alike.
- Fall back sensibly when a token might not be declared (`var(--space-color-primary, #2563eb)`) only
  if the component is meant to be usable outside this app's own token sheet (e.g. a shared package)
  — a component that's always rendered inside this app's own root layout can rely on the token
  existing.
- Treat the token's NAME as the contract, never its current value — a component's own CSS should
  never assume `--space-color-primary` is blue, only that it's "the primary color, whatever that
  is."

### What a component should NOT do

- Never hardcode a color/spacing/radius literal that conceptually maps to an existing semantic token
  (`color: #2563eb` instead of `color: var(--space-color-primary)`) — this is exactly what the
  README's own suggested `stylelint-declaration-strict-value` rule exists to catch.
  - Never reference a primitive token directly from component CSS (see "Primitive vs. semantic"
    above) — always go through the semantic layer.
  - Never invent a component-local custom property that duplicates an existing semantic token under
    a different name (`--btn-primary-color` when `--space-color-primary` already exists) — that's a
    second vocabulary for the same idea, exactly the drift this whole convention exists to prevent.
  - Never assume a token is only ever ONE literal value across the app's lifetime — a host
    overriding it, or a dark-mode media query, both change it legitimately at runtime (in the sense
    of "resolved by the browser," not "changed by JS") without the component's own code changing at
    all.

### Runtime, per-request personalization

Everything above resolves ONCE, at build/composition time — the same token value for every request.
`defineSpaceApp({ theme: { resolve } })` is the one mechanism that varies a token's VALUE per
request, layered on top of (not replacing) the static convention above:

```ts
// space.app.ts
import { defineSpaceApp } from '@zanix/space'

export default defineSpaceApp({
  name: 'storefront',
  theme: {
    resolve: ({ population }) =>
      population === 'tenant-b'
        ? { '--space-color-primary': '#16a34a' } // green, for tenant B only
        : undefined, // every other request keeps the static tokens as-is
  },
})
```

- **`resolve(ctx)`** receives `{ population, lang, request }` for the CURRENT request — `population`
  is the same segment/tenant id `populationGuard`/`PageContext.population` already resolve (see that
  guard's own doc — this is the natural axis to key branding on, the same one `loadMessages()`
  already keys i18n content on); `lang` comes from this request's own `:lang` route param when this
  app follows the `routes/[lang]/...` convention, `undefined` otherwise; `request` is the raw
  `Request`, for anything neither of those covers.
- **Returns** `Record<string, string> | undefined` — a map of `--space-*` custom-property overrides
  (or `undefined`/`{}` for "no override, the static tokens above apply as-is"). Injected as a small,
  nonced `<style>` block on every full-document response, positioned so it correctly overrides the
  static stylesheet's own `:root` declarations via normal CSS cascade — never touches, replaces, or
  needs to know about the static tokens it doesn't override.
- **App-wide only** — no per-page override in this first version. A specific page that genuinely
  needs a different policy is a real, deferred use case, not something worked around here.
- **Values are sanitized**, not trusted verbatim: a token name must be a real custom-property name
  (`--foo-bar`), and a value containing `;`/`{`/`}`/`<`/`>`/a backtick/a newline is dropped entirely
  rather than interpolated — closes the injection surface a careless resolver (or a resolver that
  forwards some external-ish value without thinking) could otherwise open. See
  `theme/theme-style.ts`'s own doc for the exact rules.
- **CSP**: the injected `<style>` needs `style-src` to permit its own nonce —
  `SpacePageController`'s own zero-config default CSP already grants this (unconditionally, even for
  an app that never configures `theme` — an unused nonce permission is inert). A page or app that
  supplies its OWN custom CSP (replacing the framework's default entirely) must grant its own
  `style-src` + matching nonce for a resolved theme override to actually apply — the exact same
  disclosure already required of a custom policy that restricts `script-src` against the inline
  initial-state script.
- **Caching**: a page combining `cacheControl` with a configured `theme.resolve` automatically folds
  `population` into its own `ETag` — closing a real, narrow gap: without it, two populations sharing
  identical `loader` data (a page whose CONTENT doesn't vary by population, only its branding does)
  would collide on the same ETag, and a stale `304` could serve one population's resolved theme to
  another, even with no shared cache anywhere in the picture. This fix is deliberately narrow: it
  does **not** make `@zanix/space` "population-aware" for caching in general, and it says nothing
  about a SHARED cache (a CDN/proxy) potentially serving one population's cached response to another
  BEFORE ever revalidating at all — that partitioning question is a separate, already-documented
  architectural boundary (`populationGuard`'s own doc: "nothing in `@zanix/space` itself assumes a
  shared cache exists today") and stays explicitly out of scope here. `cacheControl` itself stays
  the page author's own explicit responsibility, exactly as before this feature existed.
- **Prefetch**: Orbit's own hover/viewport prefetch never modifies the DOM or triggers extra
  hydration/render on its own — a resolved theme is entirely a SERVER-SIDE, SSR-time concern (the
  `<style>` block is just more text inside whatever HTML gets cached/served), so prefetch needs no
  theme-specific handling at all; it already behaves correctly by construction.
