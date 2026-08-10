import { assert, assertEquals } from '@std/assert'
import { join } from '@std/path'
import { createSpaceDevEngine, type SsrModuleChangedEvent } from 'modules/bundler/dev-engine.ts'

const isRouteEntry = (id: string) => id.endsWith('/page.tsx') || id.endsWith('page.tsx')

/**
 * Polls `check` until it returns a truthy value or `timeoutMs` elapses — real file-watcher
 * propagation (`usePolling`, 100ms interval, per `createSpaceDevEngine`'s own doc) is
 * inherently async and not on a fixed schedule, so a fixed `sleep` would be either flaky (too
 * short) or needlessly slow (too long) depending on the machine running the test.
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
  throw new Error(`waitUntil: condition never became truthy within ${timeoutMs}ms`)
}

async function withTempProject(
  build: (root: string) => Promise<void>,
  run: (root: string) => Promise<void>,
): Promise<void> {
  const root = await Deno.makeTempDir()
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
        await Deno.writeTextFile(join(root, 'page.tsx'), `export const marker = 'v1'\n`)
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

          await Deno.writeTextFile(join(root, 'page.tsx'), `export const marker = 'v2'\n`)

          const event = await waitUntil(() => events.find((e) => e.changeType === 'update'))
          assert(event.affectedRoutes.some((route) => route.endsWith('page.tsx')))
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
        await Deno.writeTextFile(join(root, 'styles.css'), `.counter { color: red; }\n`)
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
          assertEquals(asset.contentType, 'application/javascript; charset=utf-8')
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
          const asset = await engine.transformClientAsset('/does-not-exist.css')
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
        await Deno.writeTextFile(join(root, 'broken.tsx'), `export default function( {\n`)
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
          assert(threw, 'transformClientAsset should reject for a real syntax error')
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
        await Deno.writeTextFile(join(root, 'styles.css'), `.marker { color: red; }\n`)
      },
      async (root) => {
        const engine = await createSpaceDevEngine({ root, isRouteEntry })
        try {
          const before = await engine.transformClientAsset('/styles.css?direct')
          assert(before?.code.includes('color: red'))

          await Deno.writeTextFile(join(root, 'styles.css'), `.marker { color: blue; }\n`)

          const after = await waitUntil(async () => {
            const asset = await engine.transformClientAsset('/styles.css?direct')
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
        await Deno.writeTextFile(join(root, 'page.tsx'), realPageFixture('Example'))
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
        await Deno.writeTextFile(join(root, 'page.tsx'), realPageFixture('Example'))
      },
      async (root) => {
        const engine = await createSpaceDevEngine({ root, isRouteEntry })
        try {
          const before = await engine.ssrLoadModule('/page.tsx')

          await Deno.writeTextFile(join(root, 'page.tsx'), realPageFixture('Example-Edited'))

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
        await Deno.writeTextFile(join(root, 'broken.tsx'), 'export default class {{{ broken')
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
        await Deno.writeTextFile(join(root, 'page.tsx'), realPageFixture('Example'))
        await Deno.writeTextFile(join(root, 'styles.css'), `.marker { color: red; }\n`)
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
        await Deno.writeTextFile(join(root, 'page.tsx'), reactSsrFixture('Hello-Cjs'))
      },
      async (root) => {
        const engine = await createSpaceDevEngine({ root, isRouteEntry })
        try {
          const mod = await engine.ssrLoadModule('/page.tsx')
          assert(typeof mod.html === 'string', String(mod.html))
          assert((mod.html as string).includes('Hello-Cjs'), mod.html as string)
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
    const root = await Deno.makeTempDir()
    try {
      await Deno.writeTextFile(
        join(root, 'deno.json'),
        JSON.stringify({
          imports: { react: 'npm:react@^19', 'react-dom': 'npm:react-dom@^19' },
          nodeModulesDir: 'auto',
        }),
      )
      const install = await new Deno.Command('deno', { args: ['install'], cwd: root }).output()
      assert(install.success, new TextDecoder().decode(install.stderr))

      await Deno.writeTextFile(join(root, 'page.tsx'), reactSsrFixture('Hello-NodeModules'))

      const engine = await createSpaceDevEngine({ root, isRouteEntry })
      try {
        const mod = await engine.ssrLoadModule('/page.tsx')
        assert(typeof mod.html === 'string', String(mod.html))
        assert((mod.html as string).includes('Hello-NodeModules'), mod.html as string)
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
  async () => {
    await withTempProject(
      async (root) => {
        await Deno.writeTextFile(join(root, 'page.tsx'), identityFixture('page'))
      },
      async (root) => {
        const engine = await createSpaceDevEngine({ root, isRouteEntry })
        try {
          const mod = await engine.ssrLoadModule('/page.tsx') as {
            result: { aEqualsB: boolean; aEqualsD: boolean; touchedBy: string[]; count: number }
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
  async () => {
    await withTempProject(
      async (root) => {
        await Deno.writeTextFile(join(root, 'page.tsx'), identityFixture('page-v1'))
      },
      async (root) => {
        const engine = await createSpaceDevEngine({ root, isRouteEntry })
        try {
          const before = await engine.ssrLoadModule('/page.tsx') as {
            result: { touchedBy: string[] }
          }
          assert(before.result.touchedBy.includes('page-v1'), JSON.stringify(before.result))

          await Deno.writeTextFile(join(root, 'page.tsx'), identityFixture('page-v2'))

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
          assert(after.result.touchedBy.includes('page-v2'), JSON.stringify(after.result))
          assert(after.result.touchedBy.includes('page-v1'), JSON.stringify(after.result))
          assert(after !== before, 'the page module itself must still be a fresh generation')
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
  'createSpaceDevEngine: transformClientAsset (client environment) resolves a bare specifier through the normal Vite pipeline, untouched by the SSR-only canonical resolver',
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
          // `canonicalBareSpecifierResolvePlugin` only ever activates for
          // `this.environment?.name === 'ssr'` — a real, successful client-side transform of a file
          // with a bare `react` import is direct evidence the `client` environment's own bare
          // specifier resolution (Vite's normal browser-bundle path, entirely unrelated to this
          // SSR-only fix) still runs unaffected.
          assert(asset.code.includes('react'), asset.code)
          assertEquals(asset.contentType, 'application/javascript; charset=utf-8')
        } finally {
          await engine.close()
        }
      },
    )
  },
)
