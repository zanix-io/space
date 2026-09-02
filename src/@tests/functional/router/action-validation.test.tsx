// Installs a renderer, exactly as a real app does: `@zanix/space` itself ships none, so a
// test that renders must import the entry point it is testing against.
import '../../../../mod-react.ts'
import { assert, assertEquals, assertRejects, assertStringIncludes } from '@std/assert'
import { BaseRTO, IsEmail, IsString } from '@zanix/validator'
import { bootstrapServers, webServerManager } from '@zanix/server'
import logger from '@zanix/logger'
import { Page, SpacePageController } from 'modules/router/mod.ts'
import { toValidatablePayload, validateActionBody } from 'modules/router/action-validation.ts'
import type { PageActionContext, PageContext } from 'typings/page.ts'

/**
 * `@Page({ action: { Body } })` end to end, over real HTTP against a real server.
 *
 * The decisive tests here are the ones a unit test could not make: that an invalid submission
 * comes back as the **re-rendered page** rather than JSON, and that it works with no JavaScript
 * anywhere in the loop. Nothing in this file runs a browser — a plain `fetch` posting
 * `application/x-www-form-urlencoded` is exactly what a `<form>` with scripting disabled sends,
 * so if these pass, the no-JS path works.
 *
 * The validation itself is `@zanix/validator`'s. Space's only job is connecting the RTO an app
 * declares to the `action` it wrote, which an app cannot do on its own (`@Page` wires `POST` to
 * the base class's `handlePost`, so there is no method on the subclass to decorate).
 *
 * @module
 */

console.error = () => {}

class CheckoutBody extends BaseRTO {
  @IsEmail({ expose: true })
  accessor email!: string

  @IsString({ expose: true })
  accessor note!: string
}

/** Renders the form, plus whatever errors and submitted values the context carried. */
function CheckoutView(
  { fieldErrors, submitted }: {
    fieldErrors?: Record<string, unknown>
    submitted?: Record<string, string>
  },
) {
  return (
    <form method='post'>
      {
        /* `fieldErrors` is `@zanix/validator`'s own formatted output, keyed by property — Space
          passes it through untouched, so a component reads exactly what the validator produced. */
      }
      {Object.entries(fieldErrors ?? {}).map(([property, entries]) => (
        <p key={property} data-error={property}>
          {`${property}: ${
            (entries as { constraints?: string[] }[])
              .flatMap((entry) => entry.constraints ?? [])
              .join(', ')
          }`}
        </p>
      ))}
      <input name='email' defaultValue={submitted?.email ?? ''} />
      <input name='note' defaultValue={submitted?.note ?? ''} />
      <button type='submit'>Pay</button>
    </form>
  )
}

@Page({ path: 'action-validation/checkout', headers: false, action: { Body: CheckoutBody } })
class CheckoutPage extends SpacePageController {
  public override loader = (ctx: PageContext) => ({
    fieldErrors: ctx.fieldErrors,
    submitted: ctx.submitted,
  })
  public override component = CheckoutView
  public override action = (ctx: PageActionContext) => {
    // `body`'s real static type is `unknown` (the base class fixes `PageActionContext`'s own
    // `Body` generic — see `SpacePageController.action`'s own doc) — narrowed here rather than on
    // the parameter itself, since narrowing the parameter type is contravariant-unsafe against the
    // base signature.
    const body = ctx.body as CheckoutBody | undefined
    return Promise.resolve(new Response(`paid:${body?.email}`))
  }
}
void CheckoutPage

/** Renders the request's own `cspNonce` as visible text — the only thing this view exists to
 * prove, for the 422 re-render regression test below. */
function NonceCheckoutView(
  { cspNonce, fieldErrors }: { cspNonce?: string; fieldErrors?: Record<string, unknown> },
) {
  return (
    <form method='post'>
      <p data-testid='nonce'>{cspNonce ?? 'MISSING'}</p>
      {Object.keys(fieldErrors ?? {}).length > 0 && <p data-testid='has-errors' />}
      <input name='email' />
      <button type='submit'>Pay</button>
    </form>
  )
}

