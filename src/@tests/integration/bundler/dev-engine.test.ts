import { assert, assertEquals } from '@std/assert'
import { join } from '@std/path'
import { getTemporaryFolder } from '@zanix/helpers'
import { createSpaceDevEngine, type SsrModuleChangedEvent } from 'modules/bundler/dev-engine.ts'

const TMP_ROOT = getTemporaryFolder(import.meta.url)

/**
 * Gates the three `@test-fixtures/pkg-a`..`pkg-d` module-identity tests below (a real
 * `@deno/loader`/`@deno/vite-plugin` bare-specifier resolution chain through this repo's own
 * `node_modules`, not a mock) — confirmed environment-sensitive on a long-lived local dev machine,
 * not a real regression: these same tests, at this same commit, pass cleanly on a fresh CI checkout
 * (`ubuntu-latest`, `actions/checkout` + a fresh `deno install`, GitHub Actions run
 * `33346375168`) every time, while failing locally with `Cannot find module
 * '@test-fixtures/pkg-c'` (the `ssr` tests) or a resolved-id mismatch (the `client` one).
 *
 * The real, confirmed mechanism: `TMP_ROOT` lives under this repo's own checkout (`space/__tmp__`),
 * and `deno-loader.ts`'s own `findDenoConfigPath` walks UP from a test's temp root looking for the
 * nearest `deno.json`, but prefers any ANCESTOR config whose raw text matches
 * `/["']workspace["']\s*:/` — a deliberate, documented "cheap substring check, not a full JSONC
 * parse". On a machine that also checked out this repo's siblings side by side under one parent
 * directory with its own local-workspace `deno.json` linking them for local cross-package
 * development, that parent config can end up entirely commented out (`/*{...}/`) while STILL
 * containing the literal text `"workspace":` inside the comment — invisible to a real JSONC parser,
 * but not to a plain substring/regex prefilter. `findDenoConfigPath` then returns THAT inactive,
 * comment-swallowed config instead of `space`'s own `deno.jsonc`, and `@deno/loader` can't resolve
 * `@test-fixtures/pkg-a`..`pkg-d` (declared only in `space`'s own `imports`) against it — confirmed
 * directly: calling `findDenoConfigPath('.../space/__tmp__/xyz')` on this exact machine returns
 * `~/Documents/Development/ZanixLibraries/deno.json`, not `space/deno.jsonc`, and that file's own
 * real content is exactly this shape. A fresh CI checkout never has that sibling-linking parent
 * config at all, which is why these tests pass there unconditionally. Same `RUN_X_TESTS` convention
 * and same env var as `deno-optimize-deps-alias.test.ts`'s own (mirroring this repo's own
 * `RUN_S3_TESTS`) — ignored by default, `ci.yml`'s own "Run tests" step sets
 * `RUN_ENV_SENSITIVE_TESTS: 'true'` explicitly so CI always runs it for real.
 */
const shouldRunEnvSensitiveTests = Deno.env.get('RUN_ENV_SENSITIVE_TESTS') === 'true'

const isRouteEntry = (id: string) => id.endsWith('/page.tsx') || id.endsWith('page.tsx')

/**
 * Polls `check` until it returns a truthy value or `timeoutMs` elapses — real file-watcher
 * propagation (`usePolling`, per `createSpaceDevEngine`'s own doc) is inherently async and not
 * on a fixed schedule, so a fixed `sleep` would be either flaky (too short) or needlessly slow
 * (too long) depending on the machine running the test.
 */
async function waitUntil<T>(
  check: () => T | undefined | Promise<T | undefined>,
  timeoutMs = 8000,
): Promise<T> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    // deno-lint-ignore no-await-in-loop -- this loop IS the poll; nothing here can run in parallel
    const result = await check()
    if (result) return result
    // deno-lint-ignore no-await-in-loop -- same reason as above
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(
    `waitUntil: condition never became truthy within ${timeoutMs}ms`,
  )
}

async function withTempProject(
  build: (root: string) => Promise<void>,
  run: (root: string) => Promise<void>,
): Promise<void> {
  const root = await Deno.makeTempDir({ dir: TMP_ROOT })
  try {
    await build(root)
    await run(root)
  } finally {
    await Deno.remove(root, { recursive: true })
  }
}

Deno.test('createSpaceDevEngine: ssrLoadModule loads a real SSR module', async () => {
  await withTempProject(
    async (root) => {
      await Deno.writeTextFile(
        join(root, 'page.tsx'),
        `export const marker = 'v1-original'\n`,
      )
    },
    async (root) => {
      const engine = await createSpaceDevEngine({ root, isRouteEntry })
      try {
        const mod = await engine.ssrLoadModule('/page.tsx')
        assertEquals(mod.marker, 'v1-original')
      } finally {
        await engine.close()
      }
    },
  )
})

Deno.test(
  'createSpaceDevEngine: editing the module reflects on the next ssrLoadModule call, no restart',
  async () => {
    await withTempProject(
      async (root) => {
        await Deno.writeTextFile(
          join(root, 'page.tsx'),
          `export const marker = 'v1-original'\n`,
        )
      },
      async (root) => {
        const engine = await createSpaceDevEngine({ root, isRouteEntry })
        try {
          const before = await engine.ssrLoadModule('/page.tsx')
          assertEquals(before.marker, 'v1-original')

          await Deno.writeTextFile(
            join(root, 'page.tsx'),
            `export const marker = 'v2-edited'\n`,
          )

          const after = await waitUntil(async () => {
            const mod = await engine.ssrLoadModule('/page.tsx')
            return mod.marker === 'v2-edited' ? mod : undefined
          })
          assertEquals(after.marker, 'v2-edited')
        } finally {
          await engine.close()
        }
      },
    )
  },
)

