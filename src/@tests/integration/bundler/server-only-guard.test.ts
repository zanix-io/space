import { assert, assertRejects, assertStringIncludes } from '@std/assert'
import { build } from 'vite'
import type { Rollup } from 'vite'
import { getTemporaryFolder } from '@zanix/helpers'
import { cometPlugin } from 'modules/bundler/comet-plugin.ts'
import { buildSpaceClient } from 'modules/bundler/build-client.ts'
import { setActiveRenderer } from 'modules/router/active-renderer.ts'

/**
 * Real `vite build()` runs, exactly like `comet-plugin.test.ts`'s own — the guard's entire job
 * (walking the REAL Rollup module graph and failing a REAL build) can only be proven against an
 * actual bundler run. `renderer:` is never a build option this plugin reads at all (see
 * `comet-plugin.ts`'s own doc — the guard lives entirely in the bundler layer, before either
 * renderer is involved), so `setActiveRenderer` in the parity test below only proves what it needs
 * to: that the SAME plugin, run in an app configured for each renderer, behaves identically — not
 * that the plugin itself branches on renderer (it doesn't, by construction).
 */

async function withTempDir(run: (root: string) => Promise<void>): Promise<void> {
  const root = await Deno.makeTempDir({ dir: getTemporaryFolder(import.meta.url) })
  try {
    await run(root)
  } finally {
    await Deno.remove(root, { recursive: true })
  }
}

function runBuild(root: string, input: Record<string, string>): Promise<Rollup.RollupOutput> {
  return build({
    root,
    logLevel: 'silent',
    build: { write: false, minify: false, rollupOptions: { input } },
    plugins: [cometPlugin()],
  }) as Promise<Rollup.RollupOutput>
}

Deno.test(
  '1. server-only guard: a normal comet with no server-only dependency in its graph builds successfully',
  async () => {
    await withTempDir(async (root) => {
      await Deno.writeTextFile(
        `${root}/counter.tsx`,
        '\'use comet\'\nexport function Counter() { return "counter" }\n',
      )

      const result = await runBuild(root, { comet: `${root}/counter.tsx` })
      const chunks = result.output.filter((entry) => entry.type === 'chunk')
      assert(chunks.length > 0, 'expected the comet to build normally')
    })
  },
)

Deno.test(
  '2. server-only guard: a comet directly importing a server-only module fails the build with the chain',
  async () => {
    await withTempDir(async (root) => {
      await Deno.writeTextFile(
        `${root}/database.ts`,
        '\'server-only\'\nexport function query() { return "secret" }\n',
      )
      await Deno.writeTextFile(
        `${root}/counter.tsx`,
        "'use comet'\nimport { query } from './database.ts'\nexport function Counter() { return query() }\n",
      )

      const error = await assertRejects(() => runBuild(root, { comet: `${root}/counter.tsx` }))
      const message = String((error as Error).message)
      assertStringIncludes(message, 'Server-only module imported into client Comet')
      assertStringIncludes(message, 'counter.tsx')
      assertStringIncludes(message, 'database.ts')
      // Direct import — chain is exactly two deep, comet then the server-only module, nothing
      // fabricated in between.
      const cometLine = message.indexOf('counter.tsx')
      const dbLine = message.indexOf('database.ts')
      assert(
        cometLine < dbLine,
        `expected the comet to be listed before the violation, got:\n${message}`,
      )
    })
  },
)

Deno.test(
  '3. server-only guard: a server-only dependency reached only TRANSITIVELY (through an intermediate module) still fails the build, with the full chain',
  async () => {
    await withTempDir(async (root) => {
      await Deno.writeTextFile(
        `${root}/database.ts`,
        '\'server-only\'\nexport function query() { return "secret" }\n',
      )
      await Deno.writeTextFile(
        `${root}/widget.ts`,
        "import { query } from './database.ts'\nexport function loadWidget() { return query() }\n",
      )
      await Deno.writeTextFile(
        `${root}/counter.tsx`,
        "'use comet'\nimport { loadWidget } from './widget.ts'\nexport function Counter() { return loadWidget() }\n",
      )

      const error = await assertRejects(() => runBuild(root, { comet: `${root}/counter.tsx` }))
      const message = String((error as Error).message)
      assertStringIncludes(message, 'counter.tsx')
      assertStringIncludes(message, 'widget.ts')
      assertStringIncludes(message, 'database.ts')
      // Order must reflect the real chain: comet -> widget -> database, not just "all three names
      // appear somewhere" — a developer reading this needs the actual path, not a bag of files.
      const order = ['counter.tsx', 'widget.ts', 'database.ts'].map((name) => message.indexOf(name))
      assert(
        order[0] < order[1] && order[1] < order[2],
        `expected comet -> widget -> database order, got:\n${message}`,
      )
    })
  },
)

