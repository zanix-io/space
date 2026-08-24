import { assertEquals, assertStringIncludes } from '@std/assert'
import { fromFileUrl, join } from '@std/path'
import { getTemporaryFolder } from '@zanix/helpers'
import {
  getNotFoundRenderer,
  setNotFoundRenderer,
} from 'modules/router/not-found-renderer-registry.ts'
import type {
  NotFoundRenderContext,
  NotFoundRenderer,
} from 'modules/router/not-found-renderer-registry.ts'

console.error = () => {}

// ================================================================================================
// `getNotFoundRenderer`'s "never installed" branch is process-wide state: this suite normally runs
// alongside every other test file, and elsewhere in that same process a renderer entry point
// (`mod-react.ts`/`mod-preact.ts`) has already been imported, installing a renderer globally for
// the rest of the run. So that ONE branch is asserted in a real subprocess with NO renderer entry
// point imported at all — the same reasoning and pattern
// `functional/bundler/render-probe-renderer-seam.test.ts` already established for the equivalent
// page-renderer case (see that file's own module doc). Everything else about this registry (the
// round-trip identity of `setNotFoundRenderer`/`getNotFoundRenderer`) needs no subprocess: it is
// testing THIS module's own get/set pairing, not the absence of installation.
// ================================================================================================

const ROOT = fromFileUrl(import.meta.resolve('../../../../'))

Deno.test(
  'getNotFoundRenderer: returns the EXACT function passed to setNotFoundRenderer, unchanged',
  () => {
    const fakeRenderer = (_context: NotFoundRenderContext): Promise<Response> =>
      Promise.resolve(new Response('ok'))

    // Captured BEFORE overwriting, so it can be restored afterward — some other test file in this
    // same process already installed a real renderer (a `mod-react.ts`/`mod-preact.ts` import), and
    // this test must not leave the process on this fake stub for whatever runs after it.
    let previous: NotFoundRenderer | undefined
    try {
      previous = getNotFoundRenderer()
    } catch {
      previous = undefined
    }

    setNotFoundRenderer(fakeRenderer)
    try {
      assertEquals(getNotFoundRenderer(), fakeRenderer)
    } finally {
      if (previous) setNotFoundRenderer(previous)
    }
  },
)

Deno.test(
  'getNotFoundRenderer: throws InternalError naming both renderer entry points when NO renderer ' +
    'was ever installed — asserted in a real subprocess, since "never installed" is process-wide ' +
    'state that any other test file importing a renderer entry point would make unobservable here',
  async () => {
    // `deno-coverage-ignore-file`: this script exists only to run in a fresh subprocess with NO
    // renderer entry point imported — it is not project source, and it would otherwise show up as
    // a spurious, low-signal row in the coverage report.
    const script = `// deno-coverage-ignore-file
import { getNotFoundRenderer } from '${ROOT}src/modules/router/not-found-renderer-registry.ts'

getNotFoundRenderer()
`
    // Generated under this file's own, git-ignored \`__tmp__\` (see \`.gitignore\`, and
    // \`getTemporaryFolder\`'s own doc — same helper this project's other tests already use for a
    // real-filesystem fixture), not the OS temp dir, so it stays discoverable/inspectable in the
    // repo tree rather than scattered under \`/var/folders/...\` — and is removed again below, so
    // nothing accumulates across runs.
    const dir = await Deno.makeTempDir({
      dir: getTemporaryFolder(import.meta.url),
      prefix: 'not-found-registry-',
    })
    try {
      const path = join(dir, 'no-renderer.ts')
      await Deno.writeTextFile(path, script)
      const { stderr: stderrBytes, stdout: stdoutBytes } = await new Deno.Command(
        Deno.execPath(),
        {
          args: [
            'run',
            '--allow-all',
            '--no-check',
            '--min-dep-age=0',
            '--config',
            join(ROOT, 'deno.jsonc'),
            path,
          ],
          cwd: ROOT,
        },
      ).output()
      const stderr = new TextDecoder().decode(stderrBytes)
      const stdout = new TextDecoder().decode(stdoutBytes)

      // Asserted on the reported error, not on the exit code: `@zanix/errors` reports an
      // `InternalError` through its own logger, and the process's exit status — an uncaught
      // exception during module evaluation — is Deno's own default contract, not this registry's.
      // Same reasoning as `render-probe-renderer-seam.test.ts [4/5]`.
      assertStringIncludes(stderr, 'No renderer is installed')
      assertStringIncludes(stderr, '@zanix/space/react')
      assertStringIncludes(stderr, '@zanix/space/preact')
      assertEquals(stdout.trim(), '')
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
)
