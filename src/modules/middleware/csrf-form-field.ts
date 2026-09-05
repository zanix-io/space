/**
 * The `<form>` field name a CSRF token round-trips through — shared, dependency-free source of
 * truth between `csrfGuard` (`csrf-guard.ts`, reads it back off a submission) and
 * `attachFormDraftPersistence` (`@zanix/space/comet`, needs it so a restored draft never
 * resurrects a stale CSRF value).
 *
 * Kept in its own module, deliberately apart from `csrf-guard.ts`, so a Comet importing this
 * constant never drags `csrfGuard`'s own dependency graph along with it: `csrf-guard.ts` imports
 * `@zanix/utils`'s `helpers` barrel (for `assertZnxCookieName`/`SESSION_COOKIE_ATTRIBUTES`), which
 * transitively reaches the full `logger` — and, through it, `WorkerManager`/`processor.ts` — none
 * of which a client bundle can resolve. This module has zero imports, so nothing reachable from it
 * can ever repeat that leak. Same reasoning as `comet-directive.ts`/`server-only-directive.ts`
 * living in their own modules instead of inside the file that first needed them.
 *
 * @module
 */

/** The form field name {@linkcode csrfGuard} reads a submitted token back from —
 * `attachFormDraftPersistence` (`@zanix/space/comet`) imports this directly so a restored draft
 * never resurrects a stale CSRF value, instead of re-declaring `'_csrf'` as a bare string. */
export const CSRF_FORM_FIELD = '_csrf'
