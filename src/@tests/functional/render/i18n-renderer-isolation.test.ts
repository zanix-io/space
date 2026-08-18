import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { dirname, fromFileUrl, join } from '@std/path'
import { getTemporaryFolder } from '@zanix/helpers'

/**
 * The i18n-formatting extension of `renderer-isolation.test.ts`'s own claim: a REAL Preact SSR
 * render, in a real process, using `@zanix/space-ui`'s `IntlProvider`/`useIntl`/`formatMessage` —
 * where `react` and `react-dom/server` cannot be evaluated at all — and the symmetric case for
 * React. Same technique, same reasoning, extended with the one thing `renderer-isolation.test.ts`
 * itself doesn't exercise: a real i18n formatter consuming a mixed (plain string + precompiled
 * AST) catalog while the OTHER renderer stays poisoned.
 *
 * `renderer-isolation.test.ts`'s own `i18n-pipeline-e2e.test.ts` sibling already proves
 * CORRECTNESS (the formatted output is right, on both renderers, via `DocumentSemantics`); this
 * file proves EXCLUSIVITY (the other renderer is never touched) — the two are deliberately
 * different claims, checked differently, not the same test duplicated.
 *
 * `poisonedImportMap`/`runIsolated` below are a deliberate copy of `renderer-isolation.test.ts`'s
 * own file-scoped helpers (not shared/exported anywhere), same convention that file's own doc
 * establishes — extended with two entries neither needed: `@zanix/space-ui`'s narrow `intl`
 * entrypoints and `@formatjs/intl`, both already present in this project's own `deno.jsonc` as
 * TEST-ONLY entries (see that file's own comment for why the FULL `@zanix/space-ui` barrel is
 * deliberately avoided).
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
    prefix: 'space-i18n-renderer-isolation-',
  })
  const path = join(dir, 'import-map.json')
  for (const [key, value] of Object.entries(imports)) {
    // `join()` normalizes `..` segments itself — `../space-ui/src/intl/index.ts` (this project's
    // own TEMP path to its sibling package) resolves correctly relative to ROOT the same way a
    // `./`-prefixed entry does.
    if (value.startsWith('./') || value.startsWith('../')) {
      imports[key] = join(ROOT, value) + (value.endsWith('/') ? '/' : '')
    }
  }
  await Deno.writeTextFile(path, JSON.stringify({ imports }, null, 2))
  return path
}

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
  // directory-scanning discovery cares about the `.test.ts` suffix.
  const scriptPath = join(dirname(mapPath), `i18n-isolation-${poison}.ts`)
  await Deno.writeTextFile(scriptPath, script)
  try {
    const { code, stdout, stderr } = await new Deno.Command(Deno.execPath(), {
      args: [
        'test',
        '--allow-all',
        '--no-check',
        '--min-dep-age=0',
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

/** A complete Preact SSR render using the real i18n formatter, with `react` poisoned. */
const PREACT_SSR_I18N = `
import { createElement } from 'preact'
import { parse } from '@formatjs/icu-messageformat-parser'
import { IntlProvider, useIntl } from '@zanix/space-ui/intl/preact'
import '${ROOT}mod-preact.ts'
import { SpacePageController } from '${ROOT}src/modules/router/space-page-controller.tsx'
import { setPageTree } from '${ROOT}src/modules/router/page-tree-registry.ts'
import { setActiveRenderer } from '${ROOT}src/modules/router/active-renderer.ts'
import { getPageRenderer } from '${ROOT}src/modules/router/page-renderer-registry.ts'
import { mockPageContext } from '${ROOT}src/modules/testing/mod.ts'

setActiveRenderer('preact')

const messages = {
  'home/greet': 'Hello, {name}!',
  'home/cart': parse('{count, plural, one {# item} other {# items}}'),
}

function Inner() {
  const { formatMessage } = useIntl()
  return createElement('main', null,
    createElement('h1', null, formatMessage('home/greet', { name: 'Ada' })),
    createElement('p', null, formatMessage('home/cart', { count: 3 })),
  )
}
function View() {
  return createElement(IntlProvider, { locale: 'en', messages }, createElement(Inner, null))
}

class HomePage extends SpacePageController {
  component = View
  static head = { title: 'Isolated Preact i18n' }
}
setPageTree(HomePage, { filePath: '/routes/page.tsx', segments: [{}] })

Deno.test('preact i18n ssr under a poisoned react', async () => {
  const response = await getPageRenderer()(
    HomePage, View, mockPageContext({}), undefined, false, undefined, undefined,
  )
  const html = await response.text()
  console.log('__RESULT__' + JSON.stringify({ status: response.status, html }))
})
`

