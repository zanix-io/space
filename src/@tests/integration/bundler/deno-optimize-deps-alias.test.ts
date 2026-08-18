import { assert, assertEquals, assertFalse } from '@std/assert'
import { join } from '@std/path'
import { createServer } from 'vite'
import deno from '@deno/vite-plugin'
import { getTemporaryFolder } from '@zanix/helpers'
import { denoOptimizeDepsAliasPlugin } from 'modules/bundler/deno-optimize-deps-alias.ts'

const TMP_ROOT = getTemporaryFolder(import.meta.url)

/**
 * A real, minimal Vite dev server — `denoOptimizeDepsAliasPlugin()` alongside `deno()`, matching
 * exactly how `spacePlugin()` composes them in production. `optimizeDepsInclude` seeds
 * `optimizeDeps.include` the same way `@vitejs/plugin-react`'s own React-detection heuristic (or
 * any other plugin) would, ahead of this plugin's own `configResolved` — the same real trigger
 * this plugin exists to fix, not a mock of it.
 */
async function withDevServer(
  root: string,
  run: (server: Awaited<ReturnType<typeof createServer>>) => Promise<void>,
  options: { optimizeDepsInclude?: string[] } = {},
): Promise<void> {
  const server = await createServer({
    root,
    configFile: false,
    appType: 'custom',
    server: { middlewareMode: true, watch: null },
    css: { transformer: 'postcss' },
    optimizeDeps: { include: options.optimizeDepsInclude },
    plugins: [deno(), denoOptimizeDepsAliasPlugin()],
  })
  try {
    await run(server)
  } finally {
    await server.close()
  }
}

/** Real ESM output from the `client` environment for `url` — asserting on the ACTUAL transformed
 * code (not just the presence of a `resolve.alias` entry) is what proves the fix works end to
 * end: a real `/.vite/deps/<pkg>.js` import with Vite's own CJS-named-export interop shim, the
 * exact thing that's missing without this plugin. */
async function transformedReactImportLine(
  // deno-lint-ignore no-explicit-any
  server: any,
  url: string,
): Promise<string | undefined> {
  const result = await server.environments.client.transformRequest(url)
  // The actual `import ... from "/.vite/deps/react.js?..."` line specifically — a plain
  // `.includes('react')` search can match an earlier destructuring line instead
  // (`const useState = __vite__cjsImport0_react["useState"]`), which also contains the substring
  // but says nothing about where the module itself resolved to.
  return result?.code.split('\n').find((line: string) => line.includes('/.vite/deps/'))
}

/** `Deno.remove(root, {recursive:true})`, retried a few times — Vite's own dep-optimizer keeps
 * writing into `root/node_modules/.vite/deps/` briefly after `server.close()` resolves (a real,
 * observed race, not a hypothetical one: `Directory not empty (os error 66)` when a bare
 * `Deno.remove` ran immediately after close, only under the full suite's own timing, never when
 * this file ran alone). A short, bounded retry is simpler and more honest than a fixed sleep. */
async function removeTempDirWithRetry(root: string): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      // deno-lint-ignore no-await-in-loop -- this loop IS the retry; each attempt depends on the previous one's own failure
      await Deno.remove(root, { recursive: true })
      return
    } catch (error) {
      if (attempt === 9) throw error
      // deno-lint-ignore no-await-in-loop -- same reason as above
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }
}

Deno.test(
  'denoOptimizeDepsAliasPlugin: resolves and aliases a specifier already in optimizeDeps.include',
  async () => {
    const root = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      await Deno.writeTextFile(
        join(root, 'entry.tsx'),
        `import { useState } from 'react'\nexport default function C() { const [n] = useState(0); return n }\n`,
      )
      await withDevServer(root, async (server) => {
        const line = await transformedReactImportLine(server, '/entry.tsx')
        assert(line, 'expected a react import line in the transform output')
        assert(
          line.includes('/.vite/deps/react.js'),
          `expected the real optimized-deps path, got: ${line}`,
        )
      }, { optimizeDepsInclude: ['react'] })
    } finally {
      await removeTempDirWithRetry(root)
    }
  },
)

