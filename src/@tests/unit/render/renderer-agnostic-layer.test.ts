import { assertEquals } from '@std/assert'
import { dirname, fromFileUrl, resolve } from '@std/path'

/**
 * The common layer — document/head/SEO/PWA/theme/validation — must describe the DOCUMENT, never
 * one renderer's idea of it.
 *
 * `document-model.ts` states that rule in prose, and every module listed below is written to it
 * today. This asserts it instead: for each entry point, the whole closure of this package's OWN
 * modules reachable from it must contain no `react`/`preact` import at all — not a value import,
 * not a type import, not through a re-export three files deep. A type-only import counts, on
 * purpose: it disappears at runtime but it is exactly how a renderer's vocabulary gets into a
 * shared model in the first place. Both of the cases that proved it are now closed and on the list
 * below: `RenderToResponseOptions` once described PWA head data for both renderers, and
 * `LayoutProps` once defaulted its children type to React's own `ReactNode` (it now defaults to
 * `SpaceChildren`, `typings/renderable.ts`).
 *
 * What this is NOT: a check that any given module "is React" or "is Preact". Nothing here inspects
 * JSX, component shapes, file names or exports — this framework performs no renderer detection
 * anywhere, by design (see `renderer-invariant.test.ts`). This reads import specifiers of a FIXED,
 * hand-listed set of modules, each of which is on the list because its own doc says it belongs to
 * the renderer-agnostic layer.
 *
 * The renderer boundaries themselves are deliberately absent from the list. `render-page-react.tsx`,
 * `render-page-preact.ts`, `render-to-response*.ts(x)`, `document-shell*`, `error-boundary*`,
 * `hydrate-comets*` and `request-cache.tsx` are all SUPPOSED to import a renderer — that is what
 * makes them boundaries — as are the two registries that hold React's eager default
 * (`page-renderer-registry.ts`, `not-found-renderer-registry.ts`).
 *
 * @module
 */

const SRC = resolve(fromFileUrl(import.meta.resolve('../../../')), '.')

/** Every module whose own doc places it in the renderer-agnostic layer. */
const AGNOSTIC_ENTRY_POINTS = [
  // The public entry points themselves. `.` ships no renderer implementation at all since the
  // entry-point split, and the three build/dev/test entries never did conceptually — they only
  // reached one through the registries' old eager React defaults.
  '../mod.ts',
  'modules/bundler/mod.ts',
  'modules/dev/mod.ts',
  'modules/testing/mod.ts',
  // The document model itself, and everything that serializes or compares it without rendering.
  'modules/render/document-model.ts',
  'modules/render/document-semantics.ts',
  'modules/render/head-markup.ts',
  'modules/render/css-manifest.ts',
  'modules/render/initial-state-global.ts',
  'modules/render/read-initial-state.ts',
  // Head resolution and the registries that deliberately hold components as `unknown`.
  'modules/router/head-descriptor.ts',
  'modules/router/app-shell-registry.ts',
  'modules/router/active-renderer.ts',
  'modules/router/orbit-protocol.ts',
  // The Comet marker protocol and manifest (the boundary FORMAT, shared by both renderers).
  'modules/comets/marker.ts',
  'modules/comets/comet-manifest.ts',
  // Document-adjacent capabilities: none of these is a rendering concern.
  'modules/seo/mod.ts',
  'modules/pwa/mod.ts',
  'modules/theme/mod.ts',
  'modules/validation/validate-document.ts',
  'modules/validation/validate-html.ts',
  'modules/i18n/load-messages.ts',
  'modules/middleware/mod.ts',
  'modules/assets/assets-manifest.ts',
  // Client-side runtime shared by both barrels (`mod.ts` and `mod-preact.ts` re-export all of it).
  'modules/client/orbit.ts',
  'modules/client/prefetch.ts',
  'modules/client/schedule-comet-hydration.ts',
  'modules/client/comet-persistence.ts',
  'modules/client/hydrator-registry.ts',
  // The dev transport, corrected once already from a wrongly renderer-scoped shape.
  'modules/dev/dev-client-script.ts',
  // Public typings that describe framework/document concepts. `page.ts` is on this list only
  // BECAUSE the two React defaults it and `space-page-controller.tsx` used to carry are gone —
  // `LayoutProps<TChildren = SpaceChildren>` and `SpacePageController<..., TComponent =
  // SpaceComponent | null>` — so the page contract itself no longer names a renderer.
  'typings/page.ts',
  'typings/renderable.ts',
  'typings/comet.ts',
  'typings/pwa.ts',
]

const RENDERER_SPECIFIER = /^(react|preact)(-dom|-render-to-string)?(\/|$)/

/** Every import/export specifier in a source file, in source order, each marked `type` when the
 * statement is type-only (`import type ...` / `import { type X }`) and therefore erased before
 * anything runs. */
function specifiersOf(source: string): { specifier: string; typeOnly: boolean }[] {
  const found: { specifier: string; typeOnly: boolean }[] = []
  // Comments first: this package documents itself with real code samples, and several of them
  // contain `import ... from './logo.svg'`-style lines that are prose, not edges. Matching them
  // would make the scan chase files that do not exist and — worse — could invent a renderer edge
  // out of an example.
  source = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\n)\s*\/\/[^\n]*/g, '$1')
  const pattern = /(?:^|\n)\s*(?:import|export)([\s\S]*?)from\s*['"]([^'"]+)['"]/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(source)) !== null) {
    found.push({ specifier: match[2], typeOnly: /^\s*type\b|\btype\s*\{/.test(match[1]) })
  }
  return found
}

