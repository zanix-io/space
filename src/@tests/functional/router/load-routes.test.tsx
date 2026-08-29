// Installs a renderer, exactly as a real app does: `@zanix/space` itself ships none, so a
// test that renders must import the entry point it is testing against.
import '../../../../mod-react.ts'
import { assert, assertEquals } from '@std/assert'
import { join } from '@std/path'
import { bootstrapServers, ProgramModule, webServerManager } from '@zanix/server'
import { getTemporaryFolder } from '@zanix/helpers'
import { loadRoutes, Page, SpacePageController } from 'modules/router/mod.ts'

Deno.test(
  "loadRoutes: a pathless @Page() infers its route from the file's own folder location",
  async () => {
    await loadRoutes('src/@tests/support/fixtures/inferred-routes')

    const servers = await bootstrapServers({ ssr: { port: 20601 } })
    try {
      const res = await fetch('http://localhost:20601/inferred')
      assertEquals(res.status, 200)
      const html = await res.text()
      assert(html.includes('inferred-ok'))
    } finally {
      await webServerManager.stop(servers)
    }
  },
)

Deno.test(
  'loadRoutes: a second call for the same file deregisters the previous page class first',
  async () => {
    const routesDir = await Deno.makeTempDir({ dir: getTemporaryFolder(import.meta.url) })
    try {
      // Content is irrelevant — `scanPageFiles` only needs the file to exist to discover it;
      // `importModule` below is what actually decides what "imports" as this page.
      await Deno.writeTextFile(
        join(routesDir, 'page.tsx'),
        'export default null\n',
      )

      let generation = 0
      const importModule = () => {
        generation++
        const marker = `reload-gen-${generation}`
        function View() {
          return <p>{marker}</p>
        }
        @Page()
        class ReloadablePage extends SpacePageController {
          public override component = View
        }
        return Promise.resolve({ default: ReloadablePage })
      }

      await loadRoutes(routesDir, { importModule })
      // The real bug this covers: without deregistering the first call's class first, this
      // second call's fresh `@Page()` registration collides ("Route path ... is already
      // defined") — simulating a dev-server reimporting a page after a file change.
      await loadRoutes(routesDir, { importModule })

      const servers = await bootstrapServers({ ssr: { port: 20602 } })
      try {
        const res = await fetch('http://localhost:20602')
        assertEquals(res.status, 200)
        const html = await res.text()
        // Only the SECOND generation's class is actually registered/served — the first one's
        // route entry was removed, not left dangling alongside the new one.
        assert(html.includes('reload-gen-2'))
        assert(!html.includes('reload-gen-1'))
      } finally {
        await webServerManager.stop(servers)
      }
    } finally {
      await Deno.remove(routesDir, { recursive: true })
    }
  },
)

Deno.test(
  'loadRoutes: a second call recovers from an EXPLICIT @Page(path) colliding with its own stale ' +
    'registration',
  async () => {
    const routesDir = await Deno.makeTempDir({ dir: getTemporaryFolder(import.meta.url) })
    try {
      await Deno.writeTextFile(
        join(routesDir, 'page.tsx'),
        'export default null\n',
      )

      let generation = 0
      const importModule = () => {
        generation++
        const marker = `explicit-reload-gen-${generation}`
        function View() {
          return <p>{marker}</p>
        }
        @Page('explicit-reload')
        class ReloadablePage extends SpacePageController {
          public override component = View
        }
        return Promise.resolve({ default: ReloadablePage })
      }

      await loadRoutes(routesDir, { importModule })
      // The real bug this covers: an explicit `@Page(path)` registers synchronously, during
      // import itself (see `Page`'s own doc on its two path-resolution modes) — unlike the
      // pathless case above, whose registration is deferred until after import, so this second
      // call's fresh registration collides with the still-live first one BEFORE `loadRoutes` ever
      // gets a chance to deregister it. Without recovery, this throws "Route path ... is already
      // defined" instead of succeeding.
      await loadRoutes(routesDir, { importModule })

      const servers = await bootstrapServers({ ssr: { port: 20604 } })
      try {
        const res = await fetch('http://localhost:20604/explicit-reload')
        assertEquals(res.status, 200)
        const html = await res.text()
        // The recovery retries the import once (see `importPageModule`'s own doc), so the SECOND
        // `loadRoutes()` call above actually invokes `importModule` twice — gen-1 never renders,
        // but which later generation number wins isn't the guarantee under test (an internal
        // detail of the retry, not something calling code should ever need to reason about); only
        // that the stale FIRST registration is truly gone, never left dangling alongside the new
        // one, same guarantee the pathless case already gives.
        assert(!html.includes('explicit-reload-gen-1'), html)
        assert(/explicit-reload-gen-\d/.test(html), html)
      } finally {
        await webServerManager.stop(servers)
      }
    } finally {
      await Deno.remove(routesDir, { recursive: true })
    }
  },
)

