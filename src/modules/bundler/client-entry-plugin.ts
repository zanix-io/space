import type { Plugin } from 'vite'
import type { RendererKind } from '../router/active-renderer.ts'
import { CLIENT_ENTRY_VIRTUAL_ID } from '../render/client-entry.ts'

const MANIFEST_FILE_NAME = 'client-entry-manifest.json'

/**
 * The auto-generated client entry's own source — every real client entry this framework ever
 * needs is, and only ever needs to be, `hydrateComets(); initOrbit();` (see `docs/comets.md`'s and
 * `docs/orbit.md`'s own client-entry examples: that pair IS the entire documented usage, verbatim,
 * every time). Picking the right renderer's own barrel here is what
 * `client-barrel-guard.ts` exists to CATCH a mismatch on for a user-authored entry — this one is
 * generated from the same `RendererKind` `spacePlugin({ renderer })` itself was given, so it can
 * never disagree with it.
 */
function clientEntrySource(renderer: RendererKind): string {
  const barrel = renderer === 'preact' ? '@zanix/space/client/preact' : '@zanix/space/client'
  return `import { hydrateComets, initOrbit } from '${barrel}'\nhydrateComets()\ninitOrbit()\n`
}

/** Options for {@linkcode clientEntryPlugin}. */
export interface ClientEntryPluginOptions {
  /** Which renderer's own client barrel the auto-generated entry imports from. */
  renderer: RendererKind
  /**
   * The specifier `render-page-react.tsx`/`render-page-preact.ts` actually resolved this build
   * around — either {@linkcode CLIENT_ENTRY_VIRTUAL_ID} (the default, no `SpaceAppConfig.clientEntry`
   * configured) or a real, realpath'd source file (an author's own override). Only needed for
   * `generateBundle` below (a production-only hook — never fires in `znx space dev`, where this
   * plugin exists purely for its `resolveId`/`load` pair) — omit it entirely for a dev engine's own
   * plugin list. Defaults to {@linkcode CLIENT_ENTRY_VIRTUAL_ID}.
   */
  entryId?: string
}

/**
 * Wires the default, zero-config client entry into a client build/dev session — the production
 * counterpart of `client-entry.ts`'s own dev-mode resolution. Two independent jobs, both scoped to
 * exactly {@linkcode ClientEntryPluginOptions.entryId}, never anything else:
 *
 * - **`resolveId`/`load`**: answers ONLY {@linkcode CLIENT_ENTRY_VIRTUAL_ID} with
 *   {@linkcode clientEntrySource}'s generated text — a no-op for every other id, same
 *   non-invasive shape `native-runtime-modules.ts`'s own `resolveId` hook already follows. Never
 *   intercepts an author-configured override: that's a real file, resolved normally.
 * - **`generateBundle`**: writes `client-entry-manifest.json`, keyed by `entryId`, to whatever
 *   real, hashed URL Rollup gave the chunk whose `facadeModuleId` matches it — the exact shape
 *   `comet-plugin.ts`'s own `generateBundle` hook already establishes for `comets-manifest.json`.
 *   Runs unconditionally: `entryId` is always resolvable to SOME chunk, whether it's the virtual
 *   default or a real override file, since `buildSpaceClient` always includes it as a real
 *   `rollupOptions.input` entry either way.
 */
export function clientEntryPlugin(options: ClientEntryPluginOptions): Plugin {
  const { renderer, entryId = CLIENT_ENTRY_VIRTUAL_ID } = options
  return {
    name: 'zanix-space-client-entry',
    // Ahead of EVERY normal-tier plugin, regardless of array position — `deno()`'s own resolver
    // otherwise claims any absolute-looking specifier first (rewriting it to a `file://` URL and
    // failing "not found" for the virtual default, which is never a real file), never reaching
    // this plugin's own `resolveId` at all. Same fix, same reasoning, as `native-runtime-modules.ts`'s
    // own `enforce: 'pre'` — confirmed empirically here too: without it, `buildSpaceClient()` fails
    // with `Import 'file:///@zanix/client-entry.ts' failed, not found.` from `@deno/vite-plugin`.
    enforce: 'pre',
    resolveId(id) {
      if (id === CLIENT_ENTRY_VIRTUAL_ID) return id
      return null
    },
    load(id) {
      if (id === CLIENT_ENTRY_VIRTUAL_ID) return clientEntrySource(renderer)
      return null
    },
    generateBundle(_options, bundle) {
      let builtUrl: string | undefined
      for (const chunk of Object.values(bundle)) {
        if (chunk.type === 'chunk' && chunk.facadeModuleId === entryId) {
          builtUrl = `/${chunk.fileName}`
          break
        }
      }
      if (!builtUrl) return

      this.emitFile({
        type: 'asset',
        fileName: MANIFEST_FILE_NAME,
        source: JSON.stringify({ [entryId]: builtUrl }, null, 2),
      })
    },
  }
}
