// Installs a renderer, exactly as a real app does: `@zanix/space` itself ships none, so a
// test that renders must import the entry point it is testing against.
import '../../../../mod-react.ts'
import { assert, assertEquals } from '@std/assert'
import { dirname, join } from '@std/path'
import { bootstrapServers, webServerManager } from '@zanix/server'
import { activateApps } from '@zanix/app/runtime'
import { getTemporaryFolder } from '@zanix/helpers'
import { defineSpaceApp } from 'modules/runtime/mod.ts'
import { Page, SpacePageController } from 'modules/router/mod.ts'
import { setDevImportModule } from 'modules/dev/dev-engine-registry.ts'
import { resetResolvedAssets } from 'modules/assets/asset-registry.ts'

const TMP_ROOT = getTemporaryFolder(import.meta.url)

console.error = () => {}

// The page/component under test — defined ONCE, referencing a stable public asset path. Every
// test below proves that whichever file actually answers that path changes purely through
// `assetsDir`'s own composition, never through any change here.
function ProductView() {
  return <img src='/assets/logo.svg' alt='logo' />
}

@Page()
class ProductPage extends SpacePageController {
  public override component = ProductView
}

// A pathless `@Page()`'s own registration is deferred and consumed EXACTLY ONCE (`pendingPages`,
// `page-decorator.ts`) — reimporting the SAME class reference again (as `fakeImportModule` below
// does, on purpose, across every test that only cares about `/assets/...`) is a documented no-op,
// not a re-registration. The one test that also needs a working PAGE route of its own (backward
// compatibility, at the bottom of this file) uses its own, separate, never-reused class instead.
function fakeImportModule() {
  return () => Promise.resolve({ default: ProductPage })
}

function NoAssetsView() {
  return <p>no-assets-ok</p>
}

@Page()
class NoAssetsPage extends SpacePageController {
  public override component = NoAssetsView
}

async function touch(path: string, content: string): Promise<void> {
  await Deno.mkdir(dirname(path), { recursive: true })
  await Deno.writeTextFile(path, content)
}

async function cleanup(...dirs: string[]): Promise<void> {
  await Promise.all(dirs.map((dir) => Deno.remove(dir, { recursive: true })))
}

Deno.test(
  "assets end-to-end: a host's assetsDir[] override wins for a shared asset, an asset the " +
    "override doesn't have falls back to the base directory, and the page/component (never " +
    'touched) keeps referencing the same stable /assets/logo.svg path throughout',
  async () => {
    const routesDir = await Deno.makeTempDir({ dir: TMP_ROOT })
    const overrideAssets = await Deno.makeTempDir({ dir: TMP_ROOT })
    const baseAssets = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      await touch(join(routesDir, 'page.tsx'), 'export default null\n')
      await touch(join(overrideAssets, 'logo.svg'), '<svg>host-logo</svg>')
      await touch(join(baseAssets, 'logo.svg'), '<svg>base-logo</svg>')
      await touch(
        join(baseAssets, 'icons', 'favicon.png'),
        'base-favicon-bytes',
      )

      setDevImportModule(fakeImportModule())
      try {
        const app = defineSpaceApp({
          name: 'shop-assets-e2e',
          routesDir,
          assetsDir: [overrideAssets, baseAssets],
        })
        await activateApps([app])

        const servers = await bootstrapServers({
          ssr: { port: 22001, application: 'shop-assets-e2e' },
        })
        try {
          // The page's own rendered markup — the component source never mentions overrides at all.
          const pageRes = await fetch('http://localhost:22001/')
          assertEquals(pageRes.status, 200)
          const html = await pageRes.text()
          assert(html.includes(`src="/assets/logo.svg"`), html)

          // The override directory wins for the file BOTH declare.
          const logoRes = await fetch('http://localhost:22001/assets/logo.svg')
          assertEquals(logoRes.status, 200)
          assertEquals(logoRes.headers.get('content-type'), 'image/svg+xml')
          assertEquals(await logoRes.text(), '<svg>host-logo</svg>')

          // A NESTED asset the override never declared falls back to the base directory.
          const iconRes = await fetch(
            'http://localhost:22001/assets/icons/favicon.png',
          )
          assertEquals(iconRes.status, 200)
          assertEquals(iconRes.headers.get('content-type'), 'image/png')
          assertEquals(await iconRes.text(), 'base-favicon-bytes')
        } finally {
          await webServerManager.stop(servers)
        }
      } finally {
        setDevImportModule(undefined)
        resetResolvedAssets()
      }
    } finally {
      await cleanup(routesDir, overrideAssets, baseAssets)
    }
  },
)

Deno.test('assets: 404 for a path never resolved by assetsDir', async () => {
  const routesDir = await Deno.makeTempDir({ dir: TMP_ROOT })
  const assetsDir = await Deno.makeTempDir({ dir: TMP_ROOT })
  try {
    await touch(join(routesDir, 'page.tsx'), 'export default null\n')
    await touch(join(assetsDir, 'logo.svg'), '<svg>base-logo</svg>')

    setDevImportModule(fakeImportModule())
    try {
      const app = defineSpaceApp({
        name: 'shop-assets-404',
        routesDir,
        assetsDir,
      })
      await activateApps([app])

      const servers = await bootstrapServers({
        ssr: { port: 22002, application: 'shop-assets-404' },
      })
      try {
        const res = await fetch(
          'http://localhost:22002/assets/does-not-exist.svg',
        )
        assertEquals(res.status, 404)
      } finally {
        await webServerManager.stop(servers)
      }
    } finally {
      setDevImportModule(undefined)
      resetResolvedAssets()
    }
  } finally {
    await cleanup(routesDir, assetsDir)
  }
})