Deno.test(
  'loadRoutes: a genuine collision between two DIFFERENT explicit-path pages still throws, never ' +
    'swallowed as a self-recovery',
  async () => {
    function View() {
      return <p>collision</p>
    }
    const routesDir = await Deno.makeTempDir({ dir: getTemporaryFolder(import.meta.url) })
    try {
      await Deno.mkdir(join(routesDir, 'a'))
      await Deno.mkdir(join(routesDir, 'b'))
      await Deno.writeTextFile(join(routesDir, 'a', 'page.tsx'), 'export default null\n')
      await Deno.writeTextFile(join(routesDir, 'b', 'page.tsx'), 'export default null\n')

      const importModule = (filePath: string) => {
        // Each file's own class is declared (and decorated — `@Page` registers synchronously,
        // immediately) only when THAT file is the one being imported — declaring both up front
        // would collide with each other right here, before either file's own import is even
        // attempted, which isn't the scenario this test means to cover.
        if (filePath.includes(join('a', 'page.tsx'))) {
          @Page('shared-path')
          class ClassA extends SpacePageController {
            public override component = View
          }
          return Promise.resolve({ default: ClassA })
        }
        @Page('shared-path')
        class ClassB extends SpacePageController {
          public override component = View
        }
        return Promise.resolve({ default: ClassB })
      }

      let thrown: unknown
      try {
        await loadRoutes(routesDir, { importModule })
      } catch (error) {
        thrown = error
      }

      assert(thrown, 'two unrelated pages explicitly claiming the same path must still collide')
      assert(
        (thrown as Error).message.includes('already defined'),
        `expected the real collision error, got: ${thrown}`,
      )
    } finally {
      await Deno.remove(routesDir, { recursive: true })
    }
  },
)

Deno.test(
  'loadRoutes: a redundant call for an UNCHANGED native-imported file stays a safe no-op',
  async () => {
    // Real regression coverage, not a hypothetical: an earlier version of this deregistration
    // logic unconditionally deregistered the previous class's routes before every reimport,
    // which broke `not-found-integration.test.tsx` (a real, pre-existing, legitimate pattern —
    // calling `loadRoutes()` again for the SAME unchanged fixture across several `Deno.test`
    // blocks in one file, relying on it being a no-op). `importModule` here hits Deno's own ES
    // module cache and returns the identical class both times — the fix only deregisters when
    // the reimport produces a genuinely DIFFERENT class (see `loadRoutes`'s own doc).
    //
    // Uses its own dedicated fixture (`redundant-reload-routes`), never touched by any other
    // test — the `inferred-routes` fixture this file's first test already consumes gets its
    // routes wiped by that test's own (default `finalize: true`) `bootstrapServers()` call,
    // which would make this test's failure mode indistinguishable from a real bug.
    await loadRoutes('src/@tests/support/fixtures/redundant-reload-routes')
    await loadRoutes('src/@tests/support/fixtures/redundant-reload-routes')

    const servers = await bootstrapServers({ ssr: { port: 20603 } })
    try {
      const res = await fetch('http://localhost:20603')
      assertEquals(res.status, 200)
      const html = await res.text()
      assert(html.includes('redundant-reload-ok'))
    } finally {
      await webServerManager.stop(servers)
    }
  },
)

