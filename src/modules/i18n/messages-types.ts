/**
 * The shapes of a message catalog and of a source that contributes one. Kept apart from
 * `load-messages.ts` so `messages-registry.ts` can name {@linkcode MessagesSource} without importing
 * the module that itself imports the registry.
 *
 * @module
 */

/** Structurally mirrors `@formatjs/icu-messageformat-parser`'s own `MessageFormatElement` node
 * shape — redeclared, not imported: `@zanix/space` must never reach FormatJS/ICU, even as a type
 * (enforced by `dependency-boundary.test.ts`, whose own graph check covers types, not just runtime
 * code) — see {@linkcode Messages}'s own doc for why a catalog value can be this shape at all. */
export type CompiledMessageNode = { type: number; value?: string; [key: string]: unknown }

/** A flat message catalog — namespaced string keys mapping to either a raw ICU string (the
 * uncompiled/dev-mode shape, e.g. `{ 'products/title': 'Our products' }`) or, once `zanix space
 * build` has compiled a catalog to AST (written to `{clientBuildDir}/messages/...`, NEVER back
 * into `messagesDir` itself — see `loadMessages`'s own doc), an already-parsed
 * {@linkcode CompiledMessageNode} array for that same key. `loadMessages()` never inspects or
 * distinguishes the two — it reads whatever is on disk and returns it as-is — so a caller that
 * renders `messages[key]` directly (e.g. as a JSX child) must handle both, which in practice means
 * routing through `@zanix/space-ui`'s `IntlProvider`/`useIntl().formatMessage()` rather than
 * interpolating a catalog value directly: that formatter accepts either shape and always returns a
 * plain string. Deliberately NOT nested objects, for either shape: a shallow merge (base catalog,
 * then population override) is only correct for a flat shape — see `loadMessages`'s own
 * doc for why this is a real constraint, not an arbitrary choice. */
export type Messages = Record<string, string | CompiledMessageNode[]>

/**
 * A provider of message catalogs that is not a directory on disk — the way a package ships default
 * messages for the screens it owns, since a package has no directory an app could list in
 * `messagesDir`. Declared through `defineSpaceApp({ messageSources })`.
 *
 * `loadMessages` calls it once for the base catalog with `population` omitted, and once for the
 * override with `population` given, in which case it returns only the keys that differ from its own
 * base. Returning `undefined` means the source has nothing for that request, which is normal. The
 * returned catalog must be flat, like any other catalog, and is used as returned: a source that
 * wants precompiled values ships the AST itself.
 *
 * A source that throws or returns something that is not a flat object is logged and skipped,
 * never failing the request.
 */
export type MessagesSource = (
  lang: string,
  population?: string,
) => Messages | undefined | Promise<Messages | undefined>
