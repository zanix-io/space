import { classValidation } from '@zanix/validator'
import type { RtoTypes } from '@zanix/types'
import type { PageFieldErrors } from 'typings/page.ts'

/**
 * Connects a page's `action` to the ecosystem's own request validation.
 *
 * Space defines no validation rules, types or error formats — `@zanix/validator`'s
 * `classValidation` and the app's own `BaseRTO` classes own all three. This module is purely the
 * hookup an app cannot write for itself: `Page()` wires `POST` to the BASE class's `handlePost`,
 * so a subclass has no method to hang `@RequestValidation` on.
 *
 * ## Why this is not registered as a pipe
 *
 * `@zanix/server` would happily attach the same RTO via `Post(path, rto)`, and that is the shorter
 * seam — but a **pipe's throw escapes past the router's own catch**, up to `Deno.serve`'s
 * `onError`, which answers with JSON. A plain `<form>` submission would show the user raw JSON
 * instead of their form. Running the validator inline, from `handlePost`, is what keeps control in
 * the page so it can re-render itself with the errors instead.
 *
 * @module
 */

/**
 * Normalizes whatever `@zanix/server` parsed into something a validator can actually read.
 *
 * An `application/x-www-form-urlencoded` request — what a plain `<form method="post">` sends —
 * arrives as a real `FormData` instance, and a `FormData` has no enumerable own properties, so
 * handing it straight to `classValidation` would report every field as missing. JSON bodies
 * already arrive as plain objects and pass through untouched.
 *
 * `File` entries are skipped rather than coerced: `multipart/form-data` has no parsed body at the
 * server layer at all, so file uploads are outside what RTO validation can cover here — see
 * `PageOptions.action`'s own doc.
 *
 * @param body - Whatever `ctx.payload.body` holds for this request.
 * @returns A plain record of the submitted string fields.
 */
export function toValidatablePayload(body: unknown): Record<string, unknown> {
  if (body instanceof FormData) {
    const flattened: Record<string, unknown> = {}
    for (const [key, value] of body.entries()) {
      if (typeof value === 'string') flattened[key] = value
    }
    return flattened
  }
  return body && typeof body === 'object' ? body as Record<string, unknown> : {}
}

/** What {@linkcode validateActionBody} resolves to — never both populated meaningfully. */
export type ActionValidationResult = {
  /** The validated, transformed RTO instance. Only meaningful when `fieldErrors` is `undefined`. */
  validated: unknown
  /**
   * `@zanix/validator`'s own formatted failures, passed through untouched — `undefined` when the
   * payload validated. See {@linkcode PageFieldErrors}.
   */
  fieldErrors: PageFieldErrors | undefined
  /** The submitted values, flattened, for re-filling the form on a failed submission. */
  submitted: Record<string, string>
}

/**
 * Runs the page's declared RTO against the submitted body, capturing the failures rather than
 * letting them terminate the request.
 *
 * `classValidation` is called with NO `throwErrors` override, deliberately: its default throw
 * carries `@zanix/validator`'s own formatted failures on `cause.properties`, which is the exact
 * shape the rest of the ecosystem already surfaces. Catching it and passing that object straight
 * through means Space never reshapes, renames or re-words a single validation message — the format
 * stays owned by the validator, which is the whole point of not building a parallel API here.
 *
 * @param Body - The RTO class the page declared via `@Page({ action: { Body } })`.
 * @param rawBody - `ctx.payload.body`, unnormalized.
 * @param ctx - The handler context, forwarded to the validator as it expects.
 * @returns The validated instance, the validator's own field errors (or `undefined`), and the
 * flattened submitted values.
 * @throws Anything `classValidation` throws that is NOT a validation failure — a misconfigured RTO
 * has to surface as a real error, not as an empty form.
 */
export async function validateActionBody(
  Body: NonNullable<RtoTypes['Body']>,
  rawBody: unknown,
  ctx: unknown,
): Promise<ActionValidationResult> {
  const payload = toValidatablePayload(rawBody)

  const submitted: Record<string, string> = {}
  for (const [key, value] of Object.entries(payload)) {
    if (typeof value === 'string') submitted[key] = value
  }

  try {
    return {
      validated: await classValidation(Body, payload, { ctx }),
      fieldErrors: undefined,
      submitted,
    }
  } catch (error) {
    const properties = (error as { cause?: { properties?: PageFieldErrors } })?.cause?.properties
    // No `properties` means this was not a validation failure at all — rethrow rather than
    // pretending the form was merely invalid.
    if (!properties) throw error
    return { validated: undefined, fieldErrors: properties, submitted }
  }
}