Deno.test(
  'loadRoutes: a page whose file is removed (a rename or a delete) is deregistered on the next ' +
    'call, not left dangling forever',
  async () => {
    function View() {
      return <p>still-here</p>
    }
    const routesDir = await Deno.makeTempDir({ dir: getTemporaryFolder(import.meta.url) })
    try {
      await Deno.mkdir(join(routesDir, 'a'))
      await Deno.mkdir(join(routesDir, 'b'))
      await Deno.writeTextFile(join(routesDir, 'a', 'page.tsx'), 'export default null\n')
      await Deno.writeTextFile(join(routesDir, 'b', 'page.tsx'), 'export default null\n')

      const importModule = (filePath: string) => {
        if (filePath.includes(join('a', 'page.tsx'))) {
          @Page()
          class PageA extends SpacePageController {
            public override component = View
          }
          return Promise.resolve({ default: PageA })
        }
        @Page()
        class PageB extends SpacePageController {
          public override component = View
        }
        return Promise.resolve({ default: PageB })
      }

      await loadRoutes(routesDir, { importModule })

      const servers = await bootstrapServers({ ssr: { port: 20609 } })
      try {
        assertEquals((await fetch('http://localhost:20609/a')).status, 200)
        assertEquals((await fetch('http://localhost:20609/b')).status, 200)
      } finally {
        await webServerManager.stop(servers)
      }

      // Simulates a folder rename (`a` gone, `b` untouched) — `scanPageFiles` genuinely no
      // longer finds `a/page.tsx` on this second call, exactly as it wouldn't after a real
      // rename on disk.
      await Deno.remove(join(routesDir, 'a'), { recursive: true })
      await loadRoutes(routesDir, { importModule })

      const secondServers = await bootstrapServers({ ssr: { port: 20610 } })
      try {
        // `a`'s route must be gone — not just "not re-registered," but actively deregistered;
        // before this fix, `registeredPageTargets` kept it forever since nothing ever revisits
        // a file `scanPageFiles` no longer returns.
        assertEquals((await fetch('http://localhost:20610/a')).status, 404)
        assertEquals((await fetch('http://localhost:20610/b')).status, 200)
      } finally {
        await webServerManager.stop(secondServers)
      }
    } finally {
      await Deno.remove(routesDir, { recursive: true })
    }
  },
)

Deno.test(
  "loadRoutes: a pathless page's route is restored on the next call if something else removed " +
    'it, even when the reimport is a cache-hit (same class reference)',
  async () => {
    function View() {
      return <p>hot-reinstall-ok</p>
    }
    const routesDir = await Deno.makeTempDir({ dir: getTemporaryFolder(import.meta.url) })
    try {
      await Deno.writeTextFile(join(routesDir, 'page.tsx'), 'export default null\n')

      @Page()
      class ReinstalledPage extends SpacePageController {
        public override component = View
      }
      // Returns the SAME class reference on every call — exactly what Deno's own ES module
      // cache does for a plain `import()` of an unchanged file in a real production process
      // (no dev engine involved at all).
      const importModule = () => Promise.resolve({ default: ReinstalledPage })

      await loadRoutes(routesDir, { importModule })

      // Simulates `@zanix/app`'s `uninstallApp` sweeping this Application's whole route surface
      // in a live process — never something `loadRoutes()` itself would do, and never something
      // its own `registeredPageTargets` bookkeeping learns about on its own.
      const removed = ProgramModule.unregisterRoutes(ReinstalledPage, 'ssr')
      assert(removed > 0, 'setup check: the page must have been registered before this point')

      // Simulates `installApp` reinstalling the same app right after — `setup()`, and therefore
      // `loadRoutes()`, reruns for the identical `routesDir`. The class reference coming back
      // from `importModule` is IDENTICAL to before (a cache-hit), so nothing here reruns
      // `@Page()`'s own decorator — recovery has to come from `loadRoutes()`/`resolvePendingPage`
      // themselves noticing the registration is gone, not from a fresh import.
      await loadRoutes(routesDir, { importModule })

      const servers = await bootstrapServers({ ssr: { port: 20606 } })
      try {
        const res = await fetch('http://localhost:20606')
        assertEquals(res.status, 200)
        const html = await res.text()
        assert(html.includes('hot-reinstall-ok'))
      } finally {
        await webServerManager.stop(servers)
      }
    } finally {
      await Deno.remove(routesDir, { recursive: true })
    }
  },
)

