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
import { setDevClientEnabled } from 'modules/dev/dev-client-registry.ts'
import { resetSitemapCache, setSitemapDeclaration } from 'modules/seo/sitemap.ts'
import type { SitemapEntry } from 'modules/seo/sitemap.ts'
import { setSitemapManifest } from 'modules/seo/sitemap-manifest.ts'
import { definePreHandler, getUserPreHandler, langPreHandler } from 'modules/middleware/mod.ts'
import { setLangRegistration } from 'modules/middleware/lang-registry.ts'
import { buildSpaceClient } from 'modules/bundler/build-client.ts'
import { setRoutesDir } from 'modules/router/routes-dir-registry.ts'

const TMP_ROOT = getTemporaryFolder(import.meta.url)

console.error = () => {}

function View() {
  return <p>ok</p>
}

@Page()
class HomePage extends SpacePageController {
  public override component = View
}
void HomePage

function fakeImportModule() {
  return () => Promise.resolve({ default: HomePage })
}

async function touch(path: string, content: string): Promise<void> {
  await Deno.mkdir(dirname(path), { recursive: true })
  await Deno.writeTextFile(path, content)
}

async function cleanup(...dirs: string[]): Promise<void> {
  await Promise.all(dirs.map((dir) => Deno.remove(dir, { recursive: true })))
}

Deno.test(
  'sitemap.xml + robots.txt end to end: a function sitemap source is called once and CACHED for ' +
    "the process lifetime (not re-run per request), and robots.txt's auto-appended Sitemap: " +
    'line, both served as real routes',
  async () => {
    resetSitemapCache()
    const routesDir = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      await touch(join(routesDir, 'page.tsx'), 'export default null\n')
      setDevImportModule(fakeImportModule())
      try {
        let callCount = 0
        const app = defineSpaceApp({
          name: 'seo-e2e',
          routesDir,
          sitemap: () => {
            callCount++
            return [
              { loc: '/', priority: 1 },
              { loc: '/about', lastmod: '2026-08-15' },
            ]
          },
          robots: { rules: [{ userAgent: '*', disallow: ['/admin'] }] },
        })
        await activateApps([app])

        const servers = await bootstrapServers({
          ssr: { port: 22201, application: 'seo-e2e' },
        })
        try {
          const sitemapRes = await fetch('http://localhost:22201/sitemap.xml')
          assertEquals(sitemapRes.status, 200)
          assertEquals(sitemapRes.headers.get('content-type'), 'application/xml; charset=utf-8')
          const sitemapXml = await sitemapRes.text()
          assert(sitemapXml.includes('<loc>http://localhost:22201/</loc>'), sitemapXml)
          assert(sitemapXml.includes('<loc>http://localhost:22201/about</loc>'), sitemapXml)
          assertEquals(callCount, 1)

          // Cached — a second request reuses the resolved entries, the function is NOT called again.
          const secondSitemapRes = await fetch('http://localhost:22201/sitemap.xml')
          const secondSitemapXml = await secondSitemapRes.text()
          assertEquals(callCount, 1)
          assertEquals(secondSitemapXml, sitemapXml)

          const robotsRes = await fetch('http://localhost:22201/robots.txt')
          assertEquals(robotsRes.status, 200)
          assertEquals(robotsRes.headers.get('content-type'), 'text/plain; charset=utf-8')
          const robotsBody = await robotsRes.text()
          assertEquals(
            robotsBody,
            'User-agent: *\nDisallow: /admin\n\nSitemap: http://localhost:22201/sitemap.xml\n',
          )
        } finally {
          await webServerManager.stop(servers)
        }
      } finally {
        setDevImportModule(undefined)
        resetSitemapCache()
      }
    } finally {
      await cleanup(routesDir)
    }
  },
)

@Page()
class DevBypassSitemapPage extends SpacePageController {
  public override component = View
}
void DevBypassSitemapPage

Deno.test(
  'sitemap.xml: under znx space dev (isDevClientEnabled), the cache is bypassed — a function ' +
    'source is called on every request, same live-edit story loadMessages() already gives',
  async () => {
    resetSitemapCache()
    const routesDir = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      await touch(join(routesDir, 'page.tsx'), 'export default null\n')
      setDevImportModule(() => Promise.resolve({ default: DevBypassSitemapPage }))
      try {
        let callCount = 0
        const app = defineSpaceApp({
          name: 'seo-dev-e2e',
          routesDir,
          sitemap: () => {
            callCount++
            return [{ loc: '/', priority: 1 }]
          },
        })
        await activateApps([app])

        const servers = await bootstrapServers({
          ssr: { port: 22205, application: 'seo-dev-e2e' },
        })
        setDevClientEnabled(true)
        try {
          await fetch('http://localhost:22205/sitemap.xml')
          assertEquals(callCount, 1)

          await fetch('http://localhost:22205/sitemap.xml')
          assertEquals(callCount, 2)
        } finally {
          setDevClientEnabled(false)
          await webServerManager.stop(servers)
        }
      } finally {
        setDevImportModule(undefined)
        resetSitemapCache()
      }
    } finally {
      await cleanup(routesDir)
    }
  },
)

