import type { EnvironmentModuleNode } from 'vite'

// `EnvironmentModuleNode` is intentionally NOT re-exported here, same reasoning as
// `space-plugin.ts`'s own `Plugin` doc comment: it's a Vite/Rolldown vendor type this package
// doesn't own. `changedModules` referencing it is an accepted, structural `deno doc --lint`
// finding, not a gap in this package's own documentation.

/**
 * Walks a changed module's `importers` graph (breadth-first, upward) to find which route-boundary
 * modules are affected by a change — even when the change lands in a shared/leaf module several
 * imports away from the actual route file. Vite's own `hotUpdate` hook only reports the module(s)
 * directly touched by the file change; it never resolves "which route does this ultimately
 * affect" on its own.
 *
 * A module that itself satisfies `isRouteEntry` is added directly, without climbing its own
 * importers further — a route file importing another route file isn't a real scenario this
 * function needs to resolve, and stopping there keeps the walk bounded even on a graph with
 * cycles (guarded independently by the `visited` set below).
 *
 * @param changedModules - The module(s) Vite reports as directly changed (`ctx.modules` from a
 * `hotUpdate` hook).
 * @param isRouteEntry - Predicate identifying a module as a route boundary (e.g. its `id` matches
 * a `routes/**\/page.tsx` convention). The walk stops climbing importers past a module this
 * returns `true` for.
 * @returns The `id` of every distinct route-boundary module reachable from `changedModules` by
 * walking `importers` upward, deduplicated. Empty if none of the changed modules' import chains
 * reach a route.
 */
export function computeAffectedRoutes(
  changedModules: Iterable<EnvironmentModuleNode>,
  isRouteEntry: (id: string) => boolean,
): string[] {
  const routes = new Set<string>()
  const visited = new Set<EnvironmentModuleNode>()
  const queue: EnvironmentModuleNode[] = [...changedModules]

  while (queue.length) {
    const mod = queue.shift()
    if (!mod || visited.has(mod)) continue
    visited.add(mod)

    if (mod.id && isRouteEntry(mod.id)) {
      routes.add(mod.id)
      continue
    }

    for (const importer of mod.importers) queue.push(importer)
  }

  return [...routes]
}
