/**
 * The framework's own built-in CSS — currently just the `display: contents` rule every Comet
 * boundary and Orbit outlet div relies on. Emitted once, unconditionally, as a real, nonce'd
 * `<style>` tag in every full-document response (see `render-to-response.tsx`'s and
 * `head-markup.ts`'s own callers) — NEVER as an inline `style` attribute on those elements
 * themselves.
 *
 * This exists because a nonce does not cover an inline `style="..."` ATTRIBUTE at all — only a
 * `<style>` element or a `<link rel="stylesheet">` — confirmed against a real, strict
 * `style-src 'self' 'nonce-...'` policy (`page-security.ts`'s own default, no `'unsafe-inline'`):
 * a real browser silently drops `style={{ display: 'contents' }}` there, and the CSP violation
 * message itself even says so ("hashes do not apply to ... style attributes ... unless
 * 'unsafe-hashes'"). A dropped `display: contents` isn't cosmetic — the wrapper reverts to its
 * default `display: block`, exactly the extra box between a boundary and its real children this
 * rule exists to avoid inserting into a parent's own `display: grid`/`flex` layout.
 *
 * A single shared stylesheet rule sidesteps this entirely: it's the SAME instance regardless of
 * how many Comets/outlets a page has, and a real CSS rule is naturally LOWER-specificity than an
 * inline style ever was — more overridable by an app's own more specific selector, not less.
 *
 * @module
 */
import { COMET_ID_ATTR } from '../comets/marker.ts'
import { ORBIT_OUTLET_ATTR } from '../router/orbit-protocol.ts'

/** The complete built-in CSS text — one rule, both attributes, `display: contents`. */
export const BUILTIN_CSS = `[${COMET_ID_ATTR}],[${ORBIT_OUTLET_ATTR}]{display:contents}`