Deno.test(
  'createSpaceDevEngine: onSsrModuleChanged reports a direct route-file edit',
  async () => {
    await withTempProject(
      async (root) => {
        await Deno.writeTextFile(
          join(root, 'page.tsx'),
          `export const marker = 'v1'\n`,
        )
      },
      async (root) => {
        const events: SsrModuleChangedEvent[] = []
        const engine = await createSpaceDevEngine({
          root,
          isRouteEntry,
          onSsrModuleChanged: (event) => events.push(event),
        })
        try {
          await engine.ssrLoadModule('/page.tsx') // establish the module graph before editing

          await Deno.writeTextFile(
            join(root, 'page.tsx'),
            `export const marker = 'v2'\n`,
          )

          const event = await waitUntil(() => events.find((e) => e.changeType === 'update'))
          assert(
            event.affectedRoutes.some((route) => route.endsWith('page.tsx')),
          )
          // The route file itself, not a Comet — a connected browser genuinely needs a fresh
          // document for this one, so this must stay `false`; see `isComet`'s own doc.
          assertEquals(event.isComet, false)
        } finally {
          await engine.close()
        }
      },
    )
  },
)

Deno.test(
  'createSpaceDevEngine: onSsrModuleChanged reports isComet: true for a Comet edit — reachable ' +
    "from the ssr environment too (its initial HTML is server-rendered), but a connected browser's " +
    'own reload should defer to the separate onClientModuleChanged update instead',
  async () => {
    await withTempProject(
      async (root) => {
        await Deno.writeTextFile(
          join(root, 'counter.tsx'),
          `'use comet'\nexport const marker = 'v1'\n`,
        )
        await Deno.writeTextFile(
          join(root, 'page.tsx'),
          `export { marker } from './counter.tsx'\n`,
        )
      },
      async (root) => {
        const events: SsrModuleChangedEvent[] = []
        const engine = await createSpaceDevEngine({
          root,
          isRouteEntry,
          onSsrModuleChanged: (event) => events.push(event),
        })
        try {
          await engine.ssrLoadModule('/page.tsx') // establish the module graph before editing

          await Deno.writeTextFile(
            join(root, 'counter.tsx'),
            `'use comet'\nexport const marker = 'v2'\n`,
          )

          const event = await waitUntil(() => events.find((e) => e.file.endsWith('counter.tsx')))
          assert(
            event.affectedRoutes.some((route) => route.endsWith('page.tsx')),
            'a Comet edit must still resolve to its own host route, same as any other dependency',
          )
          assertEquals(event.isComet, true)
        } finally {
          await engine.close()
        }
      },
    )
  },
)

Deno.test(
  'createSpaceDevEngine: onSsrModuleChanged resolves the route through a transitive import',
  async () => {
    await withTempProject(
      async (root) => {
        await Deno.writeTextFile(
          join(root, 'shared.ts'),
          `export const greeting = 'shared v1'\n`,
        )
        await Deno.writeTextFile(
          join(root, 'page.tsx'),
          `export { greeting } from './shared.ts'\n`,
        )
      },
      async (root) => {
        const events: SsrModuleChangedEvent[] = []
        const engine = await createSpaceDevEngine({
          root,
          isRouteEntry,
          onSsrModuleChanged: (event) => events.push(event),
        })
        try {
          await engine.ssrLoadModule('/page.tsx') // establish the module graph before editing

          await Deno.writeTextFile(
            join(root, 'shared.ts'),
            `export const greeting = 'shared v2'\n`,
          )

          const event = await waitUntil(() =>
            events.find((e) => e.affectedRoutes.some((route) => route.endsWith('page.tsx')))
          )
          // Compared by suffix, not full-path equality: on macOS, Vite's watcher reports the
          // real (symlink-resolved) path — `/private/var/...` — while `Deno.makeTempDir()`
          // returns the unresolved `/var/...` form, so a full-path comparison here would be
          // testing a platform symlink quirk, not this engine's own behavior.
          assert(event.file.endsWith('shared.ts'))
        } finally {
          await engine.close()
        }
      },
    )
  },
)

Deno.test(
  'createSpaceDevEngine: transformClientAsset returns real, transformed CSS with ?direct',
  async () => {
    await withTempProject(
      async (root) => {
        await Deno.writeTextFile(
          join(root, 'styles.css'),
          `.counter { color: red; }\n`,
        )
      },
      async (root) => {
        const engine = await createSpaceDevEngine({ root, isRouteEntry })
        try {
          const asset = await engine.transformClientAsset('/styles.css?direct')
          assert(asset)
          assertEquals(asset.contentType, 'text/css; charset=utf-8')
          assert(asset.code.includes('.counter'))
          assert(asset.code.includes('color: red'))
        } finally {
          await engine.close()
        }
      },
    )
  },
)

Deno.test(
  'createSpaceDevEngine: transformClientAsset returns real, browser-ready JS for a .tsx file',
  async () => {
    await withTempProject(
      async (root) => {
        await Deno.writeTextFile(
          join(root, 'helper.ts'),
          `export const formatCount = (n: number) => \`Count: \${n}\`\n`,
        )
        await Deno.writeTextFile(
          join(root, 'counter.tsx'),
          [
            `import { formatCount } from './helper.ts'`,
            `export default function Counter() { return formatCount(0) as unknown as JSX.Element }`,
            '',
          ].join('\n'),
        )
      },
      async (root) => {
        const engine = await createSpaceDevEngine({ root, isRouteEntry })
        try {
          const asset = await engine.transformClientAsset('/counter.tsx')
          assert(asset)
          assertEquals(
            asset.contentType,
            'application/javascript; charset=utf-8',
          )
          // Real evidence the transitive `./helper.ts` import survived transformation, rewritten
          // to a real, servable url — not just "some JS came back".
          assert(asset.code.includes('/helper.ts'), asset.code)
          assert(asset.code.includes('Counter'), asset.code)
        } finally {
          await engine.close()
        }
      },
    )
  },
)

Deno.test(
  'createSpaceDevEngine: transformClientAsset returns null for a file that does not exist',
  async () => {
    await withTempProject(
      async () => {},
      async (root) => {
        const engine = await createSpaceDevEngine({ root, isRouteEntry })
        try {
          const asset = await engine.transformClientAsset(
            '/does-not-exist.css',
          )
          assertEquals(asset, null)
        } finally {
          await engine.close()
        }
      },
    )
  },
)