/** This package's own modules reachable from `entry`, plus every renderer specifier found on the
 * way. Bare specifiers other than a renderer's (`@zanix/*`, `@std/*`, `vite`, ...) are not
 * followed — this asserts what THIS package's own code imports, not what its dependencies do. */
function scan(
  entry: string,
): { modules: string[]; rendererImports: string[]; evaluatedRendererImports: string[] } {
  const seen = new Set<string>()
  const rendererImports: string[] = []
  const evaluatedRendererImports: string[] = []
  // Each queued file carries whether EVERY edge on the path that reached it was a value import.
  // Only such a path actually evaluates what it reaches; the moment one `import type` is crossed,
  // nothing further down that path exists at runtime at all.
  const queue: { file: string; evaluated: boolean }[] = [{
    file: resolve(SRC, entry),
    evaluated: true,
  }]

  while (queue.length > 0) {
    const { file, evaluated } = queue.pop() as { file: string; evaluated: boolean }
    const key = `${file}#${evaluated}`
    if (seen.has(key)) continue
    seen.add(key)

    const source = Deno.readTextFileSync(file)
    for (const { specifier, typeOnly } of specifiersOf(source)) {
      const stillEvaluated = evaluated && !typeOnly
      if (RENDERER_SPECIFIER.test(specifier)) {
        const hit = `${file.replace(`${SRC}/`, '')} → ${specifier}`
        rendererImports.push(hit)
        if (stillEvaluated) evaluatedRendererImports.push(hit)
        continue
      }
      // Only this package's own TypeScript modules are followed. A `.css`/`.svg` specifier is a
      // real asset import, not a module that could reach a renderer.
      if (!/\.tsx?$/.test(specifier)) continue
      if (specifier.startsWith('.')) {
        queue.push({ file: resolve(dirname(file), specifier), evaluated: stillEvaluated })
      } else if (specifier.startsWith('modules/') || specifier.startsWith('typings/')) {
        queue.push({ file: resolve(SRC, specifier), evaluated: stillEvaluated })
      }
    }
  }

  return {
    modules: [...new Set([...seen].map((k) => k.slice(0, k.lastIndexOf('#'))))],
    rendererImports: [...new Set(rendererImports)],
    evaluatedRendererImports: [...new Set(evaluatedRendererImports)],
  }
}

Deno.test(
  'the renderer-agnostic layer imports neither React nor Preact — directly or through any of ' +
    "this package's own modules it reaches",
  () => {
    const violations: string[] = []
    for (const entry of AGNOSTIC_ENTRY_POINTS) {
      const { modules, rendererImports } = scan(entry)
      // A scan that reached nothing would pass vacuously — every entry must resolve to at least
      // the file itself, and the multi-module ones must really have been walked.
      assertEquals(modules.length >= 1, true, `${entry}: nothing scanned`)
      violations.push(...rendererImports.map((v) => `[${entry}] ${v}`))
    }

    assertEquals(
      violations,
      [],
      `renderer-agnostic modules must not reach React or Preact:\n${violations.join('\n')}`,
    )
  },
)

/**
 * The renderer entry points: each brings its OWN renderer and only its own.
 *
 * This is the other half of the split's contract. `.` containing no renderer would be worthless if
 * `@zanix/space/react` did not actually install React, or if `@zanix/space/preact` dragged React in
 * anyway — an app would then be back to evaluating both. Asserted on value edges, since that is
 * what "evaluates" means, and on the absence of the OTHER renderer through any edge at all.
 */
Deno.test(
  '@zanix/space/react reaches React, and never Preact',
  () => {
    const { evaluatedRendererImports, rendererImports } = scan('../mod-react.ts')

    const react = evaluatedRendererImports.filter((hit) => /→ react/.test(hit))
    const preact = rendererImports.filter((hit) => /→ preact/.test(hit))

    assertEquals(react.length > 0, true, 'expected @zanix/space/react to evaluate React')
    assertEquals(
      evaluatedRendererImports.some((hit) => hit.includes('react-dom/server')),
      true,
      'expected the React entry point to carry the streaming serializer',
    )
    assertEquals(preact, [], `@zanix/space/react must not reach Preact:\n${preact.join('\n')}`)
  },
)

Deno.test(
  '@zanix/space/preact reaches Preact, and never React',
  () => {
    const { evaluatedRendererImports, rendererImports } = scan('../mod-preact.ts')

    const preact = evaluatedRendererImports.filter((hit) => /→ preact/.test(hit))
    const react = rendererImports.filter((hit) => /→ react(-dom)?(\/|$)/.test(hit))

    assertEquals(preact.length > 0, true, 'expected @zanix/space/preact to evaluate Preact')
    assertEquals(react, [], `@zanix/space/preact must not reach React:\n${react.join('\n')}`)
  },
)

Deno.test(
  'the same scan DOES flag a renderer boundary — proof the check can fail, rather than passing ' +
    'because it never looks at anything',
  () => {
    // `render-to-response.tsx` is a React boundary by design; if this ever came back empty, the
    // scan above would be worthless.
    const { rendererImports } = scan('modules/render/render-to-response.tsx')
    assertEquals(rendererImports.length > 0, true)

    assertEquals(
      scan('modules/render/render-to-response.tsx').evaluatedRendererImports.length > 0,
      true,
    )

    const preact = scan('modules/render/render-to-response-preact.ts')
    assertEquals(preact.rendererImports.length > 0, true)
    assertEquals(preact.evaluatedRendererImports.length > 0, true)
  },
)
