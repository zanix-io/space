import { assert } from '@std/assert'

/**
 * Structural guard rail: `@zanix/space` must never gain a FormatJS/ICU dependency, at compile time
 * or runtime, in any of its public entrypoints. Verified via `deno info --json`'s actual resolved
 * module graph — transitive reachability, not a grep over `deno.json`'s own `imports` map. Same
 * technique `@zanix/space-ui`'s own `dependency-boundary.test.ts` and `@zanix/cli`'s own
 * `compile-messages-dependency-boundary.test.ts` use — one shared definition of "clean", checked
 * from all three sides of this boundary.
 *
 * `loadMessages()` (`modules/i18n/load-messages.ts`) stays completely opaque to ICU/AST — it reads,
 * merges, and caches whatever JSON a catalog contains, without ever inspecting or transforming a
 * value. Compiling ICU is `@zanix/cli`'s own job; formatting it is `@zanix/space-ui`'s. Neither
 * belongs here.
 *
 * @module
 */

const ENTRYPOINTS = ['mod.ts', 'mod-react.ts', 'mod-preact.ts']

interface ModuleGraph {
  code: Set<string>
  type: Set<string>
}

async function moduleGraph(entry: string): Promise<ModuleGraph> {
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
  const code = new Set<string>()
  const type = new Set<string>()
  for (const module of parsed.modules ?? []) {
    for (const dep of module.dependencies ?? []) {
      if (dep.code?.specifier) code.add(dep.code.specifier)
      if (dep.type?.specifier) type.add(dep.type.specifier)
    }
  }
  return { code, type }
}

function includesPackage(specifiers: Set<string>, pkg: string): boolean {
  return [...specifiers].some((specifier) => {
    if (!specifier.startsWith('npm:')) return false
    const rest = specifier.slice('npm:'.length).replace(/^\//, '')
    return rest === pkg || rest.startsWith(`${pkg}@`) || rest.startsWith(`${pkg}/`)
  })
}

for (const entry of ENTRYPOINTS) {
  Deno.test(
    `${entry}: never reaches any FormatJS/ICU package, at compile time or runtime`,
    async () => {
      const graph = await moduleGraph(entry)
      for (const pkg of ['@formatjs/intl', '@formatjs/icu-messageformat-parser', 'react-intl']) {
        assert(!includesPackage(graph.code, pkg), `${pkg} leaked into ${entry} as code`)
        assert(!includesPackage(graph.type, pkg), `${pkg} leaked into ${entry} as a type`)
      }
    },
  )
}
