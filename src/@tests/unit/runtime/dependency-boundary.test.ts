import { assertEquals } from '@std/assert'

/**
 * Structural guard rail: this package's root `.` entry point — `defineSpaceApp`'s own home, the
 * single most commonly imported symbol in this package, used by literally every `space.app.ts` —
 * must never reach ANY `npm:`-backed package at all, code or type edge, regardless of runtime
 * config (`sitemap: 'auto'`, dev mode, ...). A real, confirmed regression this guards against:
 * `defineSpaceApp`'s own `sitemap: 'auto'` dev-mode branch did `await import('@zanix/space/vite')`
 * with a LITERAL string argument — correctly reasoned as dev-only at RUNTIME, but a literal dynamic
 * `import()` specifier is exactly as eagerly resolved by `deno check`/`deno test`/`deno cache`
 * (`nodeModulesDir: "auto"`) as a static top-level import, materializing `sharp`, `vite`,
 * `@tailwindcss/vite`, `@vanilla-extract/vite-plugin`, `postcss-modules`, and their whole
 * transitive closure for every consumer, whether `sitemap: 'auto'` was ever configured or not.
 * Fixed by routing the same dynamic import through a non-literal `import.meta.resolve()` constant
 * (`define-space-app.ts`'s own `VITE_MODULE_SPECIFIER`, mirroring `LOG_CONTROLLER_SPECIFIER`'s
 * already-established precedent in that same file). A second, independent leak — `socket-exports.ts`
 * re-exporting `SsrModuleChangedEvent`'s TYPE from `../bundler/dev-engine.ts`, whose own real value
 * imports (`vite`, `@deno/vite-plugin`) resolve the moment that type is referenced — was fixed by
 * splitting the interface into its own dependency-free `dev-engine-types.ts` file.
 *
 * Walks BOTH `code` and `type` edges (unlike `comets/dependency-boundary.test.ts`'s own code-only
 * walk, which mirrors what a CLIENT BUNDLE actually executes): `deno check`/`deno test`/
 * `deno cache`'s own materialization doesn't distinguish the two — an `import type` still forces
 * resolving the whole declaring file, npm value imports included (see `deno-lazy-dependency-pattern`
 * skill's own "`import type` is NOT automatically safe" finding) — so a guard scoped to code edges
 * only would miss exactly the `SsrModuleChangedEvent` class of regression above.
 *
 * @module
 */

const ENTRYPOINTS = ['mod.ts']

interface DenoInfoModule {
  specifier: string
  dependencies?: { code?: { specifier: string }; type?: { specifier: string } }[]
}

async function npmReachableSet(entry: string): Promise<Set<string>> {
  const command = new Deno.Command(Deno.execPath(), {
    args: ['info', '--json', entry],
    stdout: 'piped',
    stderr: 'piped',
  })
  const { stdout, stderr, success } = await command.output()
  if (!success) {
    throw new Error(`'deno info --json ${entry}' failed: ${new TextDecoder().decode(stderr)}`)
  }
  // deno-lint-ignore no-explicit-any -- `deno info --json`'s own output shape, not this package's.
  const parsed: any = JSON.parse(new TextDecoder().decode(stdout))
  const byId = new Map<string, DenoInfoModule>()
  for (const module of parsed.modules ?? []) byId.set(module.specifier, module)
  // Same reasoning as `comets/dependency-boundary.test.ts`'s own `resolve` — a bare cross-package
  // specifier only has a real `modules` entry under its REDIRECTED (resolved) form.
  const redirects: Record<string, string> = parsed.redirects ?? {}
  const resolve = (specifier: string): string => redirects[specifier] ?? specifier

  const entrySpecifier = parsed.roots?.[0] ?? entry
  const visited = new Set<string>()
  const queue = [entrySpecifier]
  const npmHits = new Set<string>()
  while (queue.length > 0) {
    const rawId = queue.shift() as string
    if (visited.has(rawId)) continue
    visited.add(rawId)
    if (rawId.startsWith('npm:')) npmHits.add(rawId)
    const module = byId.get(resolve(rawId))
    for (const dep of module?.dependencies ?? []) {
      for (const edge of [dep.code, dep.type]) {
        const next = edge?.specifier
        if (next && !visited.has(next)) queue.push(next)
      }
    }
  }
  return npmHits
}

for (const entry of ENTRYPOINTS) {
  Deno.test(
    `${entry}: never reaches any npm:-backed package, code or type edge (defineSpaceApp's own home)`,
    async () => {
      const npmHits = await npmReachableSet(entry)
      assertEquals(
        [...npmHits],
        [],
        `${entry} reaches ${npmHits.size} npm: package(s) it shouldn't:\n${
          [...npmHits].join('\n')
        }`,
      )
    },
  )
}
