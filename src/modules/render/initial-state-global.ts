/**
 * The `<script>` global name that carries a server render's initial state to the client — a
 * single, predictable name instead of scattering several `window.__X__` globals across the
 * codebase. Its own file, with zero imports, so both the server-only
 * {@linkcode renderToResponse} and the client-safe {@linkcode readInitialState} can depend on it
 * without either one pulling the other's module graph along.
 *
 * @module
 */
export const INITIAL_STATE_GLOBAL = '__ZANIX_SPACE_STATE__'
