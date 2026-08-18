/**
 * A real CSS custom-property name (`--foo-bar`) — deliberately strict (letters/digits/`-`/`_`
 * only, after the leading `--`), not the full CSS-identifier grammar (which also allows escapes
 * and a wider Unicode range): a design-token name has no legitimate reason to need either, and
 * rejecting them outright is simpler and safer than correctly validating the full grammar.
 */
const TOKEN_NAME_PATTERN = /^--[a-zA-Z][a-zA-Z0-9_-]*$/

/**
 * Characters a single CSS custom-property VALUE has no legitimate reason to contain, for THIS
 * module's own serialization format (`name:value` joined by `;`, wrapped in `:root{...}`) —
 * rejecting them closes every injection vector that format is actually exposed to:
 * - `;` — would close the current declaration and open a new one INSIDE `:root{}` (e.g. a value of
 *   `"red;background:url(evil)"` would smuggle in a real `background` declaration).
 * - `{`/`}` — would close `:root{}` early and open an entirely new rule (any selector, anywhere).
 * - `<`/`>`/`` ` `` — would risk breaking out of the surrounding `<style>` element itself (e.g.
 *   `</style><script>...`).
 * - CR/LF — no legitimate design-token value needs an embedded newline, and stripping them removes
 *   a cheap way to make injected content harder to spot in a diff/log.
 * None of these ever appear in a real, single design-token value (colors, `rgba(...)`/`url(...)`/
 * `calc(...)`/gradients, font stacks, sizes) — this is a strict denylist, not a CSS parser, and
 * deliberately so: correctly parsing/allowlisting full CSS value syntax would need either a real
 * parser or a new dependency, neither justified for this narrow a surface.
 */
const UNSAFE_VALUE_PATTERN = /[;{}<>`\r\n]/

/**
 * Filters `tokens` down to entries safe to interpolate into a `<style>` block — drops (never
 * throws on) any entry whose name isn't a real custom-property name, or whose value contains a
 * character from {@linkcode UNSAFE_VALUE_PATTERN}. Silent, not logged: a `ThemeResolver` is
 * author-written code, not a place this package assumes needs runtime diagnostics for a typo —
 * same "document the contract, don't add a logging dependency for it" choice `cspGuard`'s own doc
 * already makes for its own no-default-policy case.
 */
export function sanitizeThemeTokens(tokens: Record<string, string>): Record<string, string> {
  const safe: Record<string, string> = {}
  for (const [name, value] of Object.entries(tokens)) {
    if (!TOKEN_NAME_PATTERN.test(name)) continue
    if (typeof value !== 'string' || UNSAFE_VALUE_PATTERN.test(value)) continue
    safe[name] = value
  }
  return safe
}

/**
 * Serializes `tokens` (already validated via {@linkcode sanitizeThemeTokens}) into a single
 * `:root{...}` rule — the exact string `SpacePageController.handleGet` hands to `renderToResponse`
 * as `themeStyle`. `undefined` when `tokens` is empty (either the resolver returned `{}`/nothing
 * safe survived sanitization), matching this package's own "no theme override for this request,
 * the static tokens apply as-is" contract — the caller never renders an empty `<style>` tag for it.
 */
export function serializeThemeStyle(tokens: Record<string, string>): string | undefined {
  const entries = Object.entries(sanitizeThemeTokens(tokens))
  if (entries.length === 0) return undefined
  return `:root{${entries.map(([name, value]) => `${name}:${value}`).join(';')}}`
}
