/**
 * Builds variant A's client bundle — plain React, `@vitejs/plugin-react`'s `react()` alone, no
 * Compiler, no Space (no `cometPlugin`, no `deno()` needed since this entry only imports real npm
 * packages plus its own sibling files, no Deno-specific bare specifiers). This is the "full client
 * hydration" baseline: everything the page needs client-side — `Page`'s own composition logic
 * included — ships and hydrates as one bundle, the architecture Comets is being compared against.
 *
 * @module
 */
import { build } from 'vite'
import react from '@vitejs/plugin-react'

export interface BuildFullHydrationOptions {
  root: string
  outDir: string
  /** Absolute path to `scenario/react/client-entry-full-hydration.tsx`. */
  entry: string
}

export async function buildFullHydrationClient(options: BuildFullHydrationOptions): Promise<void> {
  const { root, outDir, entry } = options

  await build({
    root,
    configFile: false,
    logLevel: 'warn',
    build: {
      write: true,
      outDir,
      emptyOutDir: true,
      minify: true,
      rollupOptions: { input: { 'client-entry': entry } },
    },
    plugins: [react()],
  })
}
