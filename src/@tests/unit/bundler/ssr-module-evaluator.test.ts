import { assertEquals } from '@std/assert'
import { resolvedImportTarget } from 'modules/bundler/ssr-module-evaluator.ts'

// `resolveDenoAt` returns a local result's `id` as a plain filesystem path, never a URL. Handing
// that path straight to `import()` only resolves correctly when the calling module's own base URL
// is already `file://` — a real global `@zanix/cli` install runs from a remote `https://jsr.io/...`
// origin instead, where the identical bare path resolves against THAT origin and throws `Module
// not found`. This suite locks in `resolvedImportTarget`'s conversion back to a real `file://` URL
// for a local result, independent of which origin the process itself was loaded from.

Deno.test(
  'resolvedImportTarget: a local-file result converts to a real file:// URL, never a bare path',
  () => {
    const target = resolvedImportTarget(
      {
        id: '/Users/dev/project/node_modules/.deno/preact@10.29.8/preact/debug/dist/debug.mjs',
        isLocalFile: true,
      },
      'preact/debug',
    )
    assertEquals(
      target,
      'file:///Users/dev/project/node_modules/.deno/preact@10.29.8/preact/debug/dist/debug.mjs',
    )
  },
)

Deno.test(
  'resolvedImportTarget: a non-local result (jsr:/http(s):, already fully qualified) passes through unchanged',
  () => {
    assertEquals(
      resolvedImportTarget(
        { id: 'jsr:@zanix/space@^1.10.2/comet', isLocalFile: false },
        '@zanix/space/comet',
      ),
      'jsr:@zanix/space@^1.10.2/comet',
    )
  },
)

Deno.test(
  'resolvedImportTarget: a null result (resolveDenoAt found nothing) falls back to the original specifier',
  () => {
    assertEquals(resolvedImportTarget(null, '@zanix/space/comet'), '@zanix/space/comet')
  },
)