/** The mirror image: a complete React SSR render using the real i18n formatter, with `preact`
 * poisoned. */
const REACT_SSR_I18N = `
import { createElement } from 'react'
import { parse } from '@formatjs/icu-messageformat-parser'
import { IntlProvider, useIntl } from '@zanix/space-ui/intl'
import '${ROOT}mod-react.ts'
import { SpacePageController } from '${ROOT}src/modules/router/space-page-controller.tsx'
import { setPageTree } from '${ROOT}src/modules/router/page-tree-registry.ts'
import { setActiveRenderer } from '${ROOT}src/modules/router/active-renderer.ts'
import { getPageRenderer } from '${ROOT}src/modules/router/page-renderer-registry.ts'
import { mockPageContext } from '${ROOT}src/modules/testing/mod.ts'

setActiveRenderer('react')

const messages = {
  'home/greet': 'Hello, {name}!',
  'home/cart': parse('{count, plural, one {# item} other {# items}}'),
}

function Inner() {
  const { formatMessage } = useIntl()
  return createElement('main', null,
    createElement('h1', null, formatMessage('home/greet', { name: 'Ada' })),
    createElement('p', null, formatMessage('home/cart', { count: 3 })),
  )
}
function View() {
  return createElement(IntlProvider, { locale: 'en', messages }, createElement(Inner))
}

class HomePage extends SpacePageController {
  component = View
  static head = { title: 'Isolated React i18n' }
}
setPageTree(HomePage, { filePath: '/routes/page.tsx', segments: [{}] })

Deno.test('react i18n ssr under a poisoned preact', async () => {
  const response = await getPageRenderer()(
    HomePage, View, mockPageContext({}), undefined, false, undefined, undefined,
  )
  const html = await response.text()
  console.log('__RESULT__' + JSON.stringify({ status: response.status, html }))
})
`

function resultOf(stdout: string): { status: number; html: string } {
  const line = stdout.split('\n').find((l) => l.includes('__RESULT__'))
  if (!line) throw new Error(`no result line in subprocess output:\n${stdout}`)
  return JSON.parse(line.slice(line.indexOf('__RESULT__') + '__RESULT__'.length))
}

Deno.test(
  'i18n renderer isolation: a Preact app using IntlProvider/useIntl/formatMessage (with a mixed ' +
    'string+AST catalog) renders a full SSR document with `react`/`react-dom/server` POISONED — ' +
    'the i18n formatter never evaluates React',
  async () => {
    const { code, stdout, stderr } = await runIsolated('react', PREACT_SSR_I18N)

    assertEquals(code, 0, `Preact i18n SSR failed under a poisoned React:\n${stdout}\n${stderr}`)
    assert(
      !stderr.includes('POISONED RENDERER EVALUATED'),
      `React was evaluated during a Preact i18n render:\n${stderr}`,
    )

    const { status, html } = resultOf(stdout)
    assertEquals(status, 200)
    assertStringIncludes(html, '<!doctype html>')
    assertStringIncludes(html, '<title>Isolated Preact i18n</title>')
    // The interpolation AND the precompiled-AST plural both resolved correctly — not an empty
    // shell that would pass the isolation check vacuously.
    assertStringIncludes(html, 'Hello, Ada!')
    assertStringIncludes(html, '3 items')
  },
)

Deno.test(
  'i18n renderer isolation: the symmetric case — a React app using the SAME i18n formatter ' +
    'contract renders a full SSR document with `preact`/`preact-render-to-string` POISONED',
  async () => {
    const { code, stdout, stderr } = await runIsolated('preact', REACT_SSR_I18N)

    assertEquals(code, 0, `React i18n SSR failed under a poisoned Preact:\n${stdout}\n${stderr}`)
    assert(
      !`${stdout}${stderr}`.includes('POISONED RENDERER EVALUATED'),
      `Preact was evaluated during a React i18n render:\n${stdout}\n${stderr}`,
    )

    const { status, html } = resultOf(stdout)
    assertEquals(status, 200)
    assertStringIncludes(html, '<title>Isolated React i18n</title>')
    assertStringIncludes(html, 'Hello, Ada!')
    assertStringIncludes(html, '3 items')
  },
)
