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
import { resetSitemapCache } from 'modules/seo/sitemap.ts'
import type { SitemapEntry } from 'modules/seo/sitemap.ts'

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
