/**
 * Typed, read-only accessors over a page's own `fieldErrors`/`submitted` — the two
 * {@linkcode PageContext} fields a failed `action` re-render carries (see
 * {@linkcode PageFieldErrors}'s own doc for why Space never defines their shape as a public type).
 *
 * Reading a single field's message or resubmitted value out of either today means hand-walking
 * `@zanix/validator`'s own opaque format — brittle by hand: `@zanix/space-ui`'s own `Field`
 * component (this package's own downstream consumer) documents, as its recommended extraction, code
 * that reads `.constraints` straight off `fieldErrors[key]` — which is the ARRAY
 * `errorValidationFormatting` actually produces for a leaf field, not an object with a `.constraints`
 * property, so that recommended shape silently returns nothing. These two functions are that walk,
 * written and tested once against the validator's real output, so no caller repeats it by hand or
 * inherits the same mistake.
 *
 * Deliberately narrow: read-only accessors for ONE field at a time, nothing else. No form state, no
 * submission lifecycle, no client-side binding, no action-result protocol — see
 * `PageContext.fieldErrors`'s own doc for why none of that exists or is planned. A page's `loader`
 * still owns deciding what to do with the result; these just make getting to it typed and correct.
 *
 * @module
 */
import type { PageFieldErrors } from 'typings/page.ts'

/** One leaf failure group, exactly as `@zanix/validator`'s `errorValidationFormatting` produces it
 * for a plain (non-nested-RTO) field — `fieldErrors[key]` is an ARRAY of these. */
type ValidatorLeafEntry = { constraints?: string[] }
/** What `fieldErrors[key]` is instead, when `key` is itself a nested RTO. */
type ValidatorNestedEntry = { message?: string }

/**
 * The first human-readable error message for one field, out of a page's own `fieldErrors`.
 *
 * Handles both shapes `@zanix/validator` produces: a leaf field's `fieldErrors[key]` is an array of
 * `{ constraints }` groups (this returns the first group's first constraint); a nested-RTO field's
 * is a single `{ message, properties }` object (this returns `message`). Deliberately fail-soft —
 * `undefined` for a field with no failure, and also for an entry shaped like neither, rather than
 * throwing: `fieldErrors[key]` itself is always there, untouched, for a caller that needs more than
 * this covers (every constraint for a field, not just the first; a nested field's own `properties`).
 *
 * @template Body - The page's own action `Body` RTO — narrows `key` to that RTO's real property
 * names. Pass it explicitly (`getActionFieldError<CheckoutBody>(...)`); nothing at this call site can
 * infer it, the same reason `mockPageContext<Params>()` takes its own type argument explicitly.
 * @param fieldErrors - `ctx.fieldErrors`, exactly as a page's `loader` receives it on a
 * failed-action re-render. `undefined` on every GET and on any successful action — this returns
 * `undefined` right back in that case.
 * @param key - The `Body` property to read.
 * @returns The field's first error message, or `undefined`.
 *
 * @example
 * ```tsx
 * class CheckoutBody extends BaseRTO {
 *   \@IsEmail({ expose: true })
 *   accessor email!: string
 * }
 *
 * \@Page({ path: 'checkout', action: { Body: CheckoutBody } })
 * export default class CheckoutPage extends SpacePageController {
 *   loader = (ctx) => ({
 *     csrfToken: ctx.csrfToken,
 *     email: getActionFieldValue<CheckoutBody>(ctx.submitted, 'email'),
 *     emailError: getActionFieldError<CheckoutBody>(ctx.fieldErrors, 'email'),
 *   })
 *   component = CheckoutView
 *   action = async (ctx) => { ctx.body.email; return new Response('ok') }
 * }
 * ```
 */
export function getActionFieldError<Body extends object>(
  fieldErrors: PageFieldErrors | undefined,
  key: keyof Body & string,
): string | undefined {
  const entry = fieldErrors?.[key]
  if (Array.isArray(entry)) {
    const [first] = entry as ValidatorLeafEntry[]
    return first?.constraints?.[0]
  }
  if (entry && typeof entry === 'object') {
    return (entry as ValidatorNestedEntry).message
  }
  return undefined
}

/**
 * The resubmitted value for one field, out of a page's own `submitted` — for re-filling a form
 * input after a failed submission rather than clearing it.
 *
 * @template Body - See {@linkcode getActionFieldError}.
 * @param submitted - `ctx.submitted`, exactly as a page's `loader` receives it on a failed-action
 * re-render. `undefined` on every GET and on any successful action.
 * @param key - The `Body` property to read.
 * @param fallback - Returned when the field was never submitted (a fresh GET) or is absent from
 * what was submitted. Defaults to `''`, not `undefined` — an input's own `value` prop flipping
 * between `undefined` and a string is React's own uncontrolled-to-controlled warning; this keeps a
 * bound input controlled from the very first render.
 * @returns The submitted value, or `fallback`.
 *
 * @example See {@linkcode getActionFieldError}'s own example.
 */
export function getActionFieldValue<Body extends object>(
  submitted: Record<string, string> | undefined,
  key: keyof Body & string,
  fallback = '',
): string {
  return submitted?.[key] ?? fallback
}
