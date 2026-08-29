import { assert, assertFalse } from '@std/assert'
import { spacePlugin } from 'modules/bundler/space-plugin.ts'

/** Real plugin names each renderer's own real npm package produces — read directly off a real
 * `spacePlugin()` call, not assumed (`@vitejs/plugin-react@6.0.5`/`@preact/preset-vite@2.10.6`,
 * the exact versions this package depends on). Used as the one reliable, renderer-diagnostic
 * signal available without actually running a JSX transform (`spacePlugin`'s own doc: React's
 * plugin configures Rolldown's native `oxc.jsx` via the PROJECT's own `deno.json`
 * `compilerOptions.jsxImportSource`, not via anything this function's return value itself carries
 * for React — `'prefresh'` (Preact's own Fast-Refresh registration plugin) has no React
 * equivalent, so its presence/absence alone is enough to prove which branch ran). */
function pluginNames(options?: Parameters<typeof spacePlugin>[0]): string[] {
  // `spacePlugin()`'s return type is Vite's own `PluginOption[]` — falsy entries, nested arrays and
  // promises are all legal shapes of that type (never actually produced here), so real plugin
  // objects are filtered out explicitly rather than assumed.
  return spacePlugin(options)
    .filter((plugin): plugin is { name: string } =>
      typeof plugin === 'object' && plugin !== null && 'name' in plugin
    )
    .map((plugin) => plugin.name)
}

Deno.test('spacePlugin: defaults to react — includes react plugins, never prefresh', () => {
  const names = pluginNames()
  assert(names.includes('vite:react-babel'), names.join(', '))
  assertFalse(names.includes('prefresh'), names.join(', '))
})

Deno.test("spacePlugin: renderer: 'react' explicitly is identical to omitting it", () => {
  const names = pluginNames({ renderer: 'react' })
  assert(names.includes('vite:react-babel'), names.join(', '))
  assertFalse(names.includes('prefresh'), names.join(', '))
})

Deno.test("spacePlugin: renderer: 'preact' composes preact plugins, never react's", () => {
  const names = pluginNames({ renderer: 'preact' })
  assert(names.includes('prefresh'), names.join(', '))
  assertFalse(names.includes('vite:react-babel'), names.join(', '))
})

Deno.test('spacePlugin: shared plugins are present regardless of renderer', () => {
  for (const renderer of ['react', 'preact'] as const) {
    const names = pluginNames({ renderer })
    assert(names.includes('zanix-space'), names.join(', '))
    assert(names.includes('zanix-deno-optimize-deps-alias'), names.join(', '))
  }
})

/** Narrow shape covering only what this test reads off the `zanix-space` plugin — its real return
 * type is Vite's own deeply recursive `Plugin`, not reproduced here (see `space-plugin.ts`'s own
 * doc for why this package never re-exports that vendor type). */
interface ZanixSpacePluginShape {
  name: string
  config: () => {
    environments: { client: { optimizeDeps: { include: string[] } } }
  }
}

/** The `zanix-space` plugin's own `config()` hook, called directly the same way Vite's plugin
 * pipeline would — real return value, not assumed from reading the source. */
function clientOptimizeDepsInclude(renderer?: 'react' | 'preact'): string[] {
  const plugin = spacePlugin({ renderer }).find(
    (p): p is ZanixSpacePluginShape =>
      typeof p === 'object' && p !== null && 'name' in p && p.name === 'zanix-space',
  )
  assert(plugin, 'zanix-space plugin not found')
  return plugin.config().environments.client.optimizeDeps.include
}

Deno.test(
  "spacePlugin: 'react' pre-declares react-dom/client's own react-dom closure for optimizeDeps",
  () => {
    const include = clientOptimizeDepsInclude('react')
    for (const specifier of ['react', 'react-dom', 'react-dom/client']) {
      assert(include.includes(specifier), include.join(', '))
    }
  },
)

Deno.test(
  "spacePlugin: 'preact' pre-declares its own client hydration entry for optimizeDeps too, " +
    "including preact/hooks — a real, confirmed direct Comet import (@zanix/cli's own " +
    '--theme astronaut demo), the exact class of dependency this whole mitigation exists for',
  () => {
    const include = clientOptimizeDepsInclude('preact')
    assert(include.includes('preact'), include.join(', '))
    assert(include.includes('preact/hooks'), include.join(', '))
    assertFalse(include.includes('react-dom'), include.join(', '))
  },
)

Deno.test(
  "spacePlugin: 'preact' also pre-declares @prefresh/core and @prefresh/utils — a real, " +
    'confirmed module-identity bug (not the discovery-scan race the other entries guard ' +
    "against): two different @prefresh/core instances silently split Prefresh's own re-render " +
    'tracking in two, making a Comet edit run flushUpdates() with zero error but never touch ' +
    'the DOM',
  () => {
    const include = clientOptimizeDepsInclude('preact')
    assert(include.includes('@prefresh/core'), include.join(', '))
    assert(include.includes('@prefresh/utils'), include.join(', '))
  },
)
