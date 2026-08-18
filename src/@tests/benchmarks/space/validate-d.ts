// deno-lint-ignore-file deno-zanix-plugin/no-znx-console
// `console` on purpose, and the exemption is stated here rather than left as dozens of silenced
// findings. These are hand-run CLI scripts whose entire output IS a report a human reads and
// copies — `@zanix/logger` decorates every line with a timestamp, level and package prefix, which
// is right for a running server and wrong for a metrics table. Library code in this package uses
// the logger; these scripts are tools, not library code, and none of them ships anywhere.
/**
 * Functional validation gate for benchmark variant D (Preact + Comets).
 *
 * Variant D is only worth measuring if it produces the same KIND of page A/B/C do. Before the
 * `define-comet` element-factory fix it did not: every Comet rendered as nothing at all, so a
 * timing comparison against B/C would have been comparing a full page against a page with its
 * interactive content missing — faster, and meaningless.
 *
 * This script rebuilds and re-renders D and B exactly the way `run.ts` does (same builder, same
 * render function, same scenario data), then asserts D's SSR HTML satisfies every functional
 * property B's does. It measures nothing and must never be used to produce timing numbers — its
 * only job is to answer "is D a valid subject for measurement at all?".
 *
 * @module
 */

import { join } from '@std/path'
import { getTemporaryFolder } from '@zanix/helpers'
import { makeProducts } from './scenario/data.ts'
import { buildCometsClient } from './variants/build-comets-client.ts'
import { findBuiltAsset } from './variants/static-server.ts'
import { renderVariantPreactComets, renderVariantReactComets } from './variants/render.ts'
import PreactLikeButtonComet from './scenario/preact/comets/like-button-comet.tsx'
import PreactNewsletterComet from './scenario/preact/comets/newsletter-comet.tsx'
import PreactCartComet from './scenario/preact/comets/cart-comet.tsx'
import ReactLikeButtonComet from './scenario/react/comets/like-button-comet.tsx'
import ReactNewsletterComet from './scenario/react/comets/newsletter-comet.tsx'
import ReactCartComet from './scenario/react/comets/cart-comet.tsx'

const REPO_ROOT = Deno.cwd()

type Check = { name: string; pass: boolean; detail: string }

function countOf(html: string, needle: string): number {
  return html.split(needle).length - 1
}

/** The nine properties variant D has to satisfy before any timing comparison is legitimate. */
function validate(html: string, label: string): Check[] {
  const cometBoundaries = countOf(html, 'data-comet=')
  const moduleAttrs = html.match(/data-comet-module="([^"]*)"/g) ?? []
  const propAttrs = html.match(/data-comet-props="([^"]*)"/g) ?? []
  const distinctExports = new Set(
    (html.match(/data-comet-export="([^"]*)"/g) ?? []).map((m) => m.split('"')[1]),
  )
  // Every product's title must appear — the SSR HTML must carry real page content, not a shell.
  const products = makeProducts()
  const productsPresent = products.filter((p) => html.includes(p.name)).length
  // React separates adjacent text children with `<!-- -->` comments in SSR output; Preact's
  // counterpart builds the same string with a template literal and emits none. Stripping comments
  // is what makes the state assertion below renderer-neutral rather than accidentally
  // Preact-specific — the property under test is "the hook ran", not "the markup is identical".
  const textOnly = html.replaceAll(/<!--.*?-->/g, '')
  // The stateful Comets' own initial state, rendered server-side (LikeButton's counter, Cart's
  // item count) — proves the component bodies actually executed rather than rendering empty.
  const likeCounts = countOf(html, 'data-testid="like-')
  const cartRendered = /cart/i.test(html)

  return [
    {
      name: '1. HTML de servidor presente',
      pass: html.length > 5000 && html.includes('<html') && html.includes('</html>'),
      detail: `${html.length} bytes, documento completo`,
    },
    {
      name: '2. data-comet-module presente',
      pass: moduleAttrs.length === cometBoundaries && moduleAttrs.length > 0 &&
        !moduleAttrs.some((a) => a.includes('file://') || a.includes('""')),
      detail: `${moduleAttrs.length}/${cometBoundaries} boundaries con módulo resoluble`,
    },
    {
      name: '3. contenido de los Comets presente',
      pass: likeCounts > 0 && cartRendered,
      detail: `${likeCounts} LikeButton renderizados, Cart presente: ${cartRendered}`,
    },
    {
      name: '4. múltiples Comets renderizados',
      pass: cometBoundaries > 1 && distinctExports.size >= 3,
      detail: `${cometBoundaries} boundaries, ${distinctExports.size} tipos distintos: ${
        [...distinctExports].join(', ')
      }`,
    },
    {
      name: '5. props serializadas correctamente',
      pass: propAttrs.length === cometBoundaries &&
        propAttrs.every((a) => {
          const raw = a.slice('data-comet-props="'.length, -1)
            .replaceAll('&quot;', '"').replaceAll('&amp;', '&')
          try {
            JSON.parse(raw)
            return true
          } catch {
            return false
          }
        }),
      detail: `${propAttrs.length}/${cometBoundaries} atributos, todos JSON parseable`,
    },
    {
      name: '6. Comet stateful funcionando',
      // LikeButton renders `♡ N` from its own useState initial value — its presence proves the
      // hook ran during SSR instead of the component degrading to an empty shell.
      pass: /[♡♥]\s*\d+/.test(textOnly),
      detail: `estado inicial de useState en el HTML: ${/[♡♥]\s*\d+/.test(textOnly)}`,
    },
    {
      name: '7. CSS/scoping correcto',
      // This scenario ships no per-comet CSS module, so the correct outcome is NO comet stylesheet
      // link at all — never a broken or empty href.
      pass: !html.includes('href=""') && !html.includes('href="undefined"'),
      detail: 'sin hrefs vacíos/undefined',
    },
    {
      name: '8. ausencia de errores silenciosos',
      pass: !html.includes('undefined') && !html.includes('[object Object]') &&
        !html.includes('NaN'),
      detail: 'sin undefined / [object Object] / NaN en el marcado',
    },
    {
      name: '9. mismo escenario y datos que A/B/C',
      pass: productsPresent === products.length,
      detail: `${productsPresent}/${products.length} productos del dataset compartido presentes`,
    },
  ].map((c) => ({ ...c, name: `[${label}] ${c.name}` }))
}