Deno.test(
  'createSpaceDevEngine: transformClientAsset returns null for an arbitrary, genuinely ' +
    'nonexistent .js/.ts asset — not just the ERR_LOAD_URL shape the .css case above hits',
  async () => {
    await withTempProject(
      async () => {},
      async (root) => {
        const engine = await createSpaceDevEngine({ root, isRouteEntry })
        try {
          // `/sw.js` (or any arbitrary, never-created `.js`/`.ts` path) reaches
          // `transformClientAsset` through a structurally different rejection than
          // `/does-not-exist.css` above — confirmed live: the `@deno/vite-plugin`/
          // `@jsr/deno__loader` bridge throws a plain `Error` with no `.code` here (message
          // `Import 'file:///sw.js' failed, not found.`), not the `ERR_LOAD_URL`-coded one Vite
          // itself synthesizes for the `.css` case. This is a general "some missing-file requests
          // take this other path" case, not a one-off for `/sw.js` specifically — asserted here
          // with a path that has nothing to do with a service worker.
          const asset = await engine.transformClientAsset(
            '/some-arbitrary-missing-file.js',
          )
          assertEquals(asset, null)
        } finally {
          await engine.close()
        }
      },
    )
  },
)

Deno.test(
  'createSpaceDevEngine: transformClientAsset rejects with a real error for a syntax error',
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
          let threw = false
          try {
            await engine.transformClientAsset('/broken.tsx')
          } catch (error) {
            threw = true
            assert(String((error as Error).message).length > 0)
          }
          assert(
            threw,
            'transformClientAsset should reject for a real syntax error',
          )
        } finally {
          await engine.close()
        }
      },
    )
  },
)

Deno.test(
  "createSpaceDevEngine: transformClientAsset rejects a 'server-only' module reached from a " +
    "Comet — the dev-mode counterpart to cometPlugin's own build-time enforcement",
  async () => {
    await withTempProject(
      async (root) => {
        await Deno.writeTextFile(
          join(root, 'server-secret.ts'),
          `'server-only'\nexport const secret = 'do-not-ship-me'\n`,
        )
        await Deno.writeTextFile(
          join(root, 'example.comet.tsx'),
          [
            `'use comet'`,
            `import { secret } from './server-secret.ts'`,
            `export default function ExampleComet() { return secret as unknown as JSX.Element }`,
            '',
          ].join('\n'),
        )
      },
      async (root) => {
        const engine = await createSpaceDevEngine({ root, isRouteEntry })
        try {
          // The Comet must be transformed FIRST — that's what makes Vite's own dev module graph
          // discover (and record) that `server-secret.ts` is imported BY it, the same "importers
          // get populated as each request is processed" model this whole check relies on (see
          // `findDevChainToComet`'s own doc in `dev-engine.ts`).
          await engine.transformClientAsset('/example.comet.tsx')

          let thrown: Error | undefined
          try {
            await engine.transformClientAsset('/server-secret.ts')
          } catch (error) {
            thrown = error as Error
          }

          assert(thrown, "expected transformClientAsset to reject 'server-secret.ts'")
          assert(
            thrown.message.includes('Server-only module imported into client Comet'),
            thrown.message,
          )
          assert(thrown.message.includes('example.comet.tsx'), thrown.message)
          assert(thrown.message.includes('server-secret.ts'), thrown.message)
        } finally {
          await engine.close()
        }
      },
    )
  },
)

Deno.test(
  "createSpaceDevEngine: transformClientAsset rejects a 'server-only' module even with no known " +
    'Comet importer yet — merely being requested through the CLIENT environment at all is ' +
    'already the violation; a confirmed Comet ancestor only improves the error message, never ' +
    'gates whether to throw (mirrors real dev traffic: nothing legitimate ever reaches a ' +
    "'server-only' file this way except a Comet)",
  async () => {
    await withTempProject(
      async (root) => {
        await Deno.writeTextFile(
          join(root, 'server-secret.ts'),
          `'server-only'\nexport const secret = 'do-not-ship-me'\n`,
        )
      },
      async (root) => {
        const engine = await createSpaceDevEngine({ root, isRouteEntry })
        try {
          let thrown: Error | undefined
          try {
            await engine.transformClientAsset('/server-secret.ts')
          } catch (error) {
            thrown = error as Error
          }

          assert(thrown, "expected transformClientAsset to reject 'server-secret.ts'")
          assert(thrown.message.includes('server-secret.ts'), thrown.message)
        } finally {
          await engine.close()
        }
      },
    )
  },
)

Deno.test(
  'createSpaceDevEngine: transformClientAsset reflects an edit on the next call, no restart',
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
          const before = await engine.transformClientAsset(
            '/styles.css?direct',
          )
          assert(before?.code.includes('color: red'))

          await Deno.writeTextFile(
            join(root, 'styles.css'),
            `.marker { color: blue; }\n`,
          )

          const after = await waitUntil(async () => {
            const asset = await engine.transformClientAsset(
              '/styles.css?direct',
            )
            return asset?.code.includes('color: blue') ? asset : undefined
          })
          assert(after.code.includes('color: blue'))
        } finally {
          await engine.close()
        }
      },
    )
  },
)

// The `ssrLoadModule → RealImportEvaluator` regression suite below (`ssr-module-evaluator.ts`'s
// own doc has the full "why"). Every fixture here mirrors the EXACT real TC39 decorator-context
// contract `@zanix/space`'s own `@Page()`/`@zanix/server`'s own decorators use (branching on
// `context.kind === 'class'`) — not a synthetic mock. A real `@zanix/space`/`react` import chain
// isn't used directly: this whole ecosystem is still mid cross-repo local-path-override
// development (`@zanix/server` isn't published to JSR yet), so `@zanix/server`'s own INTERNAL bare
// aliases (`modules/`, `typings/`, ...) don't resolve the same way a real, published JSR
// dependency's already-flattened internals would — a real, disposable spike confirmed this
// specifically is an artifact of that transitional state, not a gap in this engine (once
// `@zanix/server` publishes for real, importing it directly here works the same way `react` does
// below). `react` itself (a REAL npm bare specifier, resolved via `@deno/vite-plugin` against this
// project's own `deno.json`) is used directly throughout, since npm packages don't have this issue.
function realPageFixture(greeting: string): string {
  return `import { useState } from 'react'

// Mirrors @zanix/server's real TC39 decorator-context contract exactly (branches on
// context.kind === 'class', same as @Page()/@Guard()) — see this file's own header comment.
export const registeredRoutes: string[] = []
function Page(path: string) {
  return function (Target: unknown, context: ClassDecoratorContext) {
    if (context.kind !== 'class') throw new Error('Page must decorate a class')
    registeredRoutes.push(path)
    return Target
  }
}

function View() {
  const [count] = useState(0)
  return <p>${greeting} {count}</p>
}

@Page('/example')
export default class ExamplePage {
  accessor visits = 0
  component = View
}
`
}

