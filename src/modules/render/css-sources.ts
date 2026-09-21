/**
 * Stylesheets that are not a file of the app — the way a package ships default styles for the
 * screens it owns, since a package has no file an app could list in `globalCss`. Declared through
 * `defineSpaceApp({ cssSources })`.
 *
 * A source is turned into a real file inside the project (`.space/css-sources/{name}.css`) by
 * {@linkcode materializeCssSources}, which `buildSpaceClient` and `createSpaceDevEngine` call before
 * they read the global stylesheet list. From there the file is an ordinary global stylesheet: the
 * client build bundles it and lists it in `css-manifest.json`, and `zanix space dev` serves it like
 * any other. Nothing here knows about a renderer.
 *
 * @module
 */
import { join } from '@std/path'
import { InternalError } from '@zanix/errors'

/**
 * A stylesheet supplied as text.
 */
export type CssSource = {
  /** The file name of the materialized stylesheet: lowercase letters, digits and `-`, starting
   * with a letter or digit. Declaring a name again replaces the earlier declaration. */
  name: string
  /** The stylesheet text, or a function returning it. A function runs each time the sources are
   * materialized, once per build and once per dev start. */
  css: string | (() => string | Promise<string>)
  /** The `media` attribute of the rendered `<link>`, as in a `{ href, media }` `globalCss` entry. */
  media?: string
}

/** Where the materialized files live, relative to the project root. */
export const CSS_SOURCES_DIR = '.space/css-sources'

const NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/

type MaterializedPath = string | { href: string; media: string }

let sources: CssSource[] = []
let materialized: MaterializedPath[] = []

/**
 * Adds `next` to the declared sources — called by `defineSpaceApp({ cssSources })`, eagerly, once
 * per app, so a host composes with the sources a base app declared. A name that is already declared
 * keeps its position and takes the new definition.
 * @throws {InternalError} When a name is not file-name safe: it becomes a path inside the project.
 */
export function addCssSources(next: CssSource[]): void {
  for (const source of next) {
    if (!NAME_PATTERN.test(source.name)) {
      throw new InternalError(
        `Invalid cssSources name '${source.name}': use lowercase letters, digits and '-', ` +
          'starting with a letter or digit.',
        { code: 'SPACE_CSS_SOURCE_INVALID_NAME', meta: { source: 'zanix' } },
      )
    }
  }
  const merged = [...sources]
  for (const source of next) {
    const index = merged.findIndex((existing) => existing.name === source.name)
    if (index === -1) merged.push(source)
    else merged[index] = source
  }
  sources = merged
}

/** The declared sources, in declaration order. */
export function getCssSources(): CssSource[] {
  return sources
}

/** The stylesheet paths of the materialized sources, in declaration order — empty until
 * {@linkcode materializeCssSources} has run. Read through `getGlobalCssPaths`, which puts them
 * ahead of the app's own `globalCss`. */
export function getCssSourcePaths(): MaterializedPath[] {
  return materialized
}

/** Test-only escape hatch — clears the declared sources and the materialized paths. Not exported
 * from this package's public entry points. */
export function resetCssSources(): void {
  sources = []
  materialized = []
}

async function readIfPresent(path: string): Promise<string | undefined> {
  try {
    return await Deno.readTextFile(path)
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return undefined
    throw error
  }
}

/**
 * Writes every declared source to `{root}/.space/css-sources/{name}.css` and registers the paths,
 * so the global stylesheet list starts with them. A file whose content is already on disk is left
 * untouched, which keeps its modification time (and a dev server's watchers) still on a restart.
 *
 * Idempotent: calling it again re-reads the sources and refreshes the registered paths.
 * @param root - The project root, the directory `globalCss` paths resolve against.
 * @throws {InternalError} When a source function throws or a source does not resolve to a string.
 */
export async function materializeCssSources(root: string): Promise<void> {
  if (sources.length === 0) {
    materialized = []
    return
  }

  const dir = join(root, CSS_SOURCES_DIR)
  const paths = await Promise.all(sources.map(async (source): Promise<MaterializedPath> => {
    let css: unknown
    try {
      css = typeof source.css === 'function' ? await source.css() : source.css
    } catch (error) {
      throw new InternalError(`The cssSources entry '${source.name}' failed to produce its CSS.`, {
        code: 'SPACE_CSS_SOURCE_FAILED',
        meta: { source: 'zanix', name: source.name },
        cause: error,
      })
    }
    if (typeof css !== 'string') {
      throw new InternalError(`The cssSources entry '${source.name}' did not produce a string.`, {
        code: 'SPACE_CSS_SOURCE_FAILED',
        meta: { source: 'zanix', name: source.name },
      })
    }

    const file = join(dir, `${source.name}.css`)
    if (await readIfPresent(file) !== css) {
      await Deno.mkdir(dir, { recursive: true })
      await Deno.writeTextFile(file, css)
    }
    const href = `./${CSS_SOURCES_DIR}/${source.name}.css`
    return source.media === undefined ? href : { href, media: source.media }
  }))
  materialized = paths
}