// Deliberately NO `headers: false` here, unlike `CheckoutPage` below — this page needs the
// default, zero-config CSP (and the real nonce it generates) actually active, to reproduce and
// pin the ordering regression this test targets.
@Page({ path: 'action-validation/nonce-checkout', action: { Body: CheckoutBody } })
class NonceCheckoutPage extends SpacePageController {
  public override loader = (ctx: PageContext) => ({
    cspNonce: ctx.cspNonce,
    fieldErrors: ctx.fieldErrors,
  })
  public override component = NonceCheckoutView
  public override action = () => Promise.resolve(new Response('paid'))
}
void NonceCheckoutPage

/** A page with NO RTO — the unchanged path, which must keep behaving exactly as before. */
@Page({ path: 'action-validation/plain', headers: false })
class PlainPage extends SpacePageController {
  public override component = () => <p>plain</p>
  public override action = async (ctx: { formData: () => Promise<FormData> }) => {
    const form = await ctx.formData()
    return new Response(`got:${form.get('name')}`)
  }
}
void PlainPage

// A real side-effect counter, not just "the action's own response text is absent" — that alone
// wouldn't prove `action` was never CALLED for a GET, only that its return value isn't what a GET
// happens to render (`component`'s own output would look identical either way). Incrementing here
// is the only way to observe whether `@Page` genuinely wires `action` to POST exclusively, or
// whether it's also reachable — accidentally — through GET.
let actionInvocations = 0

@Page({ path: 'action-validation/post-only', headers: false })
class PostOnlyPage extends SpacePageController {
  public override component = () => <p>view</p>
  public override action = () => {
    actionInvocations++
    return Promise.resolve(new Response('acted'))
  }
}
void PostOnlyPage

const PORT = 20_701
const BASE = `http://localhost:${PORT}/action-validation`

function post(path: string, body: Record<string, string>): Promise<Response> {
  return fetch(`${BASE}/${path}`, {
    method: 'POST',
    // Exactly what a plain `<form method="post">` sends with no JavaScript involved.
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  })
}

Deno.test({
  name: '@Page({ action: { Body } }) end to end over real HTTP',
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async (t) => {
    const servers = await bootstrapServers({ ssr: { port: PORT } })
    try {
      await t.step(
        '1. a valid payload reaches the action already validated and typed',
        async () => {
          const response = await post('checkout', { email: 'ana@example.com', note: 'gift' })
          if (response.status !== 200) {
            logger.error(
              'DEBUG status',
              response.status,
              'body:',
              (await response.text()).slice(0, 400),
            )
            throw new Error('see DEBUG above')
          }
          assertEquals(response.status, 200)
          // `ctx.body.email` — read off the RTO instance, not off raw FormData.
          assertEquals(await response.text(), 'paid:ana@example.com')
        },
      )

      await t.step('2. an invalid payload responds 422, not 400 and not 200', async () => {
        const response = await post('checkout', { email: 'not-an-email', note: 'gift' })
        assertEquals(response.status, 422)
        await response.body?.cancel()
      })

      await t.step(
        '3. the 422 is the RE-RENDERED PAGE, not raw JSON — the whole point of the design',
        async () => {
          const response = await post('checkout', { email: 'not-an-email', note: 'gift' })
          const contentType = response.headers.get('content-type') ?? ''
          const html = await response.text()

          assertStringIncludes(contentType, 'text/html')
          assertStringIncludes(html, '<form method="post"')
          assertStringIncludes(html, 'type="submit"')
          // Not the JSON error body a pipe-registered RTO would have produced.
          assert(!html.trimStart().startsWith('{'), html.slice(0, 120))
        },
      )

      await t.step(
        '4. validation errors are present in that HTML, for the form to show',
        async () => {
          const html = await (await post('checkout', { email: 'not-an-email', note: 'gift' }))
            .text()
          assertStringIncludes(html, 'data-error="email"')
          // The validator's own message, not one Space invented.
          assertStringIncludes(html, 'email')
        },
      )

      await t.step(
        '5. submitted values survive the re-render — the user never retypes',
        async () => {
          const html = await (await post('checkout', {
            email: 'not-an-email',
            note: 'keep this text',
          })).text()
          assertStringIncludes(html, 'keep this text')
          assertStringIncludes(html, 'not-an-email')
        },
      )

      await t.step(
        '6. a page with NO action RTO is completely unchanged — formData() still works',
        async () => {
          const response = await post('plain', { name: 'Ana' })
          assertEquals(response.status, 200)
          assertEquals(await response.text(), 'got:Ana')
        },
      )

      await t.step('7. GET still renders the page normally, with no errors present', async () => {
        const response = await fetch(`${BASE}/checkout`)
        const html = await response.text()
        assertEquals(response.status, 200)
        assertStringIncludes(html, '<form method="post"')
        assert(!html.includes('data-error='), html)
      })

      await t.step(
        "8. action fires on POST, never on GET — @Page's own POST-only wiring, not just " +
          "GET rendering `component` instead of action's response (which alone wouldn't " +
          'prove action was never CALLED)',
        async () => {
          assertEquals(actionInvocations, 0)

          const getResponse = await fetch(`${BASE}/post-only`)
          assertEquals(getResponse.status, 200)
          assertStringIncludes(await getResponse.text(), 'view')
          assertEquals(actionInvocations, 0, 'GET must never invoke action')

          const postResponse = await fetch(`${BASE}/post-only`, { method: 'POST' })
          assertEquals(postResponse.status, 200)
          assertEquals(await postResponse.text(), 'acted')
          assertEquals(actionInvocations, 1, 'POST must invoke action exactly once')
        },
      )

      await t.step(
        "9. the 422 re-render (#renderInvalidAction) carries this request's own REAL CSP nonce " +
          'off ctx.cspNonce — not undefined. Real, confirmed regression this pins: ' +
          "#renderInvalidAction spreads actionCtx (built by handlePost's own toPageContext call, " +
          'itself snapshotted before cspGuard ever ran for this request) into a new pageCtx BEFORE ' +
          'resolvePageChrome runs for THIS render — the identical ordering bug handleGet had, in a ' +
          "genuinely separate code path, confirmed live: a Comet's own <style nonce> on a real " +
          "422 re-render carried no nonce attribute at all, even though handleGet's own fix for " +
          'the SAME field already existed by then.',
        async () => {
          const response = await post('nonce-checkout', { email: 'not-an-email' })
          assertEquals(response.status, 422)

          const cspHeader = response.headers.get('content-security-policy') ?? ''
          const [, headerNonce] = cspHeader.match(/'nonce-([^']+)'/) ?? []
          assert(headerNonce, cspHeader)

          const html = await response.text()
          assertStringIncludes(html, 'data-testid="has-errors"')
          assertStringIncludes(html, `<p data-testid="nonce">${headerNonce}</p>`)
        },
      )
    } finally {
      await webServerManager.stop(servers)
    }
  },
})

