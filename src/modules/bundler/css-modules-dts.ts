import postcss from 'postcss'
import postcssModules from 'postcss-modules'

/**
 * Writes a `*.module.css.d.ts` file next to `filePath`, declaring its class names as a
 * default-exported, `export =`-style object — matching this framework's own
 * `import styles from './x.module.css'` convention (never named exports).
 *
 * Runs the CSS through `postcss-modules` itself rather than depending on `typed-css-modules`
 * (last published Jan 2024, pins a deprecated `glob@10` with no newer release fixing it) —
 * `postcss-modules` wraps the exact same `postcss-modules-*` plugin set `typed-css-modules` did,
 * plus it resolves cross-file `composes: x from './y.css'` itself, so nothing here loses that.
 * `getJSON`'s `tokens` map keys are this CSS file's own exported class names; only the keys are
 * needed here (the scoped/hashed values are Vite's own concern, already handled by its built-in
 * CSS Modules transform — this codegen only ever runs to produce a `.d.ts`, never to rewrite CSS).
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
  const css = await Deno.readTextFile(filePath)

  let tokens: Record<string, string> = {}
  await postcss([
    postcssModules({
      getJSON: (_cssFileName, json) => {
        tokens = json
      },
    }),
  ]).process(css, { from: filePath })

  const keys = Object.keys(tokens).sort()
  const formatted = keys.length === 0 ? 'export {};\n' : [
    'declare const styles: {',
    ...keys.map((key) => `  readonly "${key}": string;`),
    '};',
    'export = styles;',
    '',
  ].join('\n')

  const dtsPath = `${filePath}.d.ts`
  // Same "only touch the file if the content actually changed" guard `typed-css-modules` had —
  // avoids spurious mtime churn (dev-server file watchers, incremental builds) on every rebuild.
  let existing: string | null = null
  try {
    existing = await Deno.readTextFile(dtsPath)
  } catch {
    // No existing .d.ts yet — falls through to the write below.
  }
  if (existing !== formatted) await Deno.writeTextFile(dtsPath, formatted)
}
