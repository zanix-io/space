// Installs a renderer, exactly as a real app does: `@zanix/space` itself ships none, so a
// test that renders must import the entry point it is testing against.
import '../../../../mod-react.ts'
import { assert, assertEquals } from '@std/assert'
import { dirname, join } from '@std/path'
import { getTemporaryFolder } from '@zanix/helpers'
import { bootstrapServers, webServerManager } from '@zanix/server'
import { activateApps } from '@zanix/app/runtime'
import { defineSpaceApp } from 'modules/runtime/mod.ts'

const TMP_ROOT = getTemporaryFolder(import.meta.url)

console.error = () => {}

async function touch(path: string, content: string): Promise<void> {
  await Deno.mkdir(dirname(path), { recursive: true })
  await Deno.writeTextFile(path, content)
}

async function cleanup(dir: string): Promise<void> {
  await Deno.remove(dir, { recursive: true })
}

Deno.test(
  "error.tsx: a [lang]/... segment's own loader-thrown error renders its nearest error.tsx with " +
    "this segment's real resolved params (ErrorBoundaryProps.params) — the data-phase path, " +
    'which DOES render synchronously in the same response (unlike a render-phase throw under ' +
    "React — see SpaceErrorBoundary's own doc)",
  async () => {
    const routesDir = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      await touch(
        join(routesDir, '[lang]', 'page.tsx'),
        `import { Page, SpacePageController } from '@zanix/space'
function View() { return <p>should never render</p> }
@Page()
export default class BrokenPage extends SpacePageController {
  public override loader = () => { throw new Error('loader boom') }
  public override component = View
}
`,
      )
      await touch(
        join(routesDir, '[lang]', 'error.tsx'),
        `export default function LangError({ params }: { error: unknown; reset: () => void; params: Record<string, string> }) {
  return <h1 data-testid="lang-param">{params.lang}</h1>
}
`,
      )

      const app = defineSpaceApp({ name: 'error-params-e2e', routesDir })
      await activateApps([app])

      const servers = await bootstrapServers({
        ssr: { port: 22213, application: 'error-params-e2e' },
      })
      try {
        const res = await fetch('http://localhost:22213/en')
        assertEquals(res.status, 500)
        const html = await res.text()
        assert(html.includes('data-testid="lang-param"'), html)
        assert(html.includes('>en<'), html)
      } finally {
        await webServerManager.stop(servers)
      }
    } finally {
      await cleanup(routesDir)
    }
  },
)
