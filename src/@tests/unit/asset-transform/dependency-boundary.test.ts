import { assert } from '@std/assert'

/**
 * Structural guard rail: `modules/asset-transform/mod.ts` (the `@zanix/space/assets` entry point)
 * must never reach Vite/React/Preact, at compile time or runtime, and must never reach back INTO
 * the build-tool-facing layer (`modules/bundler/`) it is meant to be consumed BY — the whole point
 * of this facade being a domain/runtime layer, not a build-tool one. Verified via
 * `deno info --json`'s actual resolved module graph — transitive reachability, not a grep over
 * `deno.json`'s own `imports` map. Same technique `src/@tests/unit/i18n/dependency-boundary.
 * test.ts` already establishes for `mod.ts`/`mod-react.ts`/`mod-preact.ts`, applied here to the
 * new subpath specifically.
 *
 * @module
 */

const ENTRY = 'src/modules/asset-transform/mod.ts'

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

function includesLocalPathSegment(specifiers: Set<string>, segment: string): boolean {
  return [...specifiers].some((specifier) => specifier.includes(segment))
}

/** A resolved `jsr:` dependency shows up in `deno info --json`'s own graph as a real
 * `https://jsr.io/<scope>/<pkg>/<version>/...` URL (confirmed empirically against this repo's own
 * `@zanix/utils` resolution) — never as a bare `jsr:@scope/pkg` specifier, which only ever appears
 * for a package's OWN direct entry point, not its transitive files. Checking both shapes is what
 * makes this a real, package-level absence proof rather than a guess at one URL form. */
function includesJsrPackage(specifiers: Set<string>, pkg: string): boolean {
  return [...specifiers].some((specifier) =>
    specifier.includes(`jsr.io/${pkg}/`) || specifier.startsWith(`jsr:${pkg}`)
  )
}

Deno.test(
  '@zanix/space/assets: never reaches Vite/React/Preact, at compile time or runtime',
  async () => {
    const graph = await moduleGraph(ENTRY)
    for (const pkg of ['vite', 'react', 'react-dom', 'preact']) {
      assert(!includesPackage(graph.code, pkg), `${pkg} leaked into ${ENTRY} as code`)
      assert(!includesPackage(graph.type, pkg), `${pkg} leaked into ${ENTRY} as a type`)
    }
  },
)

Deno.test(
  '@zanix/space/assets: never reaches back into modules/bundler/ (the build-tool-facing layer)',
  async () => {
    const graph = await moduleGraph(ENTRY)
    assert(
      !includesLocalPathSegment(graph.code, '/modules/bundler/'),
      `${ENTRY} must never resolve a module under modules/bundler/ as code`,
    )
    assert(
      !includesLocalPathSegment(graph.type, '/modules/bundler/'),
      `${ENTRY} must never resolve a module under modules/bundler/ as a type`,
    )
  },
)

Deno.test(
  '@zanix/space/assets: never reaches @zanix/server — modules/assets/, modules/media/, and ' +
    'modules/asset-transform/ stay agnostic of the HTTP framework; only modules/assets-api/ ' +
    'depends on it',
  async () => {
    const graph = await moduleGraph(ENTRY)
    assert(
      !includesJsrPackage(graph.code, '@zanix/server'),
      `${ENTRY} must never resolve @zanix/server as code`,
    )
    assert(
      !includesJsrPackage(graph.type, '@zanix/server'),
      `${ENTRY} must never resolve @zanix/server as a type`,
    )
  },
)

Deno.test(
  '@zanix/space/assets: never reaches back into modules/assets-api/ (the HTTP application layer ' +
    'built ON TOP of this facade) — the dependency is strictly one-way',
  async () => {
    const graph = await moduleGraph(ENTRY)
    assert(
      !includesLocalPathSegment(graph.code, '/modules/assets-api/'),
      `${ENTRY} must never resolve a module under modules/assets-api/ as code`,
    )
    assert(
      !includesLocalPathSegment(graph.type, '/modules/assets-api/'),
      `${ENTRY} must never resolve a module under modules/assets-api/ as a type`,
    )
  },
)