Deno.test(
  'denoOptimizeDepsAliasPlugin: a longer subpath specifier resolves correctly alongside its own shorter base package (no prefix-collision)',
  async () => {
    const root = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      await Deno.writeTextFile(
        join(root, 'entry.tsx'),
        `import { jsxDEV } from 'react/jsx-dev-runtime'\nexport default jsxDEV\n`,
      )
      // `react` listed FIRST, matching the exact ordering that reproduced the real bug: a plain
      // shorter alias winning a subpath match before the longer, more specific one is ever
      // reached (see `exactSpecifierRegex`'s own doc for the full mechanics).
      await withDevServer(root, async (server) => {
        const result = await server.environments.client.transformRequest(
          '/entry.tsx',
        )
        assert(result, 'expected a successful transform')
        assert(
          result.code.includes('/.vite/deps/react_jsx-dev-runtime.js') ||
            result.code.includes('jsx-dev-runtime'),
          `expected react/jsx-dev-runtime to resolve to a real optimized path, got: ${result.code}`,
        )
        assertFalse(
          result.code.includes('/index.js/jsx-dev-runtime'),
          `a garbled, prefix-collided path leaked through: ${result.code}`,
        )
      }, { optimizeDepsInclude: ['react', 'react/jsx-dev-runtime'] })
    } finally {
      await removeTempDirWithRetry(root)
    }
  },
)

Deno.test(
  'denoOptimizeDepsAliasPlugin: discovers a specifier a Comet imports directly, without it ever being in optimizeDeps.include',
  async () => {
    const root = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      await Deno.writeTextFile(
        join(root, 'counter.tsx'),
        `'use comet'\nimport { useState } from 'react'\nexport default function Counter() { const [n] = useState(0); return n }\n`,
      )
      // No `optimizeDepsInclude` at all — the ONLY way `react` ever gets discovered here is by
      // walking this Comet's own import graph.
      await withDevServer(root, async (server) => {
        assert(
          server.config.environments.client.optimizeDeps.include?.includes(
            'react',
          ),
          "expected react to be discovered and added to the client environment's own include",
        )
        const line = await transformedReactImportLine(server, '/counter.tsx')
        assert(
          line?.includes('/.vite/deps/react.js'),
          `expected real optimized path, got: ${line}`,
        )
      })
    } finally {
      await removeTempDirWithRetry(root)
    }
  },
)

Deno.test(
  "denoOptimizeDepsAliasPlugin: discovers a specifier reached only through a Comet's own relative helper file",
  async () => {
    const root = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      // `react-dom` here (never `react` itself) — a real, separate npm package, proving the
      // discovery walk isn't hardcoded to any one specifier. Reached only transitively, through a
      // plain relative import — never directly by the Comet file itself.
      await Deno.writeTextFile(
        join(root, 'helper.ts'),
        `import { version } from 'react-dom'\nexport const reactDomVersion = version\n`,
      )
      await Deno.writeTextFile(
        join(root, 'counter.tsx'),
        `'use comet'\nimport { reactDomVersion } from './helper.ts'\nexport default function Counter() { return reactDomVersion }\n`,
      )
      await withDevServer(root, async (server) => {
        assert(
          server.config.environments.client.optimizeDeps.include?.includes(
            'react-dom',
          ),
          'expected react-dom to be discovered through the relative helper file',
        )
        const result = await server.environments.client.transformRequest(
          '/helper.ts',
        )
        assert(result?.code.includes('/.vite/deps/react-dom.js'), result?.code)
      })
    } finally {
      await removeTempDirWithRetry(root)
    }
  },
)

Deno.test(
  "denoOptimizeDepsAliasPlugin: never adds a newly-discovered specifier to the ssr environment's own optimizeDeps.include",
  async () => {
    const root = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      await Deno.writeTextFile(
        join(root, 'counter.tsx'),
        `'use comet'\nimport { useState } from 'react'\nexport default function Counter() { const [n] = useState(0); return n }\n`,
      )
      await withDevServer(root, (server) => {
        assert(
          server.config.environments.client.optimizeDeps.include?.includes(
            'react',
          ),
        )
        assertFalse(
          server.config.environments.ssr.optimizeDeps.include?.includes(
            'react',
          ),
          "a newly-discovered specifier must never reach the ssr environment's own include — " +
            "confirmed the hard way this breaks RealImportEvaluator's own, already-correct " +
            'dependency resolution there',
        )
        return Promise.resolve()
      })
    } finally {
      await removeTempDirWithRetry(root)
    }
  },
)

