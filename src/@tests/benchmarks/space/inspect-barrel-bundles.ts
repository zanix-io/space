// deno-lint-ignore-file deno-zanix-plugin/no-znx-console
// `console` on purpose, and the exemption is stated here rather than left as dozens of silenced
// findings. These are hand-run CLI scripts whose entire output IS a report a human reads and
// copies — `@zanix/logger` decorates every line with a timestamp, level and package prefix, which
// is right for a running server and wrong for a metrics table. Library code in this package uses
// the logger; these scripts are tools, not library code, and none of them ships anywhere.
/**
 * Determines WHERE a client-barrel/renderer mismatch is detectable, by building the correct and
 * the mismatched pairing and inspecting what each one actually put in the client bundle.
 *
 * The question this answers is a design question, not a measurement: `getActiveRenderer()` is a
 * server-side value (`defineSpaceApp` sets it during startup; in a browser that module would be a
 * fresh instance defaulting to `'react'`), so a runtime assertion would need the renderer
 * transmitted through the HTML. A build-time check needs no such channel — but only if the
 * mismatch leaves a reliable trace in the built output. That is what this prints.
 *
 * @module
 */

import { join } from '@std/path'
import { getTemporaryFolder } from '@zanix/helpers'
import { buildCometsClient } from './variants/build-comets-client.ts'

const REPO_ROOT = Deno.cwd()
const S = 'src/@tests/benchmarks/space/scenario'

async function buildWith(
  label: string,
  renderer: 'react' | 'preact',
  clientEntry: string,
  outDir: string,
): Promise<void> {
  await buildCometsClient({
    root: REPO_ROOT,
    outDir,
    renderer,
    compiler: false,
    comets: {
      'like-button-comet': join(REPO_ROOT, `${S}/${renderer}/comets/like-button-comet.tsx`),
      'newsletter-comet': join(REPO_ROOT, `${S}/${renderer}/comets/newsletter-comet.tsx`),
      'cart-comet': join(REPO_ROOT, `${S}/${renderer}/comets/cart-comet.tsx`),
      'client-entry': join(REPO_ROOT, clientEntry),
    },
  })
  const assets = join(outDir, 'assets')
  let total = 0
  let reactDomHits = 0
  let preactHits = 0
  const files: string[] = []
  for await (const entry of Deno.readDir(assets)) {
    if (!entry.name.endsWith('.js')) continue
    const src = await Deno.readTextFile(join(assets, entry.name))
    total += src.length
    files.push(`${entry.name} (${(src.length / 1024).toFixed(1)}KB)`)
    // Fingerprints that survive minification: React DOM's own invariant/marker strings, and
    // Preact core's own. Never a bare "react"/"preact" substring, which appears in paths/comments.
    if (/react-dom|Minified React error|__reactContainer|_reactListening/.test(src)) reactDomHits++
    if (/preact|__k|__preactattr/.test(src)) preactHits++
  }
  console.log(`\n--- ${label} ---`)
  console.log(`  renderer declared:      ${renderer}`)
  console.log(`  client entry:           ${clientEntry.split('/').pop()}`)
  console.log(`  total JS:               ${(total / 1024).toFixed(1)}KB`)
  console.log(`  chunks:                 ${files.length}`)
  console.log(`  chunks w/ react-dom fingerprint: ${reactDomHits}`)
  console.log(`  chunks w/ preact fingerprint:    ${preactHits}`)
}

const tmp = await Deno.makeTempDir({
  dir: getTemporaryFolder(import.meta.url),
  prefix: 'space-barrel-inspect-',
})

await buildWith(
  'CORRECT: preact renderer + preact barrel',
  'preact',
  `${S}/preact/client-entry-comets.ts`,
  join(tmp, 'ok'),
)
await buildWith(
  'MISMATCH: preact renderer + REACT barrel',
  'preact',
  `${S}/react/client-entry-comets.ts`,
  join(tmp, 'bad'),
)
await buildWith(
  'CORRECT: react renderer + react barrel',
  'react',
  `${S}/react/client-entry-comets.ts`,
  join(tmp, 'okr'),
)

console.log(`\nbundles at: ${tmp}`)
Deno.exit(0)