Deno.test(
  '4. server-only guard: two independent comets — only the one that actually crosses the boundary is named in the error',
  async () => {
    await withTempDir(async (root) => {
      await Deno.writeTextFile(
        `${root}/database.ts`,
        '\'server-only\'\nexport function query() { return "secret" }\n',
      )
      await Deno.writeTextFile(
        `${root}/clean.tsx`,
        '\'use comet\'\nexport function Clean() { return "clean" }\n',
      )
      await Deno.writeTextFile(
        `${root}/offender.tsx`,
        "'use comet'\nimport { query } from './database.ts'\nexport function Offender() { return query() }\n",
      )

      const error = await assertRejects(() =>
        runBuild(root, { clean: `${root}/clean.tsx`, offender: `${root}/offender.tsx` })
      )
      const message = String((error as Error).message)
      assertStringIncludes(message, 'offender.tsx')
      assert(
        !message.includes('clean.tsx'),
        `the clean comet must never be implicated in the violation message, got:\n${message}`,
      )
    })
  },
)

Deno.test(
  '5. server-only guard: identical protection under renderer: react and renderer: preact — the guard lives entirely in the bundler layer, before either renderer runs',
  async () => {
    for (const renderer of ['react', 'preact'] as const) {
      setActiveRenderer(renderer)
      try {
        // Each iteration flips the SAME process-wide active-renderer flag `setActiveRenderer`
        // manages — running both iterations concurrently would race one renderer's build against
        // the other's flag flip, not prove either one's isolated behavior.
        // deno-lint-ignore no-await-in-loop -- genuinely sequential: shared mutable global state
        await withTempDir(async (root) => {
          await Deno.writeTextFile(
            `${root}/database.ts`,
            '\'server-only\'\nexport function query() { return "secret" }\n',
          )
          await Deno.writeTextFile(
            `${root}/counter.tsx`,
            "'use comet'\nimport { query } from './database.ts'\nexport function Counter() { return query() }\n",
          )

          const error = await assertRejects(() => runBuild(root, { comet: `${root}/counter.tsx` }))
          const message = String((error as Error).message)
          assertStringIncludes(
            message,
            'Server-only module imported into client Comet',
            `renderer: '${renderer}' must produce the same guard failure`,
          )
        })
      } finally {
        setActiveRenderer('react')
      }
    }
  },
)

Deno.test(
  '6. server-only guard: a server-only module that no Comet ever imports produces no false positive',
  async () => {
    await withTempDir(async (root) => {
      // Present on disk, and even imported by a NON-comet file (the shape a real page/server
      // module importing it would take) — but never reachable from any Comet, so it never enters
      // this client-only build's module graph at all.
      await Deno.writeTextFile(
        `${root}/database.ts`,
        '\'server-only\'\nexport function query() { return "secret" }\n',
      )
      await Deno.writeTextFile(
        `${root}/server-page.ts`,
        "import { query } from './database.ts'\nexport function loadPage() { return query() }\n",
      )
      await Deno.writeTextFile(
        `${root}/counter.tsx`,
        '\'use comet\'\nexport function Counter() { return "counter" }\n',
      )

      // `server-page.ts` is deliberately NOT part of `input` at all — same as production, where
      // page code is never a client build entry (see `build-client.ts`'s own doc).
      const result = await runBuild(root, { comet: `${root}/counter.tsx` })
      const chunks = result.output.filter((entry) => entry.type === 'chunk')
      assert(chunks.length > 0, 'expected the unrelated comet to build normally, unaffected')
    })
  },
)

Deno.test(
  '7. server-only guard: fails through the REAL production entrypoint (buildSpaceClient), not just an isolated plugin call',
  async () => {
    await withTempDir(async (root) => {
      await Deno.writeTextFile(
        `${root}/database.ts`,
        '\'server-only\'\nexport function query() { return "secret" }\n',
      )
      await Deno.writeTextFile(
        `${root}/counter.tsx`,
        "'use comet'\nimport { query } from './database.ts'\nexport default function Counter() { return query() }\n",
      )

      const error = await assertRejects(() => buildSpaceClient({ root, css: { tailwind: false } }))
      assertStringIncludes(
        String((error as Error).message),
        'Server-only module imported into client Comet',
      )
    })
  },
)