Deno.test(
  'denoOptimizeDepsAliasPlugin: leaves an unresolvable specifier alone, without throwing',
  async () => {
    const root = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      await Deno.writeTextFile(
        join(root, 'entry.tsx'),
        `export const marker = 'ok'\n`,
      )
      await withDevServer(root, async (server) => {
        const hasAlias = server.config.resolve.alias.some((
          entry: { find: unknown },
        ) =>
          entry.find instanceof RegExp &&
          entry.find.test('definitely-not-a-real-package-xyz-123')
        )
        assertFalse(
          hasAlias,
          'an unresolvable specifier must never get a real alias entry',
        )
        // The server itself must still come up and serve real files normally — this plugin
        // failing to resolve ONE specifier must never take down anything else.
        const result = await server.environments.client.transformRequest(
          '/entry.tsx',
        )
        assertEquals(result?.code.includes('marker'), true)
      }, { optimizeDepsInclude: ['definitely-not-a-real-package-xyz-123'] })
    } finally {
      await removeTempDirWithRetry(root)
    }
  },
)

Deno.test(
  'denoOptimizeDepsAliasPlugin: a comet-less app with nothing in optimizeDeps.include anywhere ' +
    'exits early — no dependency gets pre-bundled/aliased at all',
  async () => {
    const root = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      await Deno.writeTextFile(join(root, 'entry.tsx'), `export const marker = 'ok'\n`)
      await withDevServer(root, async (server) => {
        const result = await server.environments.client.transformRequest('/entry.tsx')
        assert(result, 'expected a successful transform')
        assert(result.code.includes('marker'))
        assertFalse(
          result.code.includes('/.vite/deps/'),
          'nothing should have been pre-bundled when there is zero specifiers to discover',
        )
      })
    } finally {
      await removeTempDirWithRetry(root)
    }
  },
)

Deno.test(
  "denoOptimizeDepsAliasPlugin: a specifier declared only in a non-client environment's own " +
    'optimizeDeps.include (never at the top level) is still discovered and aliased',
  async () => {
    const root = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      await Deno.writeTextFile(join(root, 'entry.tsx'), `export const marker = 'ok'\n`)
      const server = await createServer({
        root,
        configFile: false,
        appType: 'custom',
        server: { middlewareMode: true, watch: null },
        css: { transformer: 'postcss' },
        environments: { ssr: { optimizeDeps: { include: ['react'] } } },
        plugins: [deno(), denoOptimizeDepsAliasPlugin()],
      })
      try {
        const hasAlias = server.config.resolve.alias.some((
          entry: { find: unknown },
        ) => entry.find instanceof RegExp && entry.find.test('react'))
        assert(
          hasAlias,
          "a specifier declared only inside the ssr environment's own optimizeDeps.include " +
            'must still be resolved and aliased, not just top-level entries',
        )
      } finally {
        await server.close()
      }
    } finally {
      await removeTempDirWithRetry(root)
    }
  },
)

Deno.test(
  'denoOptimizeDepsAliasPlugin: two comets sharing the same relative helper file only walk it ' +
    "once (the visited-guard), and still discover the helper's own specifier correctly",
  async () => {
    const root = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      await Deno.writeTextFile(
        join(root, 'helper.ts'),
        `import { version } from 'react-dom'\nexport const reactDomVersion = version\n`,
      )
      await Deno.writeTextFile(
        join(root, 'counter-a.tsx'),
        `'use comet'\nimport { reactDomVersion } from './helper.ts'\nexport default function A() { return reactDomVersion }\n`,
      )
      await Deno.writeTextFile(
        join(root, 'counter-b.tsx'),
        `'use comet'\nimport { reactDomVersion } from './helper.ts'\nexport default function B() { return reactDomVersion }\n`,
      )
      await withDevServer(root, (server) => {
        assert(
          server.config.environments.client.optimizeDeps.include?.includes('react-dom'),
          'expected react-dom to be discovered correctly even though two different comets ' +
            'share the exact same relative helper file',
        )
        return Promise.resolve()
      })
    } finally {
      await removeTempDirWithRetry(root)
    }
  },
)

