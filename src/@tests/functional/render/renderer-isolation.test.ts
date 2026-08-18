import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { dirname, fromFileUrl, join } from '@std/path'
import { getTemporaryFolder } from '@zanix/helpers'

/**
 * The strongest statement this package can make about the entry-point split, and the reason it
 * exists: a REAL Preact SSR render, in a real process, where `react` and `react-dom/server` cannot
 * be evaluated at all — and the symmetric case for React.
 *
 * How: the subprocess runs with an import map whose `react`/`react-dom` entries point at
 * `support/poison-renderer.ts`, a module that throws on evaluation. Resolution still succeeds, so
 * nothing is hidden; only EVALUATION fails. The render then either completes (proving the
 * framework never touched React) or the process dies naming the module that was loaded. There is no
 * way to pass this test by asserting something weaker — the evidence is the process itself.
 *
 * This is deliberately not a graph test. `renderer-agnostic-layer.test.ts` reads import edges and
 * would miss a dynamic `import()` reintroduced anywhere; this runs the real thing.
 *
 * **Both directions are exercised, and the subprocess runs `deno test`, not `deno run`.** That is
 * not cosmetic: a bare `deno run` of React's STREAMING SSR path does not terminate in this
 * environment — reduced to a framework-free script (`renderToReadableStream` +
 * `new Response(stream).text()`) it hangs identically, with no `@zanix/space` code involved at all.
 * Under `deno test` the very same render completes in ~200ms. So the runner is the fix for that
 * environment quirk, and neither renderer's case has to be weakened or dropped.
 *
 * @module
 */

const ROOT = fromFileUrl(import.meta.resolve('../../../../'))

/** The project's own import map, with one renderer's packages redirected to the poison module. */
async function poisonedImportMap(poison: 'react' | 'preact'): Promise<string> {
  const raw = await Deno.readTextFile(join(ROOT, 'deno.jsonc'))
  const config = JSON.parse(raw.replace(/(^|\s)\/\/[^\n]*/g, '')) as {
    imports: Record<string, string>
  }
  const imports = { ...config.imports }
  // Sub-path specifiers this package's own JSX needs. A flat import map does not cover them via
  // their package entry, and `--import-map` replaces the config's `imports` wholesale — so the ones
  // that must keep WORKING are restated here, and the ones being poisoned are overwritten below.
  imports['react/jsx-runtime'] = 'npm:react@^19.2.0/jsx-runtime'
  imports['react-dom/server'] = 'npm:react-dom@^19.2.0/server'
  imports['react-dom/client'] = 'npm:react-dom@^19.2.0/client'
  imports['preact/jsx-runtime'] = 'npm:preact@^10.29.0/jsx-runtime'
  imports['preact/hooks'] = 'npm:preact@^10.29.0/hooks'
  const poisonUrl = `./src/@tests/support/poison-renderer.ts`
  const targets = poison === 'react'
    ? ['react', 'react-dom', 'react-dom/server', 'react-dom/client', 'react/jsx-runtime']
    : ['preact', 'preact-render-to-string', 'preact/hooks', 'preact/jsx-runtime']
  for (const specifier of targets) imports[specifier] = poisonUrl

  const dir = await Deno.makeTempDir({
    dir: getTemporaryFolder(import.meta.url),
    prefix: 'space-renderer-isolation-',
  })
  const path = join(dir, 'import-map.json')
  // `imports` only — the map is resolved relative to ITS own location, so every relative value has
  // to keep working from the temp dir; they are all bare or npm:/jsr: specifiers except the ones
  // rewritten below, which are made absolute for exactly that reason.
  for (const [key, value] of Object.entries(imports)) {
    // Trailing slash preserved: `"modules/": "./src/modules/"` is a PREFIX mapping, and an import
    // map rejects a prefix target that does not end in `/`.
    if (value.startsWith('./')) {
      imports[key] = join(ROOT, value.slice(2)) + (value.endsWith('/') ? '/' : '')
    }
  }
  await Deno.writeTextFile(path, JSON.stringify({ imports }, null, 2))
  return path
}

