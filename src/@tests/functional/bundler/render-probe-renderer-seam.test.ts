// Installs React, exactly as a real React application does. The no-runtime case below therefore
// HAS to run in a subprocess — see this module's own doc.
import '../../../../mod-react.ts'
import { assertEquals, assertStringIncludes } from '@std/assert'
import { fromFileUrl, join } from '@std/path'
import { getTemporaryFolder } from '@zanix/helpers'
import { runRenderProbe } from 'modules/bundler/mod.ts'
import type { DiscoveredPage } from 'modules/bundler/mod.ts'
import { SpacePageController } from 'modules/router/mod.ts'
import { setPageTree } from 'modules/router/page-tree-registry.ts'

/**
 * How `runRenderProbe` obtains a renderer — the one seam between a build tool and the renderer an
 * application chose.
 *
 * The rule it encodes: **the application decides, the build tool obeys.** A project declares its
 * renderer once (`defineSpaceApp({ renderer })`) and installs it once (`@zanix/space/react` or
 * `@zanix/space/preact`); the probe reads whatever that produced. Passing `renderPage` explicitly
 * exists for isolation only — this file itself needs it, since one process cannot have two
 * renderers installed at once. Nothing here inspects anything to guess a renderer, and
 * `@zanix/space/vite` exposes no way to reach into the registry.
 *
 * The no-runtime case runs in a SUBPROCESS on purpose: "no renderer installed" is process-wide
 * state, and any test file that imported an entry point — directly or through a fixture — would
 * quietly make it unobservable. Asserting it in-process would be asserting nothing.
 *
 * @module
 */

const ROOT = fromFileUrl(import.meta.resolve('../../../../'))

function View() {
  return null
}

class ProbePage extends SpacePageController {
  public override component = View
}
setPageTree(ProbePage, { filePath: '/routes/page.tsx', segments: [{}] })

// A complete `DiscoveredPage`, as `discoverPages` really reports one. `routePath` carries no
// leading slash (the probe builds the URL as `/${routePath}`), and `head`/`layoutHeads` are present
// because the probe reads them to compare the declared head against the rendered document.
const PAGES: DiscoveredPage[] = [{
  routePath: 'home',
  filePath: '/routes/home/page.tsx',
  styles: [],
  head: { title: 'Probed', meta: [], link: [] },
  headIsDynamic: false,
  hasUnconditionalRedirect: false,
  layoutHeads: [],
}]

const loadPage = () => Promise.resolve({ Target: ProbePage, Component: View })

Deno.test(
  'render probe seam [1/5]: an explicitly injected `renderPage` is the one used — verbatim, with ' +
    'no registry lookup at all',
  async () => {
    let called = 0
    const result = await runRenderProbe({
      pages: PAGES,
      loadPage,
      renderPage: () => {
        called++
        return Promise.resolve(
          new Response(
            '<!doctype html><html lang="en"><head><title>t</title></head><body><h1>x</h1></body></html>',
            {
              headers: { 'content-type': 'text/html' },
            },
          ),
        )
      },
    })

    assertEquals(called, 1)
    assertEquals(result.probed, ['home'])
  },
)