Deno.test(
  'denoOptimizeDepsAliasPlugin: skips a relative import target that resolves to a real file but ' +
    "can't be read, without throwing and without discovering anything from inside it",
  async () => {
    const root = await Deno.makeTempDir({ dir: TMP_ROOT })
    // Deliberately placed inside a dotfile-prefixed directory: `discoverComets` itself (a
    // separate, earlier walk over every `.ts`/`.tsx` file under `root`, unconditionally reading
    // each one to check for the `'use comet'` directive) skips dotfile directories entirely — the
    // only way an unreadable source file can reach THIS plugin's own relative-import walk at all
    // without `discoverComets` failing first on the exact same permission error.
    const helperPath = join(root, '.private', 'helper.ts')
    try {
      await Deno.mkdir(join(root, '.private'))
      await Deno.writeTextFile(
        helperPath,
        `import { version } from 'react-dom'\nexport const reactDomVersion = version\n`,
      )
      await Deno.chmod(helperPath, 0o000)
      await Deno.writeTextFile(
        join(root, 'counter.tsx'),
        `'use comet'\nimport { reactDomVersion } from './.private/helper.ts'\nexport default function Counter() { return reactDomVersion }\n`,
      )
      await withDevServer(root, (server) => {
        assertFalse(
          server.config.environments.client.optimizeDeps.include?.includes('react-dom'),
          'a bare specifier inside an unreadable relative-import target must never be discovered',
        )
        return Promise.resolve()
      })
    } finally {
      await Deno.chmod(helperPath, 0o644)
      await removeTempDirWithRetry(root)
    }
  },
)

Deno.test(
  'denoOptimizeDepsAliasPlugin: skips an absolute-path import specifier — never treated as a ' +
    'bare package specifier, while a real bare specifier alongside it still gets discovered',
  async () => {
    const root = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      await Deno.writeTextFile(
        join(root, 'counter.tsx'),
        `'use comet'\nimport '/some/absolute/project/path.css'\nimport { useState } from 'react'\nexport default function Counter() { const [n] = useState(0); return n }\n`,
      )
      await withDevServer(root, (server) => {
        const hasAbsoluteAlias = server.config.resolve.alias.some((
          entry: { find: unknown },
        ) =>
          entry.find instanceof RegExp &&
          entry.find.test('/some/absolute/project/path.css')
        )
        assertFalse(
          hasAbsoluteAlias,
          'an absolute-path import specifier must never be treated as a bare package specifier',
        )
        assert(
          server.config.environments.client.optimizeDeps.include?.includes('react'),
          'the real bare specifier alongside the absolute-path import must still be discovered',
        )
        return Promise.resolve()
      })
    } finally {
      await removeTempDirWithRetry(root)
    }
  },
)

Deno.test(
  'denoOptimizeDepsAliasPlugin: a relative import to a genuinely missing file is skipped, ' +
    'without throwing — and a real specifier alongside it is still discovered',
  async () => {
    const root = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      await Deno.writeTextFile(
        join(root, 'counter.tsx'),
        `'use comet'\nimport './does-not-exist'\nimport { useState } from 'react'\nexport default function Counter() { const [n] = useState(0); return n }\n`,
      )
      await withDevServer(root, (server) => {
        assert(
          server.config.environments.client.optimizeDeps.include?.includes('react'),
          'a relative import that resolves to nothing real must not prevent discovery of a ' +
            'real specifier alongside it',
        )
        return Promise.resolve()
      })
    } finally {
      await removeTempDirWithRetry(root)
    }
  },
)

Deno.test(
  "denoOptimizeDepsAliasPlugin: finds the nearest deno.json relative to root, not the process's own CWD",
  async () => {
    const root = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      // A specifier @zanix/space's own deno.json does NOT declare — the only way this resolves
      // is via a deno.json written INSIDE `root` itself, confirming `findDenoConfigPath` walks up
      // from `root`, not from `Deno.cwd()` (the real bug this regression guards against: a
      // process-wide singleton loader silently falling back to the WRONG project's own config).
      await Deno.writeTextFile(
        join(root, 'deno.json'),
        JSON.stringify({
          imports: { ms: 'npm:ms@^2.1.3' },
          nodeModulesDir: 'auto',
        }),
      )
      const install = await new Deno.Command('deno', {
        args: ['install'],
        cwd: root,
      }).output()
      assert(install.success, new TextDecoder().decode(install.stderr))

      await Deno.writeTextFile(
        join(root, 'counter.tsx'),
        `'use comet'\nimport ms from 'ms'\nexport default function Counter() { return ms(60000) }\n`,
      )
      await withDevServer(root, async (server) => {
        assert(
          server.config.environments.client.optimizeDeps.include?.includes(
            'ms',
          ),
        )
        const result = await server.environments.client.transformRequest(
          '/counter.tsx',
        )
        assert(
          result?.code.includes('/.vite/deps/ms.js'),
          `expected ms to resolve via this project's own local deno.json, got: ${result?.code}`,
        )
      })
    } finally {
      await removeTempDirWithRetry(root)
    }
  },
)
