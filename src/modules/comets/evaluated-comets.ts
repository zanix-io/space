/**
 * The source URL of every Comet module this process has evaluated, recorded by `defineComet` at
 * the moment a comet's own module runs.
 *
 * A production build needs every Comet a page can render as its own entry, and cannot know them
 * from the app's own source alone: a Comet that ships inside a dependency is often reached only
 * through that dependency's own view (`@zanix/iam`'s `LoginEntryView` renders its `LoginTwoStep`),
 * and not by a JSX element the app writes (the dependency injects it, or calls the element factory
 * directly). A dependency's Comet is a default export (`export default defineComet(...)`), which a
 * scan for named, JSX-rendered imports never sees either. The build already imports every page and
 * layout to read their `styles`, so every Comet module in their static import graph has run its own
 * `defineComet` by then: reading what ran is exact where a scan of the source text can only guess.
 *
 * The registry lives on `globalThis` under a `Symbol.for` key, not in a module-level variable: the
 * build tool and the app can each load their own copy of this package, and one registry has to
 * serve both. A module imported through a rewritten temporary copy (what `zanix space build` does
 * for the project's own local files) reports the temporary URL, which says nothing about the real
 * file: `discoverEvaluatedComets` leaves those out.
 *
 * It holds nothing but strings, has no imports, and costs one `Set.add` per Comet defined, so the
 * browser bundle and the server runtime pay nothing worth measuring for it.
 *
 * @module
 */

const EVALUATED_COMETS_KEY = Symbol.for('@zanix/space/evaluated-comets')

function registry(): Set<string> {
  const holder = globalThis as unknown as Record<symbol, Set<string> | undefined>
  return holder[EVALUATED_COMETS_KEY] ??= new Set<string>()
}

/**
 * Records that the Comet module at `sourceUrl` ran its own `defineComet`. Called by `defineComet`
 * with the `import.meta.url` it was given; an app never calls it.
 */
export function recordEvaluatedComet(sourceUrl: string): void {
  registry().add(sourceUrl)
}

/** Every Comet module URL recorded so far, in the order they ran. */
export function getEvaluatedCometUrls(): string[] {
  return [...registry()]
}

/** Forgets every recorded URL. Tests call it to start from a known state. */
export function resetEvaluatedComets(): void {
  registry().clear()
}