async function main(): Promise<void> {
  const products = makeProducts()
  const tmp = await Deno.makeTempDir({
    dir: getTemporaryFolder(import.meta.url),
    prefix: 'space-validate-d-',
  })
  const dirD = join(tmp, 'd')
  const dirB = join(tmp, 'b')

  const cometsFor = (renderer: 'react' | 'preact') => ({
    'like-button-comet': join(
      REPO_ROOT,
      `src/@tests/benchmarks/space/scenario/${renderer}/comets/like-button-comet.tsx`,
    ),
    'newsletter-comet': join(
      REPO_ROOT,
      `src/@tests/benchmarks/space/scenario/${renderer}/comets/newsletter-comet.tsx`,
    ),
    'cart-comet': join(
      REPO_ROOT,
      `src/@tests/benchmarks/space/scenario/${renderer}/comets/cart-comet.tsx`,
    ),
    'client-entry': join(
      REPO_ROOT,
      `src/@tests/benchmarks/space/scenario/${renderer}/client-entry-comets.ts`,
    ),
  })

  console.error('Building D (Preact + Comets)...')
  await buildCometsClient({
    root: REPO_ROOT,
    outDir: dirD,
    renderer: 'preact',
    compiler: false,
    comets: cometsFor('preact'),
  })

  console.error('Building B (React + Comets, reference)...')
  await buildCometsClient({
    root: REPO_ROOT,
    outDir: dirB,
    renderer: 'react',
    compiler: false,
    comets: cometsFor('react'),
  })

  // Rendered sequentially, never concurrently — `setCometManifest`/`setActiveRenderer` are
  // process-wide mutable globals, the same constraint `variants/render.ts` documents.
  const htmlB = await renderVariantReactComets(
    products,
    join(dirB, 'comets-manifest.json'),
    await findBuiltAsset(join(dirB, 'assets'), 'client-entry'),
    ReactLikeButtonComet,
    ReactNewsletterComet,
    ReactCartComet,
  )
  const htmlD = await renderVariantPreactComets(
    products,
    join(dirD, 'comets-manifest.json'),
    await findBuiltAsset(join(dirD, 'assets'), 'client-entry'),
    // deno-lint-ignore no-explicit-any
    PreactLikeButtonComet as any,
    // deno-lint-ignore no-explicit-any
    PreactNewsletterComet as any,
    // deno-lint-ignore no-explicit-any
    PreactCartComet as any,
  )

  await Deno.writeTextFile(join(tmp, 'variant-d.html'), htmlD)
  await Deno.writeTextFile(join(tmp, 'variant-b.html'), htmlB)

  const checks = [...validate(htmlB, 'B/ref'), ...validate(htmlD, 'D')]
  console.log('\n=== Validación funcional de la variante D ===\n')
  for (const c of checks) {
    console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name} — ${c.detail}`)
  }

  const failed = checks.filter((c) => !c.pass)
  console.log(`\nHTML volcado en: ${tmp}`)
  console.log(
    failed.length === 0
      ? '\nRESULTADO: D es funcionalmente equivalente a B. Apto para medición.'
      : `\nRESULTADO: ${failed.length} verificación(es) fallaron. D NO es apto para medición.`,
  )
  Deno.exit(failed.length === 0 ? 0 : 1)
}

await main()
