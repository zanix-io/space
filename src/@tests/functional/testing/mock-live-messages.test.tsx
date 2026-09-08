// Installs a renderer, exactly as a real app does: `@zanix/space` itself ships none, so a
// test that renders must import the entry point it is testing against.
import '../../../../mod-react.ts'
import { assertEquals } from '@std/assert'
import { dirname, join } from '@std/path'
import { getTemporaryFolder } from '@zanix/helpers'
import { SpacePageController } from 'modules/router/mod.ts'
import { mockLiveMessages, renderPageForTest, resetMessagesCache } from 'modules/testing/mod.ts'
import {
  resetMessagesBuildDir,
  resetMessagesDir,
  setMessagesBuildDir,
  setMessagesDir,
} from 'modules/i18n/messages-registry.ts'
import { loadMessages, type Messages } from 'modules/i18n/load-messages.ts'

console.error = () => {}

function ProfileView({ messages }: { messages: Messages }) {
  const heading = messages['profile/heading']
  return <h1>{typeof heading === 'string' ? heading : 'missing'}</h1>
}

class ProfilePage extends SpacePageController {
  public override loader = async () => ({
    messages: await loadMessages({ lang: 'es' }),
  })
  public override component = ProfileView
}

async function writeJson(path: string, content: unknown): Promise<void> {
  await Deno.mkdir(dirname(path), { recursive: true })
  await Deno.writeTextFile(path, JSON.stringify(content))
}

// Reproduces the real-world repro from the `messagesDir`+`clientBuildDir` testing gap: an app
// declaring BOTH fields (the realistic, documented `clientBuildDir` shape), exercised through a
// plain `deno test` — no real `zanix space build`/`zanix space dev` involved — the exact context
// `mockLiveMessages` exists for.
Deno.test(
  'mockLiveMessages: forces loadMessages() to read live messagesDir instead of an unbuilt clientBuildDir',
  async () => {
    const messagesDir = await Deno.makeTempDir({ dir: getTemporaryFolder(import.meta.url) })
    const clientBuildDir = await Deno.makeTempDir({ dir: getTemporaryFolder(import.meta.url) })
    try {
      await writeJson(join(messagesDir, 'es', 'index.json'), {
        'profile/heading': 'Tu perfil en MyApp',
      })
      setMessagesDir(messagesDir)
      // `clientBuildDir` configured, exactly like a real app — but never actually built, matching
      // a `deno test` run that never invoked `zanix space build` first.
      setMessagesBuildDir(clientBuildDir)

      // Without the fix: `isDevClientEnabled()` is false outside `zanix space dev`, so
      // `loadMessages()` reads the (empty) build dir, silently resolving an empty catalog — the
      // exact regression this issue reports (a real app routes `messages[key]` through
      // `@zanix/space-ui`'s `formatMessage()`, which falls back to the raw id; this fixture reads
      // the catalog directly, so ITS OWN fallback text stands in for that).
      const { html: beforeHtml } = await renderPageForTest(ProfilePage)
      assertEquals(beforeHtml.includes('missing'), true, beforeHtml)
      assertEquals(beforeHtml.includes('Tu perfil en MyApp'), false, beforeHtml)

      // With the fix: `mockLiveMessages()` flips the same gate `zanix space dev` uses and clears
      // the cache, so the SAME loader now reads the live `messagesDir` source instead.
      mockLiveMessages()
      const { html: afterHtml } = await renderPageForTest(ProfilePage)
      assertEquals(afterHtml.includes('Tu perfil en MyApp'), true, afterHtml)
    } finally {
      mockLiveMessages(false)
      resetMessagesCache()
      resetMessagesDir()
      resetMessagesBuildDir()
      await Promise.all(
        [messagesDir, clientBuildDir].map((dir) => Deno.remove(dir, { recursive: true })),
      )
    }
  },
)
