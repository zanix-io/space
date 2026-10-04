import { assertEquals } from '@std/assert'
import { join, toFileUrl } from '@std/path'
import { getTemporaryFolder } from '@zanix/helpers'
import { discoverEvaluatedComets } from 'modules/bundler/discover-comets.ts'
import { recordEvaluatedComet, resetEvaluatedComets } from 'modules/comets/evaluated-comets.ts'

const TMP_ROOT = getTemporaryFolder(import.meta.url)

/** A project root and a second directory beside it standing for a package outside the project. */
async function withProjectAndPackage(
  run: (paths: { root: string; pkg: string }) => Promise<void>,
): Promise<void> {
  const base = await Deno.makeTempDir({ dir: TMP_ROOT })
  const root = join(base, 'project')
  const pkg = join(base, 'package')
  await Deno.mkdir(root)
  await Deno.mkdir(pkg)
  resetEvaluatedComets()
  try {
    await run({ root: await Deno.realPath(root), pkg: await Deno.realPath(pkg) })
  } finally {
    resetEvaluatedComets()
    await Deno.remove(base, { recursive: true })
  }
}

Deno.test('discoverEvaluatedComets: a remote URL is returned as it is', async () => {
  await withProjectAndPackage(async ({ root }) => {
    recordEvaluatedComet(
      'https://jsr.io/@zanix/iam/1.1.0/ui/components/login-two-step/index.preact.ts',
    )
    assertEquals(
      await discoverEvaluatedComets(root),
      new Set(['https://jsr.io/@zanix/iam/1.1.0/ui/components/login-two-step/index.preact.ts']),
    )
  })
})

Deno.test('discoverEvaluatedComets: a file outside the project comes back as its real path', async () => {
  await withProjectAndPackage(async ({ root, pkg }) => {
    const comet = join(pkg, 'toggle.tsx')
    await Deno.writeTextFile(comet, "'use comet'\n")
    recordEvaluatedComet(toFileUrl(comet).href)
    assertEquals(await discoverEvaluatedComets(root), new Set([comet]))
  })
})

Deno.test('discoverEvaluatedComets: a file inside the project is left to discoverComets', async () => {
  await withProjectAndPackage(async ({ root }) => {
    const own = join(root, 'comets', 'own.tsx')
    await Deno.mkdir(join(root, 'comets'))
    await Deno.writeTextFile(own, "'use comet'\n")
    recordEvaluatedComet(toFileUrl(own).href)
    assertEquals(await discoverEvaluatedComets(root), new Set())
  })
})

Deno.test('discoverEvaluatedComets: a sibling directory that only shares the root name as a prefix is outside', async () => {
  const base = await Deno.makeTempDir({ dir: TMP_ROOT })
  resetEvaluatedComets()
  try {
    await Deno.mkdir(join(base, 'app'))
    await Deno.mkdir(join(base, 'app-extras'))
    const comet = join(base, 'app-extras', 'widget.tsx')
    await Deno.writeTextFile(comet, "'use comet'\n")
    recordEvaluatedComet(toFileUrl(comet).href)
    assertEquals(
      await discoverEvaluatedComets(await Deno.realPath(join(base, 'app'))),
      new Set([await Deno.realPath(comet)]),
    )
  } finally {
    resetEvaluatedComets()
    await Deno.remove(base, { recursive: true })
  }
})

Deno.test('discoverEvaluatedComets: a temporary rewritten copy, a missing file, blob and data URLs are skipped', async () => {
  await withProjectAndPackage(async ({ root, pkg }) => {
    const temp = join(pkg, '.zanix-import-0b7c9d3e-1111-4222-8333-444455556666.js')
    await Deno.writeTextFile(temp, 'export default {}\n')
    recordEvaluatedComet(toFileUrl(temp).href)
    recordEvaluatedComet(toFileUrl(join(pkg, 'gone.tsx')).href)
    recordEvaluatedComet('blob:null/0b7c9d3e')
    recordEvaluatedComet('data:text/javascript,export default 1')
    assertEquals(await discoverEvaluatedComets(root), new Set())
  })
})

Deno.test('discoverEvaluatedComets: whatever is already known is not returned again', async () => {
  await withProjectAndPackage(async ({ root, pkg }) => {
    const comet = join(pkg, 'known.tsx')
    await Deno.writeTextFile(comet, "'use comet'\n")
    recordEvaluatedComet(toFileUrl(comet).href)
    recordEvaluatedComet('https://jsr.io/@scope/pkg/1.0.0/known.tsx')
    recordEvaluatedComet('https://jsr.io/@scope/pkg/1.0.0/fresh.tsx')
    assertEquals(
      await discoverEvaluatedComets(root, [comet, 'https://jsr.io/@scope/pkg/1.0.0/known.tsx']),
      new Set(['https://jsr.io/@scope/pkg/1.0.0/fresh.tsx']),
    )
  })
})

Deno.test('discoverEvaluatedComets: nothing evaluated, nothing found', async () => {
  await withProjectAndPackage(async ({ root }) => {
    assertEquals(await discoverEvaluatedComets(root), new Set())
  })
})

Deno.test('discoverEvaluatedComets: a Comet of @zanix/space itself is left out, by where it lives', async () => {
  await withProjectAndPackage(async ({ root }) => {
    // This checkout's own module, and the same package as JSR serves it under any version.
    recordEvaluatedComet(
      new URL('../../../modules/comets/submit-guard-react.tsx', import.meta.url).href,
    )
    recordEvaluatedComet(
      'https://jsr.io/@zanix/space/1.16.6/src/modules/comets/managed-form-preact.tsx',
    )
    recordEvaluatedComet('https://jsr.io/@zanix/space/2.0.0/src/modules/comets/network-status.tsx')
    // A package that merely has "space" in its name is a dependency like any other.
    recordEvaluatedComet('https://jsr.io/@zanix/space-ui/2.7.1/src/components/NavDrawer/index.ts')
    recordEvaluatedComet(
      'https://jsr.io/@zanix/iam/1.1.0/ui/components/login-two-step/index.preact.ts',
    )
    assertEquals(
      await discoverEvaluatedComets(root),
      new Set([
        'https://jsr.io/@zanix/space-ui/2.7.1/src/components/NavDrawer/index.ts',
        'https://jsr.io/@zanix/iam/1.1.0/ui/components/login-two-step/index.preact.ts',
      ]),
    )
  })
})

Deno.test("discoverEvaluatedComets: this package's tests and fixtures are not Space's own modules", async () => {
  const base = await Deno.makeTempDir({ dir: TMP_ROOT })
  resetEvaluatedComets()
  try {
    // TMP_ROOT is inside this checkout's `src/@tests`: outside `src/modules`, so a dependency.
    const comet = join(base, 'dependency-comet.tsx')
    await Deno.writeTextFile(comet, "'use comet'\n")
    recordEvaluatedComet(toFileUrl(comet).href)
    await Deno.mkdir(join(base, 'project'))
    assertEquals(
      await discoverEvaluatedComets(await Deno.realPath(join(base, 'project'))),
      new Set([await Deno.realPath(comet)]),
    )
  } finally {
    resetEvaluatedComets()
    await Deno.remove(base, { recursive: true })
  }
})