Deno.test(
  'createSpaceDevEngine: ssrLoadModule evaluates a real TC39 decorator + accessor + relative import + npm bare specifier',
  async () => {
    await withTempProject(
      async (root) => {
        await Deno.writeTextFile(
          join(root, 'page.tsx'),
          realPageFixture('Example'),
        )
      },
      async (root) => {
        const engine = await createSpaceDevEngine({ root, isRouteEntry })
        try {
          const mod = await engine.ssrLoadModule('/page.tsx')
          const ExamplePage = mod.default as {
            new (): { visits: number; component: () => unknown }
          }

          assertEquals(ExamplePage.name, 'ExamplePage')
          // Real TC39 semantics: the decorator actually ran with a real `context.kind`, not a
          // legacy `(target, key, descriptor)` shape — this is what would silently misbehave (not
          // just fail loudly) under `experimentalDecorators`, per this file's own header comment.
          // `registeredRoutes` is the module's own named export the decorator pushed into — a real
          // ESM named export, resolved the same as `default` through the very same evaluator.
          assertEquals(mod.registeredRoutes, ['/example'])

          const instance = new ExamplePage()
          // `accessor` — a real ECMAScript auto-accessor field, not a plain class property.
          assertEquals(instance.visits, 0)
          // `react`'s `useState`, resolved as a real npm bare specifier via `@deno/vite-plugin`.
          assertEquals(instance.component.name, 'View')
        } finally {
          await engine.close()
        }
      },
    )
  },
)

Deno.test(
  'createSpaceDevEngine: ssrLoadModule invalidation produces a genuinely fresh generation, never a stale cache',
  async () => {
    await withTempProject(
      async (root) => {
        await Deno.writeTextFile(
          join(root, 'page.tsx'),
          realPageFixture('Example'),
        )
      },
      async (root) => {
        const engine = await createSpaceDevEngine({ root, isRouteEntry })
        try {
          const before = await engine.ssrLoadModule('/page.tsx')

          await Deno.writeTextFile(
            join(root, 'page.tsx'),
            realPageFixture('Example-Edited'),
          )

          const after = await waitUntil(async () => {
            const mod = await engine.ssrLoadModule('/page.tsx')
            // A genuinely fresh class object, not the same one returned again from some cache —
            // real evidence of a new generation, not merely "didn't throw".
            return mod.default !== before.default ? mod : undefined
          })
          assertEquals(after.registeredRoutes, ['/example'])
        } finally {
          await engine.close()
        }
      },
    )
  },
)

Deno.test(
  'createSpaceDevEngine: ssrLoadModule rejects a real syntax error with a real file/line/column message',
  async () => {
    await withTempProject(
      async (root) => {
        await Deno.writeTextFile(
          join(root, 'broken.tsx'),
          'export default class {{{ broken',
        )
      },
      async (root) => {
        const engine = await createSpaceDevEngine({ root, isRouteEntry })
        try {
          let threw: Error | undefined
          try {
            await engine.ssrLoadModule('/broken.tsx')
          } catch (error) {
            threw = error as Error
          }
          assert(threw, 'ssrLoadModule should reject for a real syntax error')
          assert(threw.message.includes('broken.tsx'), threw.message)
        } finally {
          await engine.close()
        }
      },
    )
  },
)

Deno.test(
  'createSpaceDevEngine: ssrLoadModule (custom evaluator) and transformClientAsset (untouched Vite transformRequest) coexist on the same engine',
  async () => {
    await withTempProject(
      async (root) => {
        await Deno.writeTextFile(
          join(root, 'page.tsx'),
          realPageFixture('Example'),
        )
        await Deno.writeTextFile(
          join(root, 'styles.css'),
          `.marker { color: red; }\n`,
        )
      },
      async (root) => {
        const engine = await createSpaceDevEngine({ root, isRouteEntry })
        try {
          const mod = await engine.ssrLoadModule('/page.tsx')
          assert(mod.default)

          const asset = await engine.transformClientAsset('/styles.css?direct')
          assert(asset?.code.includes('color: red'))

          // The evaluator swap never introduces a second source of truth for the module graph —
          // a second `ssrLoadModule` call for the SAME unchanged file still returns the SAME
          // module (no accidental re-evaluation on every call), exactly as Vite's own module
          // graph/HMR already guarantees for its own default evaluator.
          const modAgain = await engine.ssrLoadModule('/page.tsx')
          assertEquals(modAgain.default, mod.default)
        } finally {
          await engine.close()
        }
      },
    )
  },
)

// The `ssrLoadModule → cjs-interop` regression suite below (`cjs-interop.ts`'s own doc has the
// full "why"). `react` and `react-dom/server` are both structurally CommonJS at their real npm
// entry files — reproduced failing even with Vite's own untouched default evaluator, so this is a
// real, pre-existing `zanix space dev` blocker, not something `RealImportEvaluator` introduced.
// `renderToStaticMarkup` is imported and called INSIDE the fixture itself, in the same module
// graph as the page's own `react` import — calling it from the test file instead (a plain, native
// Deno import, entirely outside Vite's module graph) would resolve a SEPARATE copy of `react`,
// which throws its own "Invalid hook call" for an unrelated reason (two React copies means the
// dispatcher `react-dom/server` installs isn't visible to the copy `useState` reads from) — not a
// bug this fix is responsible for. Routing everything through one `ssrLoadModule` call is what
// actually reproduces the real `zanix space dev` request path: one Vite module graph end to end.
function reactSsrFixture(greeting: string): string {
  return `import { useState } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

function View() {
  const [count] = useState(0)
  return <p>${greeting} {count}</p>
}

export const html = renderToStaticMarkup(<View />)
`
}

