// deno-lint-ignore-file no-explicit-any
import { assertEquals, assertRejects } from '@std/assert'
import { createReloader } from 'modules/comets/reloader.ts'
import type { ReloadDescriptor } from 'modules/comets/reloader.ts'

const originalFetch = globalThis.fetch

/** Plain manual fetch mock — no `@std/testing/mock` dependency in this repo's import map. */
function mockFetchOnce(response: Response) {
  const calls: [string, any][] = []
  globalThis.fetch = ((url: string, opts: any) => {
    calls.push([url, opts])
    return Promise.resolve(response)
  }) as unknown as typeof fetch
  return calls
}

Deno.test('createReloader: issues a request with exactly the given endpoint/method/headers/body', async () => {
  const descriptor: ReloadDescriptor = {
    endpoint: 'https://api.example.com/graphql',
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: 'query { countries { code } }' }),
  }
  const calls = mockFetchOnce(
    new Response(JSON.stringify({ data: { countries: [] } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  )

  const reload = createReloader<{ data: { countries: unknown[] } }>(descriptor)
  const result = await reload()

  assertEquals(result, { data: { countries: [] } })
  assertEquals(calls.length, 1)
  const [url, opts] = calls[0]
  assertEquals(url, descriptor.endpoint)
  assertEquals(opts.method, descriptor.method)
  assertEquals(opts.headers, descriptor.headers)
  assertEquals(opts.body, descriptor.body)

  globalThis.fetch = originalFetch
})

Deno.test('createReloader: a plain REST-shaped response (no errors field) passes through untouched', async () => {
  const descriptor: ReloadDescriptor = {
    endpoint: 'https://api.example.com/users',
    method: 'GET',
    headers: {},
  }
  mockFetchOnce(
    new Response(JSON.stringify([{ id: 1, name: 'Alice' }]), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  )

  const reload = createReloader<{ id: number; name: string }[]>(descriptor)
  const result = await reload()

  assertEquals(result, [{ id: 1, name: 'Alice' }])

  globalThis.fetch = originalFetch
})

Deno.test('createReloader: throws on a GraphQL-shaped 200 OK response carrying an errors array', async () => {
  const descriptor: ReloadDescriptor = {
    endpoint: 'https://api.example.com/graphql',
    method: 'POST',
    headers: {},
    body: '{}',
  }
  mockFetchOnce(
    new Response(JSON.stringify({ errors: [{ message: 'Field does not exist' }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  )

  const reload = createReloader(descriptor)
  await assertRejects(() => reload(), Error, 'Field does not exist')

  globalThis.fetch = originalFetch
})

Deno.test('createReloader: a REST response that happens to have its own unrelated "data" field is never unwrapped/mistaken for GraphQL', async () => {
  const descriptor: ReloadDescriptor = {
    endpoint: 'https://api.example.com/paginated-users',
    method: 'GET',
    headers: {},
  }
  mockFetchOnce(
    new Response(JSON.stringify({ data: [{ id: 1 }], meta: { page: 1 } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  )

  const reload = createReloader<{ data: { id: number }[]; meta: { page: number } }>(descriptor)
  const result = await reload()

  // Returned exactly as the API sent it — no guessed `.data` unwrapping.
  assertEquals(result, { data: [{ id: 1 }], meta: { page: 1 } })

  globalThis.fetch = originalFetch
})

Deno.test('createReloader: throws on a non-OK HTTP status', async () => {
  const descriptor: ReloadDescriptor = {
    endpoint: 'https://api.example.com/users',
    method: 'GET',
    headers: {},
  }
  mockFetchOnce(new Response('Not Found', { status: 404 }))

  const reload = createReloader(descriptor)
  await assertRejects(() => reload(), Error, 'Request failed with status 404')

  globalThis.fetch = originalFetch
})

Deno.test("createReloader: rejects on failure — no onError swallowing, the caller's own try/catch is the only error path", async () => {
  const descriptor: ReloadDescriptor = {
    endpoint: 'https://api.example.com/users',
    method: 'GET',
    headers: {},
  }
  mockFetchOnce(new Response('Server error', { status: 500 }))

  const reload = createReloader(descriptor)
  const error = await assertRejects(() => reload(), Error, 'Request failed with status 500')
  assertEquals(error instanceof Error, true)

  globalThis.fetch = originalFetch
})

Deno.test('createReloader: the module has no actual import from @zanix/server — only mentions it in prose', async () => {
  const source = await Deno.readTextFile(
    new URL('../../../modules/comets/reloader.ts', import.meta.url),
  )
  const importLines = source.split('\n').filter((line) => line.trimStart().startsWith('import '))
  assertEquals(importLines.some((line) => line.includes('@zanix/server')), false)
})
