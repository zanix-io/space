import type { RendererKind } from '../router/active-renderer.ts'

/**
 * Every ready-made Comet this package itself ships from `@zanix/space/comet/react`/`/preact`
 * (`mod-react.ts`/`mod-preact.ts`), name to relative specifier — the ONE place this list is
 * written down, so `mod-react.ts`/`mod-preact.ts` and this registry can never silently drift apart
 * on which files these are. Both renderers declare the exact same set of names, by construction —
 * see `mod-preact.ts`'s own doc ("identical to `@zanix/space/comet/react`, wiring the same
 * ready-made Comets against `preact/hooks` instead").
 */
const BUILT_IN_COMET_SPECIFIERS: Record<RendererKind, Record<string, string>> = {
  react: {
    FormDraftPersistence: './form-draft-persistence-react.tsx',
    SubmitGuard: './submit-guard-react.tsx',
    ScrollRestoration: './scroll-restoration-react.tsx',
    UnsavedChangesGuard: './unsaved-changes-guard-react.tsx',
    NetworkStatus: './network-status-react.tsx',
    ManagedForm: './managed-form-react.tsx',
  },
  preact: {
    FormDraftPersistence: './form-draft-persistence-preact.tsx',
    SubmitGuard: './submit-guard-preact.tsx',
    ScrollRestoration: './scroll-restoration-preact.tsx',
    UnsavedChangesGuard: './unsaved-changes-guard-preact.tsx',
    NetworkStatus: './network-status-preact.tsx',
    ManagedForm: './managed-form-preact.tsx',
  },
}

/** Every name {@linkcode BUILT_IN_COMET_SPECIFIERS} declares — read by `discover-comets.ts`'s own
 * `discoverUsedBuiltInComets` to know which named imports from `@zanix/space/comet/<renderer>` to
 * look for in a project's own source. */
export const BUILT_IN_COMET_NAMES: readonly string[] = Object.keys(BUILT_IN_COMET_SPECIFIERS.react)

/**
 * Resolves a subset of {@linkcode BUILT_IN_COMET_NAMES} to real, absolute URLs, relative to THIS
 * module's own location — `new URL(specifier, import.meta.url).href`, deliberately NOT
 * `import.meta.resolve(specifier)`, same reasoning `default-view-specifiers.ts`'s own doc gives
 * for its identical choice: `zanix space dev`'s Vite-based SSR module runner intercepts every
 * loaded module's `import.meta.resolve` but leaves the plain `import.meta.url` property untouched,
 * so only the former breaks when this module is loaded through that runner.
 *
 * Used by `build-client.ts` to register whichever of these a project actually imports
 * (`discover-comets.ts`'s own `discoverUsedBuiltInComets`) alongside its own Comets/`error.tsx`
 * files — the same auto-comet treatment `DEFAULT_ERROR_VIEW_REACT_URL`/
 * `DEFAULT_ERROR_VIEW_PREACT_URL` already get, for the identical reason: none of these are
 * reachable client-side without a real built chunk of their own. Resolves to a real `file://` URL
 * for a local checkout (this package's own test suite, or a TEMP-linked sibling) and a real
 * `https://jsr.io/...` URL for any genuine `jsr:`-installed consumer — `defineComet`'s own
 * `import.meta.url`, evaluated from inside the SAME file, resolves to that exact same URL either
 * way, which is what lets `comet-plugin.ts`'s own `generateBundle` key `comets-manifest.json` by a
 * value `defineComet`'s runtime lookup can actually match.
 *
 * @param renderer - Only the active renderer's own file variants are ever resolved.
 * @param names - Which of {@linkcode BUILT_IN_COMET_NAMES} to resolve — an unrecognized name is
 * silently skipped, never an error (defensive only: every caller today sources `names` from
 * `BUILT_IN_COMET_NAMES` itself, so this can never actually happen in practice).
 */
export function getBuiltInCometUrls(
  renderer: RendererKind,
  names: Iterable<string>,
): string[] {
  const specifiers = BUILT_IN_COMET_SPECIFIERS[renderer]
  const urls: string[] = []
  for (const name of names) {
    const specifier = specifiers[name]
    if (specifier !== undefined) urls.push(new URL(specifier, import.meta.url).href)
  }
  return urls
}
