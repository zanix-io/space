## Head management — precedence, deduplication, and JSX coexistence

This is the full reference the README's ["Head management"](../README.md#head-management) section
points to — how a page's `<title>`/`<meta>`/`<link>` declaration merges across the whole layout
chain into one resolved value, before any renderer serializes it.

### Declaring a head

A plain `HeadDescriptor`, or a function of `loader`'s own resolved data (the same value `component`
receives as props) when the head depends on it:

```tsx
@Page()
export default class ProductPage extends SpacePageController<{ id: string }> {
  loader = async (ctx: { params: { id: string } }) => ({ product: await getProduct(ctx.params.id) })
  static head = (data: { product: { name: string } }) => ({
    title: data.product.name,
    meta: [{ name: 'description', content: data.product.name }],
  })
  component = ProductView
}
```

A `layout.tsx` may declare its own `head` too — a plain descriptor, or a function of `params` (not
`loader`'s data, since a layout has no `loader` of its own):

```ts
// routes/products/layout.tsx
export const head = () => ({ title: 'Products' })
```

### Precedence and deduplication

**Precedence**: the page wins over its nearest layout, which wins over the next one out, ... down to
the root layout — checked field by field (`title`) or per identity key (`meta`/`link`), never
whole-descriptor-replaces-whole-descriptor.

**Deduplication**: `meta` by identity key (`name`, `property`, or `httpEquiv`); `link` by
`rel`+`href` (plus `hreflang`, when set — two `alternate` links can legitimately share an `href`,
e.g. `x-default` and another language's own entry, and both survive). The most specific declaration
for a given key wins; different keys all survive.

### Coexistence with JSX

**Coexists with a hand-authored JSX `<title>`/`<meta>`/`<link>` inside `component` — neither is ever
suppressed**, since this declaration's resolved output always renders BEFORE `component`'s own tree
— the document's FIRST `<title>` under both renderers (React 19's own hoisting in encounter order;
Preact places the resolved head at the front of `<head>` after rendering), confirmed by a dedicated
test asserting the exact ordering, not just presence. A root `layout.tsx` never has to cooperate
with this placement, and receives no head-related prop to.

Deliberately excludes `style`/`script` in this first iteration — a `<script>` for JSON-LD structured
data is `@zanix/space-ui`'s `StructuredData` component instead, rendered inline in `component`'s own
tree; see [`docs/seo.md`](./seo.md) for the SEO helpers built on top of this contract.

## See also

- [`README.md`](../README.md#head-management) — the "Head management" section this guide is the full
  reference for.
- [`docs/routing.md`](./routing.md#the-document-contract) — the renderer-agnostic `DocumentModel`
  this resolved head feeds into.
- [`docs/seo.md`](./seo.md) — `buildCanonicalLink`/`buildHreflangLinks`, the two pure link builders
  that feed a page's `head` through its own `loader`.
