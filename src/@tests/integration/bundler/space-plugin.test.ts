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
