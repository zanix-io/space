import { assert, assertEquals } from '@std/assert'
import { join } from '@std/path'
import { getTemporaryFolder } from '@zanix/helpers'
// Imported from the specific file, not the `modules/bundler/mod.ts` barrel — that barrel also
// re-exports `cssPlugin`, whose own top-level `@tailwindcss/vite` import eagerly pulls in
// `lightningcss` and crashes under Deno's npm resolution even when nothing calls it (the exact
// same pitfall `dev-engine.test.ts` already documents and avoids).
import { createSpaceDevEngine } from 'modules/bundler/dev-engine.ts'
import { createDevAssetHandler } from 'modules/dev/mod.ts'

const isRouteEntry = (id: string) => id.endsWith('page.tsx')

async function withTempProject(
  build: (root: string) => Promise<void>,
  run: (root: string) => Promise<void>,
): Promise<void> {
  const root = await Deno.makeTempDir({ dir: getTemporaryFolder(import.meta.url) })
  try {
    await build(root)
    await run(root)
  } finally {
    await Deno.remove(root, { recursive: true })
  }
}

Deno.test(
  'createDevAssetHandler: returns null for a request that is not a dev-asset request at all',
  async () => {
    await withTempProject(async () => {}, async (root) => {
      const engine = await createSpaceDevEngine({ root, isRouteEntry })
      try {
        const handler = createDevAssetHandler(engine)
        const res = await handler(new Request('http://localhost/products/1'))
        assertEquals(res, null)
      } finally {
        await engine.close()
      }
    })
  },
)

Deno.test(
  'createDevAssetHandler: a real CSS request gets a real 200 with transformed CSS',
  async () => {
    await withTempProject(
      async (root) => {
        await Deno.writeTextFile(
          join(root, 'styles.css'),
          `.marker { color: red; }\n`,
        )
      },
      async (root) => {
        const engine = await createSpaceDevEngine({ root, isRouteEntry })
        try {
          const handler = createDevAssetHandler(engine)
          const res = await handler(
            new Request('http://localhost/styles.css?direct'),
          )
          assert(res)
          assertEquals(res.status, 200)
          assertEquals(
            res.headers.get('content-type'),
            'text/css; charset=utf-8',
          )
          const body = await res.text()
          assert(body.includes('color: red'), body)
        } finally {
          await engine.close()
        }
      },
    )
  },
)

Deno.test(
  'createDevAssetHandler: a missing asset file gets a real 404, not an unhandled rejection',
  async () => {
    await withTempProject(async () => {}, async (root) => {
      const engine = await createSpaceDevEngine({ root, isRouteEntry })
      try {
        const handler = createDevAssetHandler(engine)
        const res = await handler(
          new Request('http://localhost/does-not-exist.css'),
        )
        assert(res)
        assertEquals(res.status, 404)
      } finally {
        await engine.close()
      }
    })
  },
)

Deno.test(
  'createDevAssetHandler: a real syntax error gets a real 500 with the error message',
  async () => {
    await withTempProject(
      async (root) => {
        await Deno.writeTextFile(
          join(root, 'broken.tsx'),
          `export default function( {\n`,
        )
      },
      async (root) => {
        const engine = await createSpaceDevEngine({ root, isRouteEntry })
        try {
          const handler = createDevAssetHandler(engine)
          const res = await handler(new Request('http://localhost/broken.tsx'))
          assert(res)
          assertEquals(res.status, 500)
          const body = await res.text()
          assert(body.length > 0)
        } finally {
          await engine.close()
        }
      },
    )
  },
)
