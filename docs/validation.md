# Document validation

`@zanix/space` checks the documents your app produces, at build time. This guide covers what it
checks, what it deliberately does not, and how to configure it.

It is a **document** validation system, not an SEO checker. HTML conformance, accessibility, search
presentation, social metadata and PWA installability are different concerns answering to different
authorities, and folding them together is how a "best practice" quietly acquires the force of a
requirement. Every rule declares which concern it belongs to and — separately — what it actually
rests on.

## Running it

Validation runs automatically during `zanix space build` and `zanix space dev`. See
[`@zanix/cli`'s own `zanix space` guide](https://jsr.io/@zanix/cli) for the flags (`--validation`,
`--no-validation`, `--validation-strict`, `--validation-category`).

## The three axes

A rule has three independent properties, and keeping them independent is what makes the policy
possible to reason about:

| Axis                                  | Question it answers                          |
| ------------------------------------- | -------------------------------------------- |
| `severity` (`info`/`warning`/`error`) | How bad is this finding?                     |
| `optIn`                               | Is this rule active by default?              |
| `strict` (project-wide)               | Should active warnings be treated as errors? |

A rule being off by default says nothing about how serious it is when it fires, and turning strict
on says nothing about which rules are active.

### How a severity is decided

One function decides it, and the order is fixed:

```
catalog severity  →  per-rule override  →  strict promotion  →  effective severity
```

`strict` means literally that **no active warning stays a warning**, including one a project set
explicitly — a project asking for strict enforcement is asking about the outcome, not about which
warnings it happened to name. It never promotes `info`, which would make the mode useless by
enforcing things the framework itself says are not requirements.

## What a rule rests on

Every rule declares a `basis`, and whether it is _normative_ is derived from that — never stored
separately, so the two cannot disagree.

| Basis                          | Normative | Meaning                                                   |
| ------------------------------ | --------- | --------------------------------------------------------- |
| `spec`                         | yes       | A requirement of the HTML Standard or another protocol    |
| `accessibility`                | yes       | A WCAG success criterion, or a W3C ACT rule mapped to one |
| `installability`               | yes       | A documented criterion for a PWA being installable        |
| `search-engine-recommendation` | no        | Documented guidance from a search engine                  |
| `ecosystem-recommendation`     | no        | Widely-held practice with a real rationale                |
| `framework-invariant`          | no        | A rule `@zanix/space` imposes on its own output           |
| `project-convention`           | no        | A convention this framework's scaffolding follows         |
| `heuristic`                    | no        | A signal with no primary source at all                    |

A documented recommendation is **not** a norm, however authoritative its source. A normative rule
always cites its reference, so a finding that can fail a build can always answer "says who".

### Errors are rare

Five rules are errors, and only three rest on an external standard:

| Rule      | Basis               | Why it blocks                                                   |
| --------- | ------------------- | --------------------------------------------------------------- |
| `A11Y002` | accessibility       | The viewport prevents zoom (WCAG 1.4.4 AA, via ACT rule b4f0c3) |
| `DOC003`  | spec                | The response is not a document at all                           |
| `PWA001`  | installability      | Icons omit 192 or 512, so the app cannot be installed           |
| `FW001`   | framework-invariant | Head resolution produced conflicting canonical URLs             |
| `FW003`   | framework-invariant | The resolved head did not reach the rendered document           |

A rule qualifies as an error only when it is detected deterministically, represents an invalid
document or an unambiguous contradiction, has near-zero false positives, and has a clear answer to
"why should this block the build". Recommendations, heuristics and anything depending on content,
data or human judgement are warnings or info, however strongly held.

### `<h1>` is not a requirement

Worth stating explicitly, because it is the rule most often assumed to be one. A missing `<h1>` is
reported as a warning whose basis is `project-convention`. It is not required by the HTML Standard,
it is not a WCAG success criterion, and Google Search Central documents no requirement about heading
counts. It is reported because zero `<h1>` is a reliable signal of an incomplete template — nothing
more. A document without one is valid, and no error is ever produced for it. A project that wants
the convention enforced can opt into `strict`.

The same applies to heading order and multiple `<h1>`, both `info` and both off by default.

## The two phases

| Phase    | Decidable from                              | Runs                            |
| -------- | ------------------------------------------- | ------------------------------- |
| `static` | Modules, layouts, routes and configuration  | Always                          |
| `render` | Real rendered HTML, and therefore real data | `--validation=render`, dev only |

The render phase renders each route with no dynamic segments and validates the document it actually
produces, comparing extracted semantics rather than HTML strings — so a rule is written once and
holds for React and Preact alike.

## What cannot be checked, and is not guessed

Two categories are catalogued precisely so their absence is stated rather than discovered:

- **Runtime** — needs a live deployment: whether a canonical URL resolves to the intended page,
  whether an `og:image` exists at usable dimensions, hreflang reciprocity across domains, whether
  titles are unique across dynamic routes, whether a route returns a real 404 rather than a soft
  one.
- **Human** — needs judgement: whether headings and labels are descriptive, whether alt text
  actually describes its image, whether link text conveys its destination, whether content is
  substantive.

Neither is approximated. A confident wrong answer is worse than an admitted gap.

The same principle governs a page whose `head` is a function of loader data: that function is
**never** called with invented data. Head-content rules skip such a page and the skip is reported.

### `Not checked`

Every run reports what it could not check, and why. A validator that silently skips work reads
exactly like one that found nothing wrong, so the distinction between "clean" and "not checked" is
always visible.

## Configuring it

```ts
export default defineSpaceApp({
  name: 'storefront',
  validation: {
    strict: true,
    rules: { SEO002: true, A11Y007: 'info', SEO001: false },
    exempt: ['internal/**'],
  },
})
```

- **`rules`** both activates and sets severity. `true` switches an opt-in rule on at its own catalog
  severity; an explicit severity does both; `false` switches a rule off. A handful of rules are not
  configurable — the ones whose entire point is being unconditional — and they ignore overrides.
- **`exempt`** excludes route patterns from document rules. `*` matches within a segment, `**`
  across segments.
- **`validation: false`** disables it entirely for the project, and no command-line flag re-enables
  it.

### Exempting a route

There is deliberately no per-page way to opt out. A `static kind = 'endpoint'` was implemented and
removed: it described a route that is not a document, which the page contract cannot produce — every
`GET` yields a document, a redirect or a `304`, so a route existing only for its `action` still
serves a real document and still wants a title.

The two real exemptions need nothing declared on the page:

1. **An unconditional `redirect`** is inferred during discovery. That page never renders.
2. **A project route exemption** via `exempt`, which is policy and belongs to the project rather
   than to each page.

## See also

- [`docs/theming.md`](./theming.md) — design tokens and per-request theme resolution.
- [`docs/see-more.md`](./see-more.md) — additional notes.
