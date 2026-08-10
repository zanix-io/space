// deno-lint-ignore-file no-explicit-any
import * as typedCssModules from 'typed-css-modules'

/** The one method this package actually uses off `typed-css-modules`'s `DtsCreator` — kept
 * narrow and local instead of depending on its own (untyped-for-Deno) declarations. */
interface DtsContent {
  writeFile(): Promise<unknown>
}

// `typed-css-modules` ships CommonJS with `export = DtsCreator` — under Deno's npm interop this
// surfaces as a double-wrapped `default.default`, verified directly (a plain `import DtsCreator
// from '...'` resolves to an object, not a constructor). Isolated here so `css-plugin.ts` itself
// never has to know about this interop quirk.
const DtsCreator = (typedCssModules as any).default.default as new () => {
  create(filePath: string, contents?: string): Promise<DtsContent>
}

const creator = new DtsCreator()

/**
 * Writes a `*.module.css.d.ts` file next to `filePath`, declaring its class names as a
 * default-exported, `export =`-style object — matching this framework's own
 * `import styles from './x.module.css'` convention (never named exports).
 *
 * Deliberately re-reads `filePath` from disk itself (never handed Vite's own `transform`-hook
 * `code` argument) — by the time a `transform` hook not marked `enforce: 'pre'` runs, Vite's own
 * built-in CSS Modules plugin has typically already scoped/hashed the class names in that string,
 * which would make this generate a `.d.ts` keyed by the *hashed* identifiers instead of the real,
 * author-written ones.
 *
 * @param filePath - The `.module.css` file's real path.
 */
export async function writeCssModuleDts(filePath: string): Promise<void> {
  const content = await creator.create(filePath)
  await content.writeFile()
}
