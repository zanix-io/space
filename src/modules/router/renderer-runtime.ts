/**
 * The one seam a renderer's implementation is installed through — `@zanix/space/react` and
 * `@zanix/space/preact` each call {@linkcode installRendererRuntime} once, at module load, with
 * their own three implementations.
 *
 * **Infrastructure, not configuration.** This module answers "which implementation is loaded in
 * this process", never "which renderer did this project choose" — that question has exactly one
 * answer, `defineSpaceApp({ renderer })`, and it stays that way. The relationship between the two
 * is one-directional and checked: `defineSpaceApp` reads {@linkcode getInstalledRenderer} and fails
 * loudly when the project declared one renderer and imported the other's entry point (or none at
 * all). Importing an entry point therefore cannot silently *become* the configuration, and there is
 * no second place to declare a renderer.
 *
 * **Why installation exists at all.** `@zanix/space` itself must not contain a runtime path that
 * can load React or Preact — not a static import, and not a lazy one with a renderer as fallback.
 * So the core ships the seams (this module and the three registries it writes) and neither
 * implementation; whichever entry point an app imports brings exactly one of them. That is what
 * makes it structurally impossible for a Preact app to evaluate React through this package.
 *
 * Nothing here inspects modules, JSX, or component shapes to guess a renderer. The kind is passed
 * in explicitly by the entry point that owns it.
 *
 * @module
 */
import type { RendererKind } from './active-renderer.ts'
import type { PageRenderer } from './page-renderer-registry.ts'
import { setPageRenderer } from './page-renderer-registry.ts'
import type { NotFoundRenderer } from './not-found-renderer-registry.ts'
import { setNotFoundRenderer } from './not-found-renderer-registry.ts'
import type { CometElementFactory } from '../comets/element-factory.ts'
import { setCometElementFactory } from '../comets/element-factory.ts'

/**
 * Everything one renderer must provide for this framework to render anything at all — the complete
 * set, installed together so a process can never hold a half-configured renderer (a page renderer
 * from one and an element factory from the other).
 */
export type RendererRuntime = {
  /** Renders a page's full document or Orbit fragment. See {@linkcode PageRenderer}. */
  renderPage: PageRenderer
  /** Renders a not-found document. See {@linkcode NotFoundRenderer}. */
  renderNotFound: NotFoundRenderer
  /** This renderer's own `createElement`, used to build a Comet boundary. See
   * {@linkcode CometElementFactory}. */
  createElement: CometElementFactory
}

let installedRenderer: RendererKind | undefined

/**
 * Installs one renderer's implementations. Called once, at module load, by
 * `@zanix/space/react` or `@zanix/space/preact` — never by an app, and never by this package's own
 * core.
 *
 * Idempotent for the same renderer (importing the entry point twice is a no-op). Installing the
 * OTHER renderer over an existing one is allowed and replaces all three implementations together —
 * this package's own test suite renders both renderers in one process, and a real app never does
 * it, because `renderer` selects one for the whole project.
 *
 * @param kind - Which renderer these implementations belong to. Passed explicitly by the entry
 * point; never inferred from the implementations themselves.
 * @param runtime - See {@linkcode RendererRuntime}.
 */
export function installRendererRuntime(kind: RendererKind, runtime: RendererRuntime): void {
  setPageRenderer(runtime.renderPage)
  setNotFoundRenderer(runtime.renderNotFound)
  setCometElementFactory(kind, runtime.createElement)
  installedRenderer = kind
}

/**
 * Which renderer's implementations are installed in this process, or `undefined` when neither entry
 * point has been imported.
 *
 * Read by `defineSpaceApp` to check its own `renderer` against reality, and by this package's own
 * tests. Never read to DECIDE anything — the decision is `defineSpaceApp({ renderer })`'s alone.
 */
export function getInstalledRenderer(): RendererKind | undefined {
  return installedRenderer
}

/** Test-only reset — drops the installed runtime, restoring the state a fresh process starts in. */
export function resetRendererRuntime(): void {
  installedRenderer = undefined
}