Deno.test(
  'loadRoutes: a page.tsx with no default export yet (the normal state right after scaffolding ' +
    'a new page — an empty file, before writing its component) is skipped, not a fatal error ' +
    "that takes down every OTHER page's own reload",
  async () => {
    function View() {
      return <p>good-page-ok</p>
    }
    const routesDir = await Deno.makeTempDir({ dir: getTemporaryFolder(import.meta.url) })
    try {
      await Deno.mkdir(join(routesDir, 'good'))
      await Deno.mkdir(join(routesDir, 'empty'))
      await Deno.writeTextFile(join(routesDir, 'good', 'page.tsx'), 'export default null\n')
      // A real, empty `page.tsx` — no default export at all — is what the file system actually
      // contains right after `mkdir` + an empty file, before its own `importModule` override ever
      // runs; this fixture just needs to exist for `scanPageFiles` to discover it.
      await Deno.writeTextFile(join(routesDir, 'empty', 'page.tsx'), '')

      @Page()
      class GoodPage extends SpacePageController {
        public override component = View
      }
      const importModule = (filePath: string) => {
        if (filePath.includes(join('empty', 'page.tsx'))) {
          // No `default` at all — exactly what a real native/Vite import of the empty file
          // above resolves to.
          return Promise.resolve({})
        }
        return Promise.resolve({ default: GoodPage })
      }

      // The real regression: this must NOT reject — before this fix, `setPageTree`'s own
      // `WeakMap.set(undefined, ...)` threw `TypeError: Invalid value used as weak map key`,
      // which rejected this whole call's `Promise.all` and, in `zanix space dev`, meant NO
      // page's route table ever got refreshed on the live server for that reload cycle — not
      // just the empty one.
      await loadRoutes(routesDir, { importModule })

      const servers = await bootstrapServers({ ssr: { port: 20607 } })
      try {
        const res = await fetch('http://localhost:20607/good')
        assertEquals(res.status, 200)
        const html = await res.text()
        assert(html.includes('good-page-ok'))
        // The empty page never became a route — nothing to serve, and nothing should have
        // silently registered something wrong in its place either.
        assertEquals((await fetch('http://localhost:20607/empty')).status, 404)
      } finally {
        await webServerManager.stop(servers)
      }
    } finally {
      await Deno.remove(routesDir, { recursive: true })
    }
  },
)

Deno.test(
  'loadRoutes: two overlapping calls for the same file (mashing Ctrl+S — a second save before ' +
    'the first save finished reloading) never run concurrently, and neither throws',
  async () => {
    const routesDir = await Deno.makeTempDir({ dir: getTemporaryFolder(import.meta.url) })
    try {
      await Deno.writeTextFile(join(routesDir, 'page.tsx'), 'export default null\n')

      let generation = 0
      const importModule = () => {
        generation++
        const marker = `race-gen-${generation}`
        function View() {
          return <p>{marker}</p>
        }
        @Page()
        class RacingPage extends SpacePageController {
          public override component = View
        }
        return Promise.resolve({ default: RacingPage })
      }

      // Deliberately NOT awaited between calls — this is the real bug this covers: before
      // `loadRoutes` serialized its calls, two overlapping calls for the same file each
      // independently reimported it (a genuinely different class each time, exactly like Vite
      // does on a real reimport) and raced to register the same route path, one throwing
      // "already defined" and corrupting `registeredPageTargets` for every later call too. Both
      // must now resolve cleanly.
      const first = loadRoutes(routesDir, { importModule })
      const second = loadRoutes(routesDir, { importModule })
      await Promise.all([first, second])

      const servers = await bootstrapServers({ ssr: { port: 20608 } })
      try {
        const res = await fetch('http://localhost:20608')
        assertEquals(res.status, 200)
        const html = await res.text()
        // Serialized means deterministic: the second call's own body only starts once the
        // first's has fully finished, so its class is the one left registered.
        assert(html.includes('race-gen-2'))
      } finally {
        await webServerManager.stop(servers)
      }

      // The corruption this covers was permanent — a THIRD, later call (any subsequent file
      // change, in the real bug) must still succeed too, not keep re-throwing forever.
      await loadRoutes(routesDir, { importModule })
    } finally {
      await Deno.remove(routesDir, { recursive: true })
    }
  },
)