@Page()
class ConcurrentSitemapPage extends SpacePageController {
  public override component = View
}
void ConcurrentSitemapPage

Deno.test(
  'sitemap.xml: concurrent requests racing before the first resolution settles share a single ' +
    'in-flight call — same de-duplication guarantee loadMessages() already gives',
  async () => {
    resetSitemapCache()
    const routesDir = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      await touch(join(routesDir, 'page.tsx'), 'export default null\n')
      setDevImportModule(() => Promise.resolve({ default: ConcurrentSitemapPage }))
      try {
        let callCount = 0
        const app = defineSpaceApp({
          name: 'seo-concurrent-e2e',
          routesDir,
          sitemap: async () => {
            callCount++
            await new Promise((resolve) => setTimeout(resolve, 20))
            return [{ loc: '/', priority: 1 }]
          },
        })
        await activateApps([app])

        const servers = await bootstrapServers({
          ssr: { port: 22206, application: 'seo-concurrent-e2e' },
        })
        try {
          const [a, b, c] = await Promise.all([
            fetch('http://localhost:22206/sitemap.xml'),
            fetch('http://localhost:22206/sitemap.xml'),
            fetch('http://localhost:22206/sitemap.xml'),
          ])
          assertEquals(a.status, 200)
          assertEquals(b.status, 200)
          assertEquals(c.status, 200)
          const [aXml, bXml, cXml] = await Promise.all([a.text(), b.text(), c.text()])
          assertEquals(aXml, bXml)
          assertEquals(bXml, cXml)
          assertEquals(callCount, 1)
        } finally {
          await webServerManager.stop(servers)
        }
      } finally {
        setDevImportModule(undefined)
        resetSitemapCache()
      }
    } finally {
      await cleanup(routesDir)
    }
  },
)

@Page()
class StaticSitemapPage extends SpacePageController {
  public override component = View
}
void StaticSitemapPage