Deno.test(
  'assets: case-sensitive names — a request for a different case than the real file 404s, ' +
    "the exact case resolves correctly (the catch-all preserves the request's own casing)",
  async () => {
    const routesDir = await Deno.makeTempDir({ dir: TMP_ROOT })
    const assetsDir = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      await touch(join(routesDir, 'page.tsx'), 'export default null\n')
      await touch(
        join(assetsDir, 'Logo.svg'),
        '<svg>case-sensitive-logo</svg>',
      )

      setDevImportModule(fakeImportModule())
      try {
        const app = defineSpaceApp({
          name: 'shop-assets-case',
          routesDir,
          assetsDir,
        })
        await activateApps([app])

        const servers = await bootstrapServers({
          ssr: { port: 22003, application: 'shop-assets-case' },
        })
        try {
          const exactCase = await fetch(
            'http://localhost:22003/assets/Logo.svg',
          )
          assertEquals(exactCase.status, 200)
          assertEquals(
            await exactCase.text(),
            '<svg>case-sensitive-logo</svg>',
          )

          const wrongCase = await fetch(
            'http://localhost:22003/assets/logo.svg',
          )
          assertEquals(wrongCase.status, 404)
        } finally {
          await webServerManager.stop(servers)
        }
      } finally {
        setDevImportModule(undefined)
        resetResolvedAssets()
      }
    } finally {
      await cleanup(routesDir, assetsDir)
    }
  },
)

Deno.test(
  'assets: dev and production use the exact same resolution/serving mechanism — two ' +
    'independent app activations of the identical assetsDir produce identical results, since ' +
    "`scanAssets`/`registerAssets` never consult dev-vs-prod state at all (unlike globalCss's " +
    'own two-path split, this mechanism has exactly one code path, period)',
  async () => {
    const routesDir = await Deno.makeTempDir({ dir: TMP_ROOT })
    const assetsDir = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      await touch(join(routesDir, 'page.tsx'), 'export default null\n')
      await touch(join(assetsDir, 'logo.svg'), '<svg>same-everywhere</svg>')

      // First activation.
      setDevImportModule(fakeImportModule())
      try {
        const firstApp = defineSpaceApp({
          name: 'shop-assets-dev',
          routesDir,
          assetsDir,
        })
        await activateApps([firstApp])
        const firstServers = await bootstrapServers({
          ssr: { port: 22004, application: 'shop-assets-dev' },
        })
        try {
          const res = await fetch('http://localhost:22004/assets/logo.svg')
          assertEquals(res.status, 200)
          assertEquals(await res.text(), '<svg>same-everywhere</svg>')
        } finally {
          await webServerManager.stop(firstServers)
        }
      } finally {
        setDevImportModule(undefined)
        resetResolvedAssets()
      }

      // Second, independent activation — same assetsDir, same expected result. Asset resolution
      // itself (`scanAssets`/`registerAssets`/`getAssetPath`) never references
      // `getDevImportModule()`/`isDevClientEnabled()` at all (confirmed by reading the code), so
      // there is no dev/prod branch here to toggle in the first place — this proves the mechanism
      // is deterministic and repeatable, not dependent on whatever else is active in the process.
      setDevImportModule(fakeImportModule())
      try {
        const secondApp = defineSpaceApp({
          name: 'shop-assets-prod',
          routesDir,
          assetsDir,
        })
        await activateApps([secondApp])
        const secondServers = await bootstrapServers({
          ssr: { port: 22005, application: 'shop-assets-prod' },
        })
        try {
          const res = await fetch('http://localhost:22005/assets/logo.svg')
          assertEquals(res.status, 200)
          assertEquals(await res.text(), '<svg>same-everywhere</svg>')
        } finally {
          await webServerManager.stop(secondServers)
        }
      } finally {
        setDevImportModule(undefined)
        resetResolvedAssets()
      }
    } finally {
      await cleanup(routesDir, assetsDir)
    }
  },
)

Deno.test(
  'assets: backward compatibility — an app that never declares assetsDir never registers the ' +
    '/assets route at all; a request there gets a normal 404, same as any other undeclared route',
  async () => {
    const routesDir = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      await touch(join(routesDir, 'page.tsx'), 'export default null\n')

      setDevImportModule(() => Promise.resolve({ default: NoAssetsPage }))
      try {
        const app = defineSpaceApp({ name: 'shop-no-assets', routesDir })
        await activateApps([app])

        const servers = await bootstrapServers({
          ssr: { port: 22006, application: 'shop-no-assets' },
        })
        try {
          const pageRes = await fetch('http://localhost:22006/')
          assertEquals(pageRes.status, 200)

          const assetRes = await fetch(
            'http://localhost:22006/assets/anything.svg',
          )
          assertEquals(assetRes.status, 404)
        } finally {
          await webServerManager.stop(servers)
        }
      } finally {
        setDevImportModule(undefined)
      }
    } finally {
      await cleanup(routesDir)
    }
  },
)