/** Runs `script` as a TEST file in a subprocess under the poisoned map, returning its output. */
async function runIsolated(
  poison: 'react' | 'preact',
  script: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const mapPath = await poisonedImportMap(poison)
  // Deliberately NOT named `*.test.ts` — `getTemporaryFolder` roots this file's own `__tmp__`
  // INSIDE `src/@tests/functional/render/`, which this project's own `deno.jsonc` test glob
  // (`src/@tests/**/*.test.ts`) matches; a `.test.ts`-suffixed file there would be visible to the
  // OUTER `deno test` run this file is itself running under, racing it against the isolated
  // subprocess spawned below. The subprocess's own `deno test <scriptPath>` invocation runs
  // whichever `Deno.test()` calls a file contains regardless of its name — only *implicit*,
  // directory-scanning discovery cares about the `.test.ts` suffix. Its imports stay absolute
  // regardless of where this file lives.
  const scriptPath = join(dirname(mapPath), `isolation-${poison}.ts`)
  await Deno.writeTextFile(scriptPath, script)
  try {
    const { code, stdout, stderr } = await new Deno.Command(Deno.execPath(), {
      args: [
        // `test`, not `run` — see this module's own doc: React's streaming SSR never terminates
        // under a bare `deno run` in this environment, and does under `deno test`.
        'test',
        '--allow-all',
        '--no-check',
        '--min-dep-age=0',
        // BOTH: the project's own config still supplies `nodeModulesDir`/`compilerOptions` (without
        // it, npm sub-path specifiers like `react/jsx-runtime` stop resolving at all), while the
        // flag's map overrides `imports` — which is exactly the one thing being poisoned.
        '--config',
        join(ROOT, 'deno.jsonc'),
        `--import-map=${mapPath}`,
        scriptPath,
      ],
      cwd: ROOT,
    }).output()
    return {
      code,
      stdout: new TextDecoder().decode(stdout),
      stderr: new TextDecoder().decode(stderr),
    }
  } finally {
    await Deno.remove(scriptPath).catch(() => {})
  }
}

/** A complete Preact SSR render, written the way a real app writes it. */
const PREACT_SSR = `
import { createElement } from 'preact'
import '${ROOT}mod-preact.ts'
import { defineComet } from '${ROOT}src/modules/comets/define-comet.ts'
import { SpacePageController } from '${ROOT}src/modules/router/space-page-controller.tsx'
import { setPageTree } from '${ROOT}src/modules/router/page-tree-registry.ts'
import { setActiveRenderer } from '${ROOT}src/modules/router/active-renderer.ts'
import { getPageRenderer } from '${ROOT}src/modules/router/page-renderer-registry.ts'
import { mockPageContext } from '${ROOT}src/modules/testing/mod.ts'

setActiveRenderer('preact')

function Widget({ label }) {
  return createElement('span', null, 'widget:' + label)
}
const WidgetComet = defineComet(Widget, 'file:///comets/widget.tsx')

function View() {
  return createElement('main', null,
    createElement('h1', null, 'Preact SSR'),
    createElement(WidgetComet, { label: 'a', comet: 'none' }),
  )
}

class HomePage extends SpacePageController {
  component = View
  static head = { title: 'Isolated Preact' }
}
setPageTree(HomePage, { filePath: '/routes/page.tsx', segments: [{}] })

Deno.test('preact ssr under a poisoned react', async () => {
  const response = await getPageRenderer()(
    HomePage, View, mockPageContext({}), undefined, false, undefined, undefined,
  )
  const html = await response.text()
  console.log('__RESULT__' + JSON.stringify({ status: response.status, html }))
})
`

/** The mirror image: a complete React SSR render with Preact poisoned. Streaming, which is exactly
 * why the subprocess runs `deno test` — see this module's own doc. */