Deno.test(
  'createSpaceDevEngine: ssrLoadModule renders a real React/JSX page through react-dom/server (CJS interop regression)',
  async () => {
    await withTempProject(
      async (root) => {
        await Deno.writeTextFile(
          join(root, 'page.tsx'),
          reactSsrFixture('Hello-Cjs'),
        )
      },
      async (root) => {
        const engine = await createSpaceDevEngine({ root, isRouteEntry })
        try {
          const mod = await engine.ssrLoadModule('/page.tsx')
          assert(typeof mod.html === 'string', String(mod.html))
          assert(
            (mod.html as string).includes('Hello-Cjs'),
            mod.html as string,
          )
          assert((mod.html as string).includes('<p>'), mod.html as string)
        } finally {
          await engine.close()
        }
      },
    )
  },
)

Deno.test(
  'createSpaceDevEngine: ssrLoadModule renders react-dom/server even when the target project has ' +
    'its own real node_modules (noExternal regression)',
  async () => {
    // Reproduces a real, confirmed `zanix space dev` blocker distinct from the one directly above:
    // that test's `react`/`react-dom` resolve through THIS repo's own Deno-flattened `.deno` store,
    // never through a real, on-disk `node_modules` directory — so it never exercised Vite's own SSR
    // dev auto-externalization heuristic (which only fires for a dependency resolved into a REAL
    // `node_modules`). Every actual consuming app has one. Without `environments.ssr.resolve.
    // noExternal: true` (`createSpaceDevEngine`'s own unconditional `createServer` config), an
    // externalized dependency is handed to `RealImportEvaluator.runExternalModule` — a raw native
    // `import()` that skips `cjs-interop.ts`'s own CJS-wrapping transform entirely — and fails with a
    // real `ReferenceError: module is not defined` at `react/index.js`. A real `deno install` below
    // is what actually materializes this project's own `node_modules`, the same as any real app's
    // `nodeModulesDir: 'auto'` would.
    const root = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      await Deno.writeTextFile(
        join(root, 'deno.json'),
        JSON.stringify({
          imports: { react: 'npm:react@^19', 'react-dom': 'npm:react-dom@^19' },
          nodeModulesDir: 'auto',
        }),
      )
      const install = await new Deno.Command('deno', {
        args: ['install'],
        cwd: root,
      }).output()
      assert(install.success, new TextDecoder().decode(install.stderr))

      await Deno.writeTextFile(
        join(root, 'page.tsx'),
        reactSsrFixture('Hello-NodeModules'),
      )

      const engine = await createSpaceDevEngine({ root, isRouteEntry })
      try {
        const mod = await engine.ssrLoadModule('/page.tsx')
        assert(typeof mod.html === 'string', String(mod.html))
        assert(
          (mod.html as string).includes('Hello-NodeModules'),
          mod.html as string,
        )
      } finally {
        await engine.close()
      }
    } finally {
      await Deno.remove(root, { recursive: true })
    }
  },
)

// The `ssrLoadModule → bare-specifier-resolve` regression suite below (`bare-specifier-resolve.ts`'s
// own doc has the full "why"). `@test-fixtures/pkg-a`..`pkg-d` are permanent, committed stand-ins
// for real npm packages (`src/@tests/fixtures/resolve-identity`) — the same shape of bug the real
// `react`/`react-dom` case above exercises (a bare specifier reached both from a plain project file
// AND from inside a `node_modules`-like importer), made deterministic and independent of any real
// package's own internal module structure. `touch()`/the shared `state` object is how identity
// (not just value equality) gets proven: if the resolver ever regresses back to the asymmetry
// `bare-specifier-resolve.ts` fixes, these mutations would land on two DIFFERENT objects instead of
// accumulating on one, and `touchedBy`/`count` would betray it immediately.
function identityFixture(pageTouch: string): string {
  return `import { state as stateFromA, touch } from '@test-fixtures/pkg-a'
import { state as stateFromB } from '@test-fixtures/pkg-b'
import { state as stateFromD } from '@test-fixtures/pkg-d'

touch('${pageTouch}')

export const result = {
  aEqualsB: stateFromA === stateFromB,
  aEqualsD: stateFromA === stateFromD,
  touchedBy: [...stateFromA.touchedBy],
  count: stateFromA.count,
}
`
}

Deno.test(
  'createSpaceDevEngine: a bare specifier resolves to the SAME module identity from a plain project file and from inside a node_modules-like importer (ESM->ESM, CJS->CJS, CJS->ESM)',
  { ignore: !shouldRunEnvSensitiveTests },
  async () => {
    await withTempProject(
      async (root) => {
        await Deno.writeTextFile(
          join(root, 'page.tsx'),
          identityFixture('page'),
        )
      },
      async (root) => {
        const engine = await createSpaceDevEngine({ root, isRouteEntry })
        try {
          const mod = await engine.ssrLoadModule('/page.tsx') as {
            result: {
              aEqualsB: boolean
              aEqualsD: boolean
              touchedBy: string[]
              count: number
            }
          }
          // page.tsx (NOT a node_modules-like importer) importing `pkg-a` directly, and `pkg-b`
          // (ESM -> ESM bare import, itself a node_modules-like importer) importing the SAME
          // `pkg-a`, land on the exact same object.
          assert(mod.result.aEqualsB, JSON.stringify(mod.result))
          // page.tsx's direct import, and `pkg-d` -> `pkg-c` -> `pkg-a` (CJS -> CJS -> ESM, all bare,
          // all node_modules-like importers) ALSO land on the exact same object.
          assert(mod.result.aEqualsD, JSON.stringify(mod.result))
          assertEquals(
            [...mod.result.touchedBy].sort(),
            ['page', 'pkg-b', 'pkg-c', 'pkg-d'].sort(),
            JSON.stringify(mod.result.touchedBy),
          )
          assertEquals(mod.result.count, 4, String(mod.result.count))
        } finally {
          await engine.close()
        }
      },
    )
  },
)