Deno.test(
  'sitemap.xml: a static array source is never recomputed — the exact same reference is kept ' +
    'for the process lifetime, so mutating it after registration is reflected on the very next ' +
    'request (no snapshot at registration, and nothing to re-invoke: arrays are not callable)',
  async () => {
    const routesDir = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      await touch(join(routesDir, 'page.tsx'), 'export default null\n')
      setDevImportModule(() => Promise.resolve({ default: StaticSitemapPage }))
      try {
        const entries: SitemapEntry[] = [{ loc: '/', priority: 1 }]
        const app = defineSpaceApp({
          name: 'seo-static-e2e',
          routesDir,
          sitemap: entries,
        })
        await activateApps([app])

        const servers = await bootstrapServers({
          ssr: { port: 22204, application: 'seo-static-e2e' },
        })
        try {
          const first = await fetch('http://localhost:22204/sitemap.xml')
          const firstXml = await first.text()
          assert(firstXml.includes('<loc>http://localhost:22204/</loc>'), firstXml)
          assert(!firstXml.includes('/about'), firstXml)

          // Mutate the SAME array reference after registration — no re-registration, no new
          // `defineSpaceApp()` call. If this were snapshotted or recomputed via some hidden
          // mechanism, the next response wouldn't see it; if it's the live reference (the actual
          // guarantee), it does.
          entries.push({ loc: '/about' })

          const second = await fetch('http://localhost:22204/sitemap.xml')
          const secondXml = await second.text()
          assert(secondXml.includes('<loc>http://localhost:22204/</loc>'), secondXml)
          assert(secondXml.includes('<loc>http://localhost:22204/about</loc>'), secondXml)
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

@Page()
class NoSeoPage extends SpacePageController {
  public override component = View
}
void NoSeoPage

Deno.test(
  'sitemap.xml/robots.txt: an app that never declares either never registers the routes at all — ' +
    'a normal 404, same as any other undeclared route',
  async () => {
    const routesDir = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      await touch(join(routesDir, 'page.tsx'), 'export default null\n')
      setDevImportModule(() => Promise.resolve({ default: NoSeoPage }))
      try {
        const app = defineSpaceApp({ name: 'seo-none-e2e', routesDir })
        await activateApps([app])

        const servers = await bootstrapServers({
          ssr: { port: 22202, application: 'seo-none-e2e' },
        })
        try {
          const sitemapRes = await fetch('http://localhost:22202/sitemap.xml')
          assertEquals(sitemapRes.status, 404)
          const robotsRes = await fetch('http://localhost:22202/robots.txt')
          assertEquals(robotsRes.status, 404)
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

@Page()
class AutoProdPage extends SpacePageController {
  public override component = View
}
void AutoProdPage

Deno.test(
  "sitemap.xml: sitemap: 'auto' in production reads the build-time manifest and serves it as a " +
    'plain array — no route-discovery scan at request time, same zero-per-request-cost path a ' +
    'hand-written literal array already takes',
  async () => {
    const routesDir = await Deno.makeTempDir({ dir: TMP_ROOT })
    const clientBuildDir = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      await touch(join(routesDir, 'page.tsx'), 'export default null\n')
      await touch(
        join(clientBuildDir, 'sitemap-manifest.json'),
        JSON.stringify([{ loc: '/about' }, { loc: '/pricing' }]),
      )
      setDevImportModule(() => Promise.resolve({ default: AutoProdPage }))
      try {
        const app = defineSpaceApp({
          name: 'seo-auto-prod-e2e',
          routesDir,
          clientBuildDir,
          sitemap: 'auto',
        })
        await activateApps([app])

        const servers = await bootstrapServers({
          ssr: { port: 22207, application: 'seo-auto-prod-e2e' },
        })
        try {
          const res = await fetch('http://localhost:22207/sitemap.xml')
          assertEquals(res.status, 200)
          const xml = await res.text()
          assert(xml.includes('<loc>http://localhost:22207/about</loc>'), xml)
          assert(xml.includes('<loc>http://localhost:22207/pricing</loc>'), xml)
        } finally {
          await webServerManager.stop(servers)
        }
      } finally {
        setDevImportModule(undefined)
        setSitemapDeclaration(undefined)
        setSitemapManifest(undefined)
      }
    } finally {
      await cleanup(routesDir, clientBuildDir)
    }
  },
)

@Page()
class AutoBuildProdPage extends SpacePageController {
  public override component = View
}
void AutoBuildProdPage

Deno.test(
  "sitemap.xml: clientBuildDir + sitemap: 'auto', end to end through a REAL buildSpaceClient() " +
    'run (not a hand-written manifest) — a non-default routesDir, exactly the reference-project ' +
    'shape, still gets every real static page discovered, written into the manifest, and served ' +
    'once a production app is booted against that same clientBuildDir',
  async () => {
    const projectRoot = await Deno.makeTempDir({ dir: TMP_ROOT })
    const routesDir = join(projectRoot, 'src', 'space', 'routes')
    const clientBuildDir = join(projectRoot, '.dist', 'client')
    try {
      await touch(join(routesDir, 'page.tsx'), 'export default null\n')
      await touch(join(routesDir, 'login', 'page.tsx'), 'export default null\n')

      // The real build half — exactly what `zanix space build` runs: `defineSpaceApp({ routesDir,
      // sitemap: 'auto' })` having already captured both eagerly, then `buildSpaceClient()` with
      // no explicit `routesDir` of its own, and the CLI writing `result.sitemapEntries` into
      // `clientBuildDir` afterwards.
      setRoutesDir(routesDir)
      setSitemapDeclaration('auto')
      try {
        const buildResult = await buildSpaceClient({
          root: projectRoot,
          outDir: clientBuildDir,
          css: { tailwind: false },
        })
        assertEquals(buildResult.sitemapEntries, [{ loc: '/' }, { loc: '/login' }])
        await touch(
          join(clientBuildDir, 'sitemap-manifest.json'),
          JSON.stringify(buildResult.sitemapEntries),
        )
      } finally {
        setRoutesDir('./routes')
        setSitemapDeclaration(undefined)
      }

      // The real production-serving half — a fresh app, pointed at the SAME clientBuildDir a real
      // build just produced, `isDevClientEnabled()` left at its default `false`.
      setDevImportModule(() => Promise.resolve({ default: AutoBuildProdPage }))
      try {
        const app = defineSpaceApp({
          name: 'seo-auto-build-prod-e2e',
          routesDir,
          clientBuildDir,
          sitemap: 'auto',
        })
        await activateApps([app])

        const servers = await bootstrapServers({
          ssr: { port: 22210, application: 'seo-auto-build-prod-e2e' },
        })
        try {
          const res = await fetch('http://localhost:22210/sitemap.xml')
          assertEquals(res.status, 200)
          const xml = await res.text()
          assert(xml.includes('<loc>http://localhost:22210/</loc>'), xml)
          assert(xml.includes('<loc>http://localhost:22210/login</loc>'), xml)
        } finally {
          await webServerManager.stop(servers)
        }
      } finally {
        setDevImportModule(undefined)
        setSitemapDeclaration(undefined)
        setSitemapManifest(undefined)
      }
    } finally {
      await cleanup(projectRoot)
    }
  },
)

@Page()
class AutoDevPage extends SpacePageController {
  public override component = View
}
void AutoDevPage

Deno.test(
  "sitemap.xml: sitemap: 'auto' under znx space dev derives entries LIVE from the real route " +
    'tree on disk — excludes a dynamic segment, an unconditional redirect, and a noindex page, ' +
    'the same three filters the build-time derivation applies',
  async () => {
    const routesDir = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      await touch(join(routesDir, 'page.tsx'), 'export default null\n')
      await touch(join(routesDir, 'pricing', 'page.tsx'), 'export default null\n')
      await touch(
        join(routesDir, 'secret', 'page.tsx'),
        "export default class { static head = { meta: [{ name: 'robots', content: 'noindex' }] } }\n",
      )
      await touch(
        join(routesDir, 'legacy', 'page.tsx'),
        "export default class { static redirect = { to: '/pricing' } }\n",
      )
      await touch(join(routesDir, 'products', '[id]', 'page.tsx'), 'export default null\n')
      setDevImportModule(() => Promise.resolve({ default: AutoDevPage }))
      setDevClientEnabled(true)
      try {
        const app = defineSpaceApp({ name: 'seo-auto-dev-e2e', routesDir, sitemap: 'auto' })
        await activateApps([app])

        const servers = await bootstrapServers({
          ssr: { port: 22208, application: 'seo-auto-dev-e2e' },
        })
        try {
          const res = await fetch('http://localhost:22208/sitemap.xml')
          assertEquals(res.status, 200)
          const xml = await res.text()
          assert(xml.includes('<loc>http://localhost:22208/</loc>'), xml)
          assert(xml.includes('<loc>http://localhost:22208/pricing</loc>'), xml)
          assert(!xml.includes('/secret'), xml)
          assert(!xml.includes('/legacy'), xml)
          assert(!xml.includes('/products'), xml)
        } finally {
          await webServerManager.stop(servers)
        }
      } finally {
        setDevClientEnabled(false)
        setDevImportModule(undefined)
        setSitemapDeclaration(undefined)
      }
    } finally {
      await cleanup(routesDir)
    }
  },
)

@Page()
class AutoLangPage extends SpacePageController<{ lang: string }> {
  public override component = View
}
void AutoLangPage

Deno.test(
  "sitemap.xml: sitemap: 'auto' combined with langPreHandler expands the [lang] home route into " +
    'one entry per availableLangs, with hreflang alternates — the exact reference-project shape ' +
    '(routes/[lang]/page.tsx + langPreHandler) this expansion exists for',
  async () => {
    const routesDir = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      await touch(join(routesDir, '[lang]', 'page.tsx'), 'export default null\n')
      setDevImportModule(() => Promise.resolve({ default: AutoLangPage }))
      setDevClientEnabled(true)
      try {
        definePreHandler(langPreHandler({ availableLangs: ['en', 'es'], defaultLang: 'en' }))
        const app = defineSpaceApp({ name: 'seo-auto-lang-e2e', routesDir, sitemap: 'auto' })
        await activateApps([app])

        const servers = await bootstrapServers({
          ssr: {
            port: 22209,
            application: 'seo-auto-lang-e2e',
            preHandler: getUserPreHandler(),
          },
        })
        try {
          // `/sitemap.xml` itself stays reachable directly (never lang-prefixed) even with
          // `langPreHandler` wired — the same `FRAMEWORK_PREFIXES` guarantee already covered above.
          const res = await fetch('http://localhost:22209/sitemap.xml')
          assertEquals(res.status, 200)
          const xml = await res.text()
          assert(xml.includes('<loc>http://localhost:22209/en</loc>'), xml)
          assert(xml.includes('<loc>http://localhost:22209/es</loc>'), xml)
          assert(xml.includes('hreflang="en"'), xml)
          assert(xml.includes('hreflang="es"'), xml)
        } finally {
          await webServerManager.stop(servers)
        }
      } finally {
        setDevClientEnabled(false)
        setDevImportModule(undefined)
        setSitemapDeclaration(undefined)
        setLangRegistration(undefined)
      }
    } finally {
      await cleanup(routesDir)
    }
  },
)
