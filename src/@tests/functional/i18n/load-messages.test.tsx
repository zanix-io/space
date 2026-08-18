// Installs a renderer, exactly as a real app does: `@zanix/space` itself ships none, so a
// test that renders must import the entry point it is testing against.
import '../../../../mod-react.ts'
import { assert, assertEquals } from '@std/assert'
import { dirname, join } from '@std/path'
import { bootstrapServers, Guard, webServerManager } from '@zanix/server'
import { getTemporaryFolder } from '@zanix/helpers'
import { Page, SpacePageController } from 'modules/router/mod.ts'
import { resetMessagesDir, setMessagesDir } from 'modules/i18n/messages-registry.ts'
import { loadMessages, resetMessagesCache } from 'modules/i18n/load-messages.ts'
import type { Messages } from 'modules/i18n/load-messages.ts'
import { populationGuard } from 'modules/middleware/mod.ts'

console.error = () => {}

function ProductsView({ messages }: { messages: Messages }) {
  return <h1>{messages['home/title'] ?? 'missing'}</h1>
}

@Page({ path: ':lang/i18n-e2e/products', headers: false })
@Guard(populationGuard())
class ProductsPage extends SpacePageController {
  public override loader = async (
    ctx: { params: { lang?: string }; population?: string },
  ) => ({
    // `:lang` is a required route segment (see `@Page`'s `path` above), so it is always present at
    // runtime — the fallback exists only to satisfy `loadMessages`'s required `lang: string`.
    messages: await loadMessages({ lang: ctx.params.lang ?? 'en', population: ctx.population }),
  })
  public override component = ProductsView
}
void ProductsPage

async function writeJson(path: string, content: unknown): Promise<void> {
  await Deno.mkdir(dirname(path), { recursive: true })
  await Deno.writeTextFile(path, JSON.stringify(content))
}

async function cleanup(...dirs: string[]): Promise<void> {
  await Promise.all(dirs.map((dir) => Deno.remove(dir, { recursive: true })))
}

// One `bootstrapServers()`/one Deno.test, several fetches against the SAME running server — same
// structure `population-guard.test.tsx`/`lang-guard.test.tsx` already use, for the same reason
// (`@Page()`'s registration only runs once at module-eval time).
Deno.test(
  'loadMessages end to end: a loader resolves the base catalog, and a population query string ' +
    'overlays its own override on top of it — real files, real SSR render',
  async () => {
    const messagesDir = await Deno.makeTempDir({ dir: getTemporaryFolder(import.meta.url) })
    try {
      await writeJson(join(messagesDir, 'en', 'index.json'), { 'home/title': 'Welcome' })
      await writeJson(join(messagesDir, 'en', 'populations', 'zanix.json'), {
        'home/title': 'Welcome to Zanix',
      })
      setMessagesDir(messagesDir)

      const servers = await bootstrapServers({ ssr: { port: 20508 } })
      try {
        const baseRes = await fetch('http://localhost:20508/en/i18n-e2e/products')
        assertEquals(baseRes.status, 200)
        assert((await baseRes.text()).includes('Welcome</h1>'))

        const popRes = await fetch(
          'http://localhost:20508/en/i18n-e2e/products?population=zanix',
        )
        assertEquals(popRes.status, 200)
        assert((await popRes.text()).includes('Welcome to Zanix</h1>'))
      } finally {
        await webServerManager.stop(servers)
      }
    } finally {
      resetMessagesDir()
      resetMessagesCache()
      await cleanup(messagesDir)
    }
  },
)