Deno.test(
  'loadRoutes: mashing Ctrl+S on an EXPLICIT @Page(path) page — several overlapping saves in a ' +
    'row — never throws and ends up serving the latest edit',
  async () => {
    const routesDir = await Deno.makeTempDir({ dir: getTemporaryFolder(import.meta.url) })
    try {
      await Deno.writeTextFile(join(routesDir, 'page.tsx'), 'export default null\n')

      let generation = 0
      const importModule = () => {
        generation++
        const marker = `explicit-race-gen-${generation}`
        function View() {
          return <p>{marker}</p>
        }
        @Page('mashed')
        class MashedPage extends SpacePageController {
          public override component = View
        }
        return Promise.resolve({ default: MashedPage })
      }

      // Five overlapping calls, none awaited before the next fires — the real-world shape of
      // mashing Ctrl+S faster than one reload cycle completes. Combines both fixes at once: the
      // serialized queue (no two bodies run concurrently) and `withPendingReplacement` (each
      // serialized call can still safely evict its OWN file's previous explicit-path registration
      // before re-claiming it, instead of colliding with itself).
      const calls = Array.from({ length: 5 }, () => loadRoutes(routesDir, { importModule }))
      await Promise.all(calls)

      const servers = await bootstrapServers({ ssr: { port: 20611 } })
      try {
        const res = await fetch('http://localhost:20611/mashed')
        assertEquals(res.status, 200)
        const html = await res.text()
        // Deterministic thanks to serialization: the LAST call's own class is the one left
        // registered — and, unlike before this fix, it actually got there instead of leaving the
        // very first boot's content stuck forever.
        assert(html.includes('explicit-race-gen-5'))
      } finally {
        await webServerManager.stop(servers)
      }
    } finally {
      await Deno.remove(routesDir, { recursive: true })
    }
  },
)

Deno.test(
  'loadRoutes: onlyFilePaths scopes reimporting to just the given page(s) — every other ' +
    'discovered page is never even handed to importModule',
  async () => {
    const routesDir = await Deno.makeTempDir({ dir: getTemporaryFolder(import.meta.url) })
    try {
      await Deno.mkdir(join(routesDir, 'a'), { recursive: true })
      await Deno.mkdir(join(routesDir, 'b'), { recursive: true })
      const pageAPath = join(routesDir, 'a', 'page.tsx')
      const pageBPath = join(routesDir, 'b', 'page.tsx')
      await Deno.writeTextFile(pageAPath, 'export default null\n')
      await Deno.writeTextFile(pageBPath, 'export default null\n')

      // Keyed per FILE (never a single shared counter) — `pages.map(...)` in `loadRoutesOnce`
      // imports every page concurrently, so a shared counter's own increment order across A/B
      // would depend on `scanPageFiles`' own directory-walk order, never guaranteed. A per-file
      // generation stays correct and independently assertable regardless of that order.
      const importedFilePaths: string[] = []
      const generationByFile = new Map<string, number>()
      const importModule = (filePath: string) => {
        importedFilePaths.push(filePath)
        const generation = (generationByFile.get(filePath) ?? 0) + 1
        generationByFile.set(filePath, generation)
        const marker = `${filePath}#gen-${generation}`
        function View() {
          return <p>{marker}</p>
        }
        @Page()
        class ScopedPage extends SpacePageController {
          public override component = View
        }
        return Promise.resolve({ default: ScopedPage })
      }

      // First call: unscoped — both pages import normally, exactly like any other boot.
      await loadRoutes(routesDir, { importModule })
      assertEquals(importedFilePaths.sort(), [pageAPath, pageBPath].sort())

      // Second call: scoped to page A alone — page B must never be handed to importModule again,
      // even though `scanPageFiles` itself still discovers it (needed for orphan-cleanup to stay
      // correct — see `LoadRoutesOptions.onlyFilePaths`'s own doc).
      importedFilePaths.length = 0
      await loadRoutes(routesDir, { importModule, onlyFilePaths: [pageAPath] })
      assertEquals(importedFilePaths, [pageAPath])

      const servers = await bootstrapServers({ ssr: { port: 20605 } })
      try {
        // Page A reflects the scoped call's own fresh (2nd) generation...
        const resA = await fetch('http://localhost:20605/a')
        assertEquals(resA.status, 200)
        assert((await resA.text()).includes(`${pageAPath}#gen-2`))

        // ...while page B still serves whatever the FIRST, unscoped call registered (its own 1st
        // generation) — completely untouched by the scoped call, not reset or deregistered.
        const resB = await fetch('http://localhost:20605/b')
        assertEquals(resB.status, 200)
        assert((await resB.text()).includes(`${pageBPath}#gen-1`))
      } finally {
        await webServerManager.stop(servers)
      }
    } finally {
      await Deno.remove(routesDir, { recursive: true })
    }
  },
)