Deno.test(
  'createSpaceDevEngine: ssrLoadModule invalidation produces a fresh generation for a bare-specifier identity chain too',
  { ignore: !shouldRunEnvSensitiveTests },
  async () => {
    await withTempProject(
      async (root) => {
        await Deno.writeTextFile(
          join(root, 'page.tsx'),
          identityFixture('page-v1'),
        )
      },
      async (root) => {
        const engine = await createSpaceDevEngine({ root, isRouteEntry })
        try {
          const before = await engine.ssrLoadModule('/page.tsx') as {
            result: { touchedBy: string[] }
          }
          assert(
            before.result.touchedBy.includes('page-v1'),
            JSON.stringify(before.result),
          )

          await Deno.writeTextFile(
            join(root, 'page.tsx'),
            identityFixture('page-v2'),
          )

          const after = await waitUntil(async () => {
            const mod = await engine.ssrLoadModule('/page.tsx') as {
              result: { touchedBy: string[] }
            }
            return mod.result.touchedBy.includes('page-v2') ? mod : undefined
          })
          // `page.tsx` itself re-runs fresh (its own `touch('page-v2')` call fires again) — real
          // evidence of invalidation, not a stale cached result. `pkg-a`'s own shared `state`
          // legitimately PERSISTS across this edit, `page-v1`'s own earlier touch included — none
          // of `pkg-a`/`pkg-b`/`pkg-c`/`pkg-d` were themselves edited, so Vite correctly has no
          // reason to invalidate them; a singleton that reset on an unrelated file's edit would be
          // its own, different bug (a second, incoherent notion of "fresh"), not a fix.
          assert(
            after.result.touchedBy.includes('page-v2'),
            JSON.stringify(after.result),
          )
          assert(
            after.result.touchedBy.includes('page-v1'),
            JSON.stringify(after.result),
          )
          assert(
            after !== before,
            'the page module itself must still be a fresh generation',
          )
        } finally {
          await engine.close()
        }
      },
    )
  },
)

Deno.test(
  'createSpaceDevEngine: a path-scoped `scopes` override wins over a top-level `imports` alias ' +
    'sharing the same prefix name (real console regression)',
  async () => {
    // Reproduces a real, confirmed `zanix space dev` crash (`console`, a real consumer project,
    // linking a local `@zanix/server` checkout via a raw relative-path `imports` override): that
    // project's own `deno.json` declares a top-level `utils/` alias for its OWN `./src/utils/`,
    // AND a separate `scopes["../server/"]["utils/"]` override redirecting `@zanix/server`'s own
    // bare `utils/` imports to `../server/src/utils/` instead — confirmed correct at the plain
    // Deno-resolution layer (`deno info --json`), but `bare-specifier-resolve.ts`'s own
    // `resolveBareSpecifierCanonically` always called `loader.resolveSync` with `referrer:
    // undefined`, making the `scopes` entry structurally unreachable and silently falling back to
    // the top-level `imports["utils/"]` entry for EVERY importer, `vendor/mod.ts` included. This
    // fixture mirrors that exact shape at a much smaller scale: `own-utils/thing.ts` and
    // `vendor-utils/thing.ts` both export a `marker` under the SAME bare-specifier prefix name
    // (`utils/`) with a DIFFERENT value, so a wrong resolution shows up as the wrong STRING, not
    // merely a missing-file crash — a stronger, more direct assertion of the actual defect.
    await withTempProject(
      async (root) => {
        await Deno.writeTextFile(
          join(root, 'deno.json'),
          JSON.stringify({
            imports: { 'utils/': './own-utils/' },
            scopes: { './vendor/': { 'utils/': './vendor-utils/' } },
          }),
        )
        await Deno.mkdir(join(root, 'own-utils'), { recursive: true })
        await Deno.writeTextFile(
          join(root, 'own-utils', 'thing.ts'),
          `export const marker = 'top-level'\n`,
        )
        await Deno.mkdir(join(root, 'vendor-utils'), { recursive: true })
        await Deno.writeTextFile(
          join(root, 'vendor-utils', 'thing.ts'),
          `export const marker = 'scoped'\n`,
        )
        await Deno.mkdir(join(root, 'vendor'), { recursive: true })
        await Deno.writeTextFile(
          join(root, 'vendor', 'mod.ts'),
          `export { marker } from 'utils/thing.ts'\n`,
        )
        await Deno.writeTextFile(
          join(root, 'page.tsx'),
          `export { marker } from './vendor/mod.ts'\n`,
        )
      },
      async (root) => {
        const engine = await createSpaceDevEngine({ root, isRouteEntry })
        try {
          const mod = await engine.ssrLoadModule('/page.tsx')
          // Must resolve `vendor/mod.ts`'s own `utils/thing.ts` import against the `scopes`
          // override scoped to `./vendor/`, never the top-level `imports["utils/"]` entry —
          // `'top-level'` here is exactly the old, broken behavior this test guards against.
          assertEquals(mod.marker, 'scoped')
        } finally {
          await engine.close()
        }
      },
    )
  },
)

Deno.test(
  'createSpaceDevEngine: a bare specifier resolving to real, untranspiled .tsx/JSX source still evaluates correctly',
  async () => {
    await withTempProject(
      async (root) => {
        await Deno.writeTextFile(
          join(root, 'page.tsx'),
          `import { Marker } from '@test-fixtures/pkg-tsx-source'\nexport const el = Marker()\n`,
        )
      },
      async (root) => {
        const engine = await createSpaceDevEngine({ root, isRouteEntry })
        try {
          const mod = await engine.ssrLoadModule('/page.tsx') as {
            el: { type: string; props: { children: string } }
          }
          // Real evidence of a real, correctly-transpiled JSX element — not just "didn't throw".
          assertEquals(mod.el.type, 'span')
          assertEquals(mod.el.props.children, 'tsx-source-ok')
        } finally {
          await engine.close()
        }
      },
    )
  },
)