/** Runs a probe in a subprocess with the given renderer entry point imported (or none). */
async function probeInSubprocess(
  entry: 'react' | 'preact' | 'none',
): Promise<{ code: number; stdout: string; stderr: string }> {
  const install = entry === 'none' ? '' : `import '${ROOT}mod-${entry}.ts'\n`
  // `deno-coverage-ignore-file`: this script exists only to run in a fresh subprocess — it is not
  // project source, and it would otherwise show up as a spurious, low-signal row in the coverage
  // report.
  const script = `// deno-coverage-ignore-file
${install}
import { runRenderProbe } from '${ROOT}src/modules/bundler/mod.ts'
import { SpacePageController } from '${ROOT}mod.ts'
import { setPageTree } from '${ROOT}src/modules/router/page-tree-registry.ts'
import { setActiveRenderer } from '${ROOT}src/modules/router/active-renderer.ts'

setActiveRenderer(${entry === 'preact' ? "'preact'" : "'react'"})

function View() { return null }
class ProbePage extends SpacePageController { component = View; static head = { title: 'Probed' } }
setPageTree(ProbePage, { filePath: '/routes/page.tsx', segments: [{}] })

// NO \`renderPage\`: whatever this process installed is what the probe must use.
const result = await runRenderProbe({
  pages: [{
    routePath: 'home',
    filePath: '/routes/home/page.tsx',
    styles: [],
    head: { title: 'Probed', meta: [], link: [] },
    headIsDynamic: false,
    hasUnconditionalRedirect: false,
    layoutHeads: [],
  }],
  loadPage: () => Promise.resolve({ Target: ProbePage, Component: View }),
})
console.log(JSON.stringify({ probed: result.probed, skipped: result.skipped.length }))
`
  // Generated under this file's own, git-ignored `__tmp__` (see `.gitignore`, and
  // `getTemporaryFolder`'s own doc — same helper this project's other tests already use for a
  // real-filesystem fixture), not the OS temp dir, so it stays discoverable/inspectable in the
  // repo tree rather than scattered under `/var/folders/...` — and is removed again below, so
  // nothing accumulates across runs.
  const dir = await Deno.makeTempDir({
    dir: getTemporaryFolder(import.meta.url),
    prefix: 'probe-seam-',
  })
  try {
    const path = join(dir, 'probe.ts')
    await Deno.writeTextFile(path, script)
    const { code, stdout, stderr } = await new Deno.Command(Deno.execPath(), {
      args: [
        'run',
        '--allow-all',
        '--no-check',
        '--min-dep-age=0',
        '--config',
        join(ROOT, 'deno.jsonc'),
        path,
      ],
      cwd: ROOT,
    }).output()
    return {
      code,
      stdout: new TextDecoder().decode(stdout),
      stderr: new TextDecoder().decode(stderr),
    }
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
}

Deno.test(
  'render probe seam [2/5]: `renderPage` omitted with @zanix/space/react installed resolves the ' +
    "installed renderer — the application's own choice, obeyed, with no registry access from the CLI",
  async () => {
    // In-process, and deliberately without rendering: this file imports `@zanix/space/react` at the
    // top, and the probe resolves the renderer ONCE before its loop. A route whose `loadPage`
    // returns `undefined` is skipped, so the resolution is what is under test here, not React's
    // streaming serializer (whose real output is covered by `render-probe.test.tsx`'s own React
    // cases). The Preact counterpart below does render for real, in a subprocess.
    const result = await runRenderProbe({
      pages: PAGES,
      loadPage: () => Promise.resolve(undefined),
    })

    assertEquals(result.probed, [])
    // Skipped for the reason the fixture chose (nothing to load), NOT for a missing renderer: the
    // resolution above already succeeded, which is the whole point of this case.
    assertEquals(result.skipped.length, 1)
    assertStringIncludes(result.skipped[0], 'could not be loaded')
  },
)

Deno.test(
  'render probe seam [3/5]: the same call with @zanix/space/preact installed probes through ' +
    'Preact — symmetric, and the CLI does not change a line between the two',
  async () => {
    const { code, stdout, stderr } = await probeInSubprocess('preact')
    assertEquals(code, 0, `Preact probe failed:\n${stderr}`)
    assertEquals(JSON.parse(stdout.trim()).probed, ['home'])
  },
)

Deno.test(
  'render probe seam [4/5]: `renderPage` omitted with NO runtime installed fails with the same ' +
    'actionable InternalError every other consumer gets — never a silent React fallback',
  async () => {
    const { stdout, stderr } = await probeInSubprocess('none')

    // Asserted on the reported error, not on the exit code: `@zanix/errors` reports an
    // `InternalError` through its own logger, and the process's exit status is that library's
    // contract, not this seam's. What this seam owes the caller is a specific, actionable failure
    // instead of a silently React-rendered build — that is what is checked here.
    assertStringIncludes(stderr, 'No renderer is installed')
    assertStringIncludes(stderr, '@zanix/space/react')
    assertStringIncludes(stderr, '@zanix/space/preact')
    // And nothing was probed: the failure happens before any route is rendered.
    assertEquals(stdout.trim(), '')
  },
)

Deno.test(
  'render probe seam [5/5]: `@zanix/space/vite` exposes NO way to reach the renderer registry — ' +
    'the CLI can run the probe without ever touching internal state',
  async () => {
    const vite = await import('modules/bundler/mod.ts')
    const exported = Object.keys(vite)

    // The seam is `runRenderProbe` itself. Anything that would let a caller read or write the
    // registry directly is deliberately absent.
    assertEquals(exported.includes('runRenderProbe'), true)
    for (const forbidden of ['getPageRenderer', 'setPageRenderer', 'getInstalledPageRenderer']) {
      assertEquals(
        exported.includes(forbidden),
        false,
        `@zanix/space/vite must not export '${forbidden}'`,
      )
    }
    // The graph half of this contract (0 value edges from /vite to either renderer) is asserted in
    // `unit/render/renderer-agnostic-layer.test.ts`, which owns every entry point's graph.
  },
)
