import { assert, assertRejects, assertStringIncludes } from '@std/assert'
import { build } from 'vite'
import deno from '@deno/vite-plugin'
import type { Rollup } from 'vite'
import { getTemporaryFolder } from '@zanix/helpers'
import { clientBarrelGuardPlugin } from 'modules/bundler/client-barrel-guard.ts'

/**
 * Real `vite build()` runs against the REAL client barrels — the guard's whole job is to fail a
 * real build walking a real module graph, so nothing here is mocked.
 *
 * The mismatch this guards against was confirmed in a real browser before the guard existed: a
 * Preact app importing `@zanix/space/client` serves correct SSR HTML, keeps all 26 comet
 * boundaries, renders every component's content — and no Comet is ever interactive, with zero
 * console errors, zero uncaught page errors and zero unhandled rejections. It is invisible at
 * runtime, which is exactly why it has to be caught at build time.
 *
 * Note on what the fixtures import: each entry imports the real barrel module by path
 * (`modules/client/mod.ts` / `mod-preact.ts`) rather than the `@zanix/space/client` specifier,
 * because these fixtures build from a temp dir outside this package's own import map. The guard
 * matches on the resolved hydrate module's path suffix, which is identical either way — that is
 * the point of matching a suffix rather than a specifier.
 *
 * @module
 */

console.error = () => {}

const REPO_ROOT = Deno.cwd()
const REACT_BARREL = `${REPO_ROOT}/src/modules/client/mod.ts`
const PREACT_BARREL = `${REPO_ROOT}/src/modules/client/mod-preact.ts`

async function withTempDir(run: (root: string) => Promise<void>): Promise<void> {
  const root = await Deno.makeTempDir({ dir: getTemporaryFolder(import.meta.url) })
  try {
    await run(root)
  } finally {
    await Deno.remove(root, { recursive: true })
  }
}

/**
 * Builds the one-file client entry `writeEntry` already wrote at `root`, with the guard
 * configured for `renderer`. Deliberately runs the guard ALONE rather than the whole
 * `spacePlugin()` — the renderer presets pull their own Babel/Prefresh machinery, which has
 * nothing to do with what is under test and would make a failure ambiguous.
 */
function runClientBuild(
  root: string,
  renderer: 'react' | 'preact',
): Promise<Rollup.RollupOutput> {
  return build({
    root,
    logLevel: 'silent',
    build: {
      write: false,
      minify: false,
      rollupOptions: { input: { 'client-entry': `${root}/entry.ts` } },
    },
    // `deno()` is what resolves this package's own JSR specifiers (`@zanix/logger`, ...) — the
    // real client build uses it for exactly the same reason. The guard is the only other plugin,
    // so a failure here can only come from the guard.
    plugins: [deno(), clientBarrelGuardPlugin(renderer)],
  }) as Promise<Rollup.RollupOutput>
}

async function writeEntry(root: string, barrelPath: string): Promise<void> {
  await Deno.writeTextFile(
    `${root}/entry.ts`,
    `import { hydrateComets } from '${barrelPath}'\nhydrateComets()\n`,
  )
}

Deno.test(
  '1. React app + React client barrel: builds successfully — the default pairing is untouched',
  async () => {
    await withTempDir(async (root) => {
      await writeEntry(root, REACT_BARREL)
      const result = await runClientBuild(root, 'react')
      assert(result.output.length > 0, 'expected real build output')
    })
  },
)

Deno.test(
  '2. Preact app + Preact client barrel: builds successfully — the correct Preact pairing',
  async () => {
    await withTempDir(async (root) => {
      await writeEntry(root, PREACT_BARREL)
      const result = await runClientBuild(root, 'preact')
      assert(result.output.length > 0, 'expected real build output')
    })
  },
)

Deno.test(
  '3. Preact app + REACT client barrel: fails the build with an actionable error — THE REGRESSION. ' +
    'This is the pairing the README used to lead a Preact app into, and the one measured inert ' +
    'in a real browser with no error of any kind',
  async () => {
    await withTempDir(async (root) => {
      await writeEntry(root, REACT_BARREL)
      const error = await assertRejects(() => runClientBuild(root, 'preact'))
      const message = String((error as Error).message)

      // Names the actual misconfiguration...
      assertStringIncludes(message, "renderer: 'preact'")
      assertStringIncludes(message, '@zanix/space/client')
      // ...tells the author exactly what to do instead...
      assertStringIncludes(message, 'Import `@zanix/space/client/preact` instead')
      // ...and explains WHY it is a build error rather than leaving it to be rediscovered.
      assertStringIncludes(message, 'no Comet is ever interactive')
      assertStringIncludes(message, 'hydrate-comets.ts')
    })
  },
)

Deno.test(
  '4. React app + PREACT client barrel: fails the build too — the mirror mismatch is equally ' +
    'possible (nothing stops an app from importing either specifier) and equally silent',
  async () => {
    await withTempDir(async (root) => {
      await writeEntry(root, PREACT_BARREL)
      const error = await assertRejects(() => runClientBuild(root, 'react'))
      const message = String((error as Error).message)

      assertStringIncludes(message, "renderer: 'react'")
      assertStringIncludes(message, '@zanix/space/client/preact')
      assertStringIncludes(message, 'Import `@zanix/space/client` instead')
      assertStringIncludes(message, 'hydrate-comets-preact.ts')
    })
  },
)

Deno.test(
  '5. no silent failure: the mismatch NEVER produces build output — it rejects, rather than ' +
    'emitting a bundle that would look fine and behave as if hydration were wired up',
  async () => {
    await withTempDir(async (root) => {
      await writeEntry(root, REACT_BARREL)
      let output: Rollup.RollupOutput | undefined
      try {
        output = await runClientBuild(root, 'preact')
      } catch {
        // expected
      }
      assert(output === undefined, 'a mismatched build must never yield output')
    })
  },
)

Deno.test(
  '6. a React build never pulls Preact in through this guard: the correct React pairing produces ' +
    'output containing no Preact runtime, so the guard costs a React app nothing in bundle terms',
  async () => {
    await withTempDir(async (root) => {
      await writeEntry(root, REACT_BARREL)
      const result = await runClientBuild(root, 'react')
      const code = result.output
        .map((chunk) => ('code' in chunk ? chunk.code : ''))
        .join('\n')

      // The guard itself contributes nothing to the bundle — it only ever throws or returns null.
      assert(!code.includes('zanix-space:client-barrel-guard'), 'guard must not emit into output')
      // And Preact's own hydrate module is genuinely absent from a React build's graph.
      assert(
        !code.includes('hydrate-comets-preact'),
        "a React app's client bundle must not reference Preact's hydrate module",
      )
    })
  },
)