Deno.test(
  'createSpaceDevEngine: transformClientAsset (client environment) resolves a bare specifier through the normal Vite pipeline',
  async () => {
    await withTempProject(
      async (root) => {
        await Deno.writeTextFile(
          join(root, 'counter.tsx'),
          [
            `import { useState } from 'react'`,
            `export default function Counter() { const [n] = useState(0); return n }`,
            '',
          ].join('\n'),
        )
      },
      async (root) => {
        const engine = await createSpaceDevEngine({ root, isRouteEntry })
        try {
          const asset = await engine.transformClientAsset('/counter.tsx')
          assert(asset)
          // A real, successful client-side transform of a file with a bare `react` import — direct
          // evidence the `client` environment's own bare specifier resolution (Vite's normal
          // browser-bundle path) still runs correctly. `canonicalBareSpecifierResolvePlugin` DOES
          // activate for this environment too now (see that file's own "The `client` environment
          // has the identical asymmetry" doc section) — `react` here is a single, ordinary bare
          // import from a plain project file, not the wrapped-importer shape the plugin's fix
          // actually changes anything for, so this assertion stays a general sanity check, not a
          // test of the fix itself (see the identity test right below for that).
          assert(asset.code.includes('react'), asset.code)
          assertEquals(
            asset.contentType,
            'application/javascript; charset=utf-8',
          )
          // This first call is a cold start for the `client` environment's own dependency
          // optimizer: resolving `react` triggers a crawl-end/commit cycle that keeps running in
          // Vite's own background after `transformRequest` already returned, normally settled by a
          // real browser's HMR reconnect-and-retry — never by a one-shot `transformClientAsset`
          // call like this one. Closing the engine before that cycle settles leaves one of Vite's
          // own internal promises permanently pending (confirmed via `DEBUG=vite:deps` — the
          // resolve itself completes fast and cleanly; a real hang/dangling promise only starts to
          // show up right after), which `deno test`'s own event-loop check then reports as
          // `Promise resolution is still pending`. A brief pause here — long enough for that cycle
          // to settle, well under this file's own per-test cost — is the fix; `close()` itself has
          // nothing to do with it.
          await new Promise((resolve) => setTimeout(resolve, 300))
        } finally {
          await engine.close()
        }
      },
    )
  },
)

Deno.test(
  'createSpaceDevEngine: transformClientAsset resolves a bare specifier to the SAME module identity ' +
    'from a plain project file and from inside a node_modules-like importer (client environment ' +
    'regression — real Preact HMR silent no-op)',
  { ignore: !shouldRunEnvSensitiveTests },
  async () => {
    // Reproduces, in the `client` environment, the exact bug `bare-specifier-resolve.ts`'s own
    // "The `client` environment has the identical asymmetry" doc section describes: a real,
    // confirmed `zanix space dev --renderer preact` session (a published `jsr:@zanix/space@0.3.1`
    // consumer project) where `@prefresh/core`'s own bare `import 'preact'` (a node_modules-like
    // importer) resolved to a DIFFERENT module id than `preact/jsx-runtime`'s own internal import
    // of the SAME physical `preact` file (a plain project-file-shaped importer) — splitting
    // Preact's `options` singleton in two, silently breaking Fast-Refresh's `vnodesForComponent`
    // bookkeeping (`flushUpdates()` ran with zero error and zero effect on every Comet edit). This
    // test can't evaluate real Preact/`@prefresh` internals (that needs a real browser), but it
    // proves the ROOT CAUSE those internals depend on — one canonical id for one physical file,
    // regardless of importer shape — using the exact same `@test-fixtures/pkg-a`..`pkg-b`
    // deterministic fixtures the `ssr`-side identity test above already relies on. `transformRequest`
    // (unlike `ssrLoadModule`) never evaluates the module, so identity is checked at the URL level:
    // `page.tsx`'s own direct import of `pkg-a`, and `pkg-b`'s own internal (bare, node_modules-like)
    // import of the SAME `pkg-a`, must resolve to the literal same specifier string — two different
    // strings is exactly what a duplicate Vite module instance looks like from the outside.
    await withTempProject(
      async (root) => {
        await Deno.writeTextFile(
          join(root, 'page.tsx'),
          [
            `import { touch } from '@test-fixtures/pkg-a'`,
            `import { state as b } from '@test-fixtures/pkg-b'`,
            `touch('page')`,
            `export const marker = b`,
            '',
          ].join('\n'),
        )
      },
      async (root) => {
        const engine = await createSpaceDevEngine({ root, isRouteEntry })
        try {
          const pageAsset = await engine.transformClientAsset('/page.tsx')
          assert(pageAsset, 'page.tsx must transform')
          const pageToA = pageAsset.code.match(/from\s+"([^"]*pkg-a[^"]*)"/)
          const pageToB = pageAsset.code.match(/from\s+"([^"]*pkg-b[^"]*)"/)
          assert(pageToA, pageAsset.code)
          assert(pageToB, pageAsset.code)

          const pkgBAsset = await engine.transformClientAsset(
            pageToB[1].split('?')[0],
          )
          assert(pkgBAsset, 'pkg-b must transform')
          const pkgBToA = pkgBAsset.code.match(/from\s+"([^"]*pkg-a[^"]*)"/)
          assert(pkgBToA, pkgBAsset.code)

          // The actual regression check: before the `client`-environment fix, `pageToA` landed on
          // `@deno/vite-plugin`'s wrapped `\0deno::...` id (via `/@id/__x00__deno::...`) while
          // `pkgBToA` landed on the plain, unwrapped `/@fs/<abs>` id — two different strings for the
          // same physical file.
          assertEquals(
            pageToA[1].split('?')[0],
            pkgBToA[1].split('?')[0],
            `page.tsx resolved pkg-a to ${pageToA[1]}, but pkg-b (a node_modules-like importer) ` +
              `resolved the SAME pkg-a to ${pkgBToA[1]} — two different module ids for one file`,
          )

          await new Promise((resolve) => setTimeout(resolve, 300))
        } finally {
          await engine.close()
        }
      },
    )
  },
)