const REACT_SSR = `
import { createElement } from 'react'
import '${ROOT}mod-react.ts'
import { SpacePageController } from '${ROOT}src/modules/router/space-page-controller.tsx'
import { setPageTree } from '${ROOT}src/modules/router/page-tree-registry.ts'
import { setActiveRenderer } from '${ROOT}src/modules/router/active-renderer.ts'
import { getPageRenderer } from '${ROOT}src/modules/router/page-renderer-registry.ts'
import { mockPageContext } from '${ROOT}src/modules/testing/mod.ts'

setActiveRenderer('react')

function View() {
  return createElement('main', null, createElement('h1', null, 'React SSR'))
}

class HomePage extends SpacePageController {
  component = View
  static head = { title: 'Isolated React' }
}
setPageTree(HomePage, { filePath: '/routes/page.tsx', segments: [{}] })

Deno.test('react ssr under a poisoned preact', async () => {
  const response = await getPageRenderer()(
    HomePage, View, mockPageContext({}), undefined, false, undefined, undefined,
  )
  const html = await response.text()
  console.log('__RESULT__' + JSON.stringify({ status: response.status, html }))
})
`

/** Pulls the single JSON line the subprocess test printed. */
function resultOf(stdout: string): { status: number; html: string } {
  const line = stdout.split('\n').find((l) => l.includes('__RESULT__'))
  if (!line) throw new Error(`no result line in subprocess output:\n${stdout}`)
  return JSON.parse(line.slice(line.indexOf('__RESULT__') + '__RESULT__'.length))
}

Deno.test(
  'renderer isolation: a Preact app renders a full SSR document with `react` and ' +
    '`react-dom/server` POISONED — the framework never evaluates React',
  async () => {
    const { code, stdout, stderr } = await runIsolated(
      'react',
      PREACT_SSR,
    )

    assertEquals(code, 0, `Preact SSR failed under a poisoned React:\n${stdout}\n${stderr}`)
    assert(
      !stderr.includes('POISONED RENDERER EVALUATED'),
      `React was evaluated during a Preact render:\n${stderr}`,
    )

    const { status, html } = resultOf(stdout)
    assertEquals(status, 200)
    // A real document, really rendered — not an empty shell that would pass vacuously.
    assertStringIncludes(html, '<!doctype html>')
    assertStringIncludes(html, '<title>Isolated Preact</title>')
    assertStringIncludes(html, 'Preact SSR')
    // ...including a Comet boundary, whose element factory is the other half of the split.
    assertStringIncludes(html, 'widget:a')
  },
)

Deno.test(
  'renderer isolation: a React app renders a full SSR document with `preact` and ' +
    '`preact-render-to-string` POISONED — the framework never evaluates Preact either',
  async () => {
    const { code, stdout, stderr } = await runIsolated('preact', REACT_SSR)

    assertEquals(code, 0, `React SSR failed under a poisoned Preact:\n${stdout}\n${stderr}`)
    assert(
      !`${stdout}${stderr}`.includes('POISONED RENDERER EVALUATED'),
      `Preact was evaluated during a React render:\n${stdout}\n${stderr}`,
    )

    const { status, html } = resultOf(stdout)
    assertEquals(status, 200)
    assertStringIncludes(html, '<title>Isolated React</title>')
    assertStringIncludes(html, 'React SSR')
  },
)

Deno.test(
  'renderer isolation: the poison really fires — importing the poisoned renderer directly kills ' +
    'the process, so the two cases above cannot pass by accident',
  async () => {
    const { code, stdout, stderr } = await runIsolated(
      'react',
      `import 'react'\nDeno.test('unreachable', () => {})`,
    )

    assert(code !== 0, 'expected the poisoned module to fail the subprocess')
    // Both streams: under `deno test` a module-load failure is reported in the test output (stdout)
    // rather than on stderr, which carries only the runner's own summary line.
    assertStringIncludes(`${stdout}${stderr}`, 'POISONED RENDERER EVALUATED')
  },
)
