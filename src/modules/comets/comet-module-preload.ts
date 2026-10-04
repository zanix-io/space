import { getActiveRenderer } from '../router/active-renderer.ts'
import type { RendererKind } from '../router/active-renderer.ts'

/**
 * Asks the active renderer to preload some module URLs while a Comet boundary renders, and returns
 * the elements the boundary must render for it (`[]` when the renderer asked by itself).
 *
 * One slot per renderer, resolved by `getActiveRenderer()` at render time, like
 * `comet-id-scope.ts`: this package never loads React or Preact itself. The two renderers differ
 * on purpose. React hoists a `preloadModule()` call into `<head>`, after the stylesheets, and links
 * a given URL once however many comets ask; it returns no element. Preact has no hoisting: it
 * returns a `<link rel="modulepreload">` element for each URL, and the response drops the repeats
 * (`dedupeModulePreloadLinks`).
 */
export type CometModulePreloader = (hrefs: readonly string[]) => unknown[]

const PRELOADERS_KEY = '__znx_comet_module_preloaders__'

function getPreloaders(): { react?: CometModulePreloader; preact?: CometModulePreloader } {
  const globalObject = globalThis as Record<string, unknown>
  if (!globalObject[PRELOADERS_KEY]) globalObject[PRELOADERS_KEY] = {}
  return globalObject[PRELOADERS_KEY] as {
    react?: CometModulePreloader
    preact?: CometModulePreloader
  }
}

/** Registers one renderer's preloader, from `installRendererRuntime`. */
export function setCometModulePreloader(kind: RendererKind, preloader: CometModulePreloader): void {
  getPreloaders()[kind] = preloader
}

/**
 * The elements a Comet boundary renders to preload `hrefs` with the active renderer: `[]` when
 * there is nothing to preload, or when no preloader is installed (an older runtime, a test that
 * installs none), never an error.
 */
export function preloadCometModules(hrefs: readonly string[]): unknown[] {
  if (hrefs.length === 0) return []
  return getPreloaders()[getActiveRenderer()]?.(hrefs) ?? []
}

/** Test-only reset. */
export function resetCometModulePreloaders(): void {
  delete getPreloaders().react
  delete getPreloaders().preact
}