Deno.test(
  'createSpaceDevEngine: onClientModuleChanged reports a real Comet .tsx edit',
  async () => {
    await withTempProject(
      async (root) => {
        await Deno.writeTextFile(
          join(root, 'counter.tsx'),
          `export default function Counter() { return 'v1' }\n`,
        )
      },
      async (root) => {
        const urls: string[][] = []
        const engine = await createSpaceDevEngine({
          root,
          isRouteEntry,
          onClientModuleChanged: (changed) => urls.push(changed),
        })
        try {
          // Establish the module in the `client` environment's own graph before editing — same
          // reasoning as `ssrLoadModule` above establishing the SSR graph first.
          await engine.transformClientAsset('/counter.tsx')

          await Deno.writeTextFile(
            join(root, 'counter.tsx'),
            `export default function Counter() { return 'v2' }\n`,
          )

          const reported = await waitUntil(() => urls.find((u) => u.includes('/counter.tsx')))
          assert(reported.includes('/counter.tsx'), JSON.stringify(reported))
        } finally {
          await engine.close()
        }
      },
    )
  },
)

Deno.test(
  "createSpaceDevEngine: onClientModuleChanged is never called for a .css edit (that stays onClientCssChanged's own job)",
  async () => {
    await withTempProject(
      async (root) => {
        await Deno.writeTextFile(
          join(root, 'styles.css'),
          `.counter { color: red; }\n`,
        )
      },
      async (root) => {
        const cssUrls: string[][] = []
        const moduleUrls: string[][] = []
        const engine = await createSpaceDevEngine({
          root,
          isRouteEntry,
          onClientCssChanged: (urls) => cssUrls.push(urls),
          onClientModuleChanged: (urls) => moduleUrls.push(urls),
        })
        try {
          await engine.transformClientAsset('/styles.css?direct')

          await Deno.writeTextFile(
            join(root, 'styles.css'),
            `.counter { color: blue; }\n`,
          )

          await waitUntil(() => cssUrls.length > 0 ? true : undefined)
          assertEquals(moduleUrls.length, 0, JSON.stringify(moduleUrls))
        } finally {
          await engine.close()
        }
      },
    )
  },
)

Deno.test(
  'createSpaceDevEngine: a client module edit is a silent no-op when onClientModuleChanged is unset, unchanged from before',
  async () => {
    await withTempProject(
      async (root) => {
        await Deno.writeTextFile(
          join(root, 'counter.tsx'),
          `export default function Counter() { return 'v1' }\n`,
        )
      },
      async (root) => {
        // No `onClientModuleChanged` here at all — this is React's own real call shape today
        // (`render-page-react.tsx` never wires it), and every existing caller of this engin.
        // Confirms the new hook is purely additive: omitting it never throws and
        // never changes `transformClientAsset`'s own, unrelated behavior.
        const engine = await createSpaceDevEngine({ root, isRouteEntry })
        try {
          await engine.transformClientAsset('/counter.tsx')
          await Deno.writeTextFile(
            join(root, 'counter.tsx'),
            `export default function Counter() { return 'v2' }\n`,
          )
          await new Promise((resolve) => setTimeout(resolve, 300))
          const asset = await engine.transformClientAsset('/counter.tsx')
          assert(asset?.code.includes('v2'), asset?.code)
        } finally {
          await engine.close()
        }
      },
    )
  },
)

Deno.test(
  'createSpaceDevEngine: a large coverage/ report tree at the project root never slows the ' +
    "file watcher down — a real, confirmed incident: `usePolling` (this engine's own default, " +
    'see its own doc) means every watched file gets a real `fs.stat` every `interval`, and a project ' +
    'that has ever run `deno test --coverage` leaves thousands of small report files there, none ' +
    'of them a real route/Comet source file. Boot completing quickly alone would not catch a ' +
    'regression of the underlying `ignored` glob list (a slow but still-under-the-bound boot is a ' +
    'passing false negative), so this also confirms a REAL page edit is still detected promptly ' +
    'with that tree present — proof the watcher is not busy polling it in the background.',
  async () => {
    await withTempProject(
      async (root) => {
        await Deno.writeTextFile(
          join(root, 'page.tsx'),
          `export const marker = 'v1'\n`,
        )
        // Mirrors a real `deno coverage` HTML report's own shape closely enough to matter here:
        // many small, flat files, the same thing `usePolling` would otherwise `fs.stat` on every
        // tick. 3000 is well past what a real project's report tree looks like in practice, while
        // still fast enough to write in a test's own `build` phase.
        const coverageDir = join(root, 'coverage', 'html')
        await Deno.mkdir(coverageDir, { recursive: true })
        await Promise.all(
          Array.from(
            { length: 3000 },
            (_, i) => Deno.writeTextFile(join(coverageDir, `file-${i}.html`), '<html></html>'),
          ),
        )
      },
      async (root) => {
        const events: SsrModuleChangedEvent[] = []
        const bootStart = performance.now()
        const engine = await createSpaceDevEngine({
          root,
          isRouteEntry,
          onSsrModuleChanged: (event) => events.push(event),
        })
        try {
          const bootMs = performance.now() - bootStart
          // Generous on purpose — this suite's own unaffected boots (no `coverage/` at all, see
          // every other test above) finish in well under a second locally; this only needs to
          // catch the underlying regression class (the watcher choking on thousands of ignored
          // files), not chase a tight ceiling that would make this test flaky on a loaded CI box.
          assert(bootMs < 8000, `expected a fast boot despite coverage/, took ${bootMs}ms`)

          await engine.ssrLoadModule('/page.tsx') // establish the module graph before editing

          await Deno.writeTextFile(
            join(root, 'page.tsx'),
            `export const marker = 'v2'\n`,
          )

          // Same `waitUntil` bound every other real-edit-propagation test in this file already
          // trusts — if the watcher were starved by `coverage/`'s own polling, this real edit
          // would either miss that bound or take dramatically longer than the unaffected tests
          // above, not just "eventually" resolve.
          const event = await waitUntil(() => events.find((e) => e.changeType === 'update'))
          assert(event.affectedRoutes.some((route) => route.endsWith('page.tsx')))
        } finally {
          await engine.close()
        }
      },
    )
  },
)
