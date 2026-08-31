// Installs a renderer, exactly as a real app does: `@zanix/space` itself ships none, so a
// test that renders must import the entry point it is testing against.
import '../../../../mod-react.ts'
import { assert, assertEquals } from '@std/assert'
import { dirname, join } from '@std/path'
import { getTemporaryFolder } from '@zanix/helpers'
import { bootstrapServers, webServerManager } from '@zanix/server'
import { activateApps } from '@zanix/app/runtime'
import { defineSpaceApp } from 'modules/runtime/mod.ts'
import { createNotFoundHandler } from 'modules/router/mod.ts'
import { definePreHandler, getUserPreHandler, langPreHandler } from 'modules/middleware/mod.ts'
import { setLangRegistration } from 'modules/middleware/lang-registry.ts'
import { stripHydrationComments } from '../../support/strip-hydration-comments.ts'

const TMP_ROOT = getTemporaryFolder(import.meta.url)

console.error = () => {}

// A real, natively-importable page — `not-found.tsx` is discovered via a plain, native `import()`
// too (never `getDevImportModule()`, which only ever overrides `page.tsx`/`layout.tsx`), so
// stubbing this one via `setDevImportModule` would clobber `not-found.tsx`'s own real content
// with whatever the stub returns instead.
const HOME_PAGE_SOURCE = `import { Page, SpacePageController } from '@zanix/space'
function View() { return <p>home</p> }
@Page()
export default class HomePage extends SpacePageController {
  public override component = View
}
`

async function touch(path: string, content: string): Promise<void> {
  await Deno.mkdir(dirname(path), { recursive: true })
  await Deno.writeTextFile(path, content)
}

async function cleanup(dir: string): Promise<void> {
  await Deno.remove(dir, { recursive: true })
}

Deno.test(
  "not-found.tsx: receives this request's resolved lang (NotFoundProps) when this app calls " +
    'langPreHandler AND attachRequestToErrors is enabled — resolved from Accept-Language, since ' +
    'a 404 has no matched route to read a :lang param from',
  async () => {
    const routesDir = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      await touch(join(routesDir, '[lang]', 'page.tsx'), HOME_PAGE_SOURCE)
      await touch(
        join(routesDir, 'not-found.tsx'),
        `export default function NotFound({ lang }: { lang?: string }) {
  return <h1 data-testid="lang">{lang ?? 'none'}</h1>
}
`,
      )

      definePreHandler(langPreHandler({ availableLangs: ['en', 'es'], defaultLang: 'en' }))
      const app = defineSpaceApp({ name: 'not-found-lang-e2e', routesDir })
      await activateApps([app])

      const servers = await bootstrapServers({
        ssr: {
          port: 22211,
          application: 'not-found-lang-e2e',
          preHandler: getUserPreHandler(),
          onError: createNotFoundHandler(),
          attachRequestToErrors: true,
        },
      })
      try {
        const res = await fetch('http://localhost:22211/en/does-not-exist', {
          headers: { 'accept-language': 'es' },
        })
        assertEquals(res.status, 404)
        const html = stripHydrationComments(await res.text())
        assert(html.includes('data-testid="lang"'), html)
        // No cookie set on this request — Accept-Language wins over defaultLang ('en').
        assert(html.includes('>es<'), html)
      } finally {
        await webServerManager.stop(servers)
      }
    } finally {
      setLangRegistration(undefined)
      await cleanup(routesDir)
    }
  },
)

Deno.test(
  'not-found.tsx: lang is undefined without attachRequestToErrors — same safe-default ' +
    'degradation the Orbit fragment check already has',
  async () => {
    const routesDir = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      await touch(join(routesDir, '[lang]', 'page.tsx'), HOME_PAGE_SOURCE)
      await touch(
        join(routesDir, 'not-found.tsx'),
        `export default function NotFound({ lang }: { lang?: string }) {
  return <h1 data-testid="lang">{lang ?? 'none'}</h1>
}
`,
      )

      definePreHandler(langPreHandler({ availableLangs: ['en', 'es'], defaultLang: 'en' }))
      const app = defineSpaceApp({ name: 'not-found-lang-off-e2e', routesDir })
      await activateApps([app])

      const servers = await bootstrapServers({
        ssr: {
          port: 22212,
          application: 'not-found-lang-off-e2e',
          preHandler: getUserPreHandler(),
          onError: createNotFoundHandler(),
        },
      })
      try {
        const res = await fetch('http://localhost:22212/en/does-not-exist', {
          headers: { 'accept-language': 'es' },
        })
        assertEquals(res.status, 404)
        const html = stripHydrationComments(await res.text())
        assert(html.includes('>none<'), html)
      } finally {
        await webServerManager.stop(servers)
      }
    } finally {
      setLangRegistration(undefined)
      await cleanup(routesDir)
    }
  },
)