// -------------------------------------------------------------------------------------------
// toValidatablePayload: direct, HTTP-free unit coverage of the non-FormData branch — cheaper
// and just as real, since the function itself has no DOM/HTTP dependency.
// -------------------------------------------------------------------------------------------

Deno.test('toValidatablePayload: a plain object body passes through as-is', () => {
  assertEquals(toValidatablePayload({ email: 'ana@example.com' }), { email: 'ana@example.com' })
})

Deno.test('toValidatablePayload: null falls back to an empty record', () => {
  assertEquals(toValidatablePayload(null), {})
})

Deno.test('toValidatablePayload: undefined falls back to an empty record', () => {
  assertEquals(toValidatablePayload(undefined), {})
})

Deno.test(
  'toValidatablePayload: a primitive body (truthy but not an object) falls back to an empty ' +
    'record',
  () => {
    assertEquals(toValidatablePayload('not-an-object'), {})
    assertEquals(toValidatablePayload(42), {})
  },
)

// -------------------------------------------------------------------------------------------
// validateActionBody: the non-validation rethrow — `classValidation` throwing something that is
// NOT a validation failure (no `cause.properties`) must surface as a real error, not an empty
// form. Triggered with a genuinely misconfigured RTO, not a mocked `classValidation`.
// -------------------------------------------------------------------------------------------

class MisconfiguredBody extends BaseRTO {
  // A field initializer that throws unconditionally on construction — the realistic shape of a
  // misconfigured RTO: `classValidation` calls `new RTO(plainObject)` with no try/catch of its
  // own, so this plain error propagates straight out, carrying no `cause.properties` at all.
  @IsString({ expose: true })
  accessor broken: string = (() => {
    throw new TypeError('misconfigured RTO: broken field initializer')
  })()
}

Deno.test(
  'validateActionBody: rethrows whatever classValidation throws when it is NOT a validation ' +
    "failure — no cause.properties means it isn't a merely-invalid form",
  async () => {
    await assertRejects(
      () => validateActionBody(MisconfiguredBody, { broken: 'x' }, {}),
      TypeError,
      'misconfigured RTO',
    )
  },
)
