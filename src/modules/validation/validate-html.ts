/**
 * Render-phase validation — the rules that need real HTML, and therefore real data.
 *
 * These run against {@linkcode DocumentSemantics} (`render/document-semantics.ts`), the same
 * renderer-agnostic extraction the cross-renderer parity suite compares. That is deliberate: it
 * means a rule here is written once and holds for React and Preact alike, because it never sees the
 * HTML a particular serializer produced, only what that HTML means.
 *
 * **Why this phase is opt-in and non-blocking by default.** Producing HTML requires running the
 * page's `loader`, which requires data. For a route with dynamic segments there is no correct value
 * to supply — `/products/[id]` has no representative `id` a build could invent — so coverage is
 * inherently partial. A phase that can only inspect some routes must not be the phase that fails
 * the build for all of them. The two `error` rules here (`DOC003`, `FW003`) keep their severity
 * because when they DO fire they are unambiguous, but the phase as a whole only runs when asked.
 *
 * @module
 */
import type { DocumentSemantics } from '../render/document-model.ts'
import type { Diagnostic } from './diagnostic.ts'
import type { ValidationConfig } from './engine.ts'
import { DiagnosticCollector, isExemptFromDocumentRules, sortDiagnostics } from './engine.ts'

/** One rendered route, ready to validate. */
export type RenderedPageInput = {
  filePath: string
  routePath: string
  /** Extracted from the real rendered HTML via `extractDocumentSemantics`. */
  semantics: DocumentSemantics
  /** The raw HTML, for the few rules that need to look at elements the semantics summary does not
   * carry (images, links). Optional: a caller that only has semantics still gets every other rule. */
  html?: string
  /** What the document model said this page's title should be, when known — lets `FW003` tell
   * "the renderer dropped the head" apart from "there was no head to render". */
  expectedTitle?: string
}

/** Whether a viewport `content` value blocks zoom, per ACT rule b4f0c3's own thresholds. */
export function viewportBlocksZoom(content: string): boolean {
  const directives = new Map(
    content.split(',').map((part) => {
      const [key, value] = part.split('=')
      return [key?.trim().toLowerCase() ?? '', value?.trim().toLowerCase() ?? '']
    }),
  )

  if (directives.get('user-scalable') === 'no') return true

  const maximumScale = directives.get('maximum-scale')
  if (maximumScale !== undefined) {
    // `maximum-scale=yes` is coerced to 1.0 by the same rule, which is below the threshold.
    const numeric = maximumScale === 'yes' ? 1 : Number.parseFloat(maximumScale)
    if (Number.isFinite(numeric) && numeric < 2) return true
  }

  return false
}

/** Counts `<img>` elements with no `alt` attribute at all. `alt=""` is correct for decorative
 * images and is never counted. */
function imagesWithoutAlt(html: string): number {
  const images = html.match(/<img\b[^>]*>/gi) ?? []
  return images.filter((tag) => !/\salt\s*=/i.test(tag)).length
}

/** Counts anchors that have an `href` but no accessible name from any source. */
function linksWithoutAccessibleName(html: string): number {
  const anchors = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)]
  return anchors.filter(([, attributes, inner]) => {
    if (!/\shref\s*=/i.test(attributes)) return false
    if (/\saria-label(ledby)?\s*=\s*["'][^"']+["']/i.test(attributes)) return false
    // An image with real alt text inside the link supplies the name — the F89 case.
    if (/<img\b[^>]*\salt\s*=\s*["'][^"']+["']/i.test(inner)) return false
    return inner.replace(/<[^>]+>/g, '').trim() === ''
  }).length
}

/** Reports the first heading-level skip, if any — one finding per document, not one per heading. */
function firstHeadingSkip(html: string): { from: number; to: number } | undefined {
  const levels = [...html.matchAll(/<h([1-6])\b/gi)].map((match) => Number(match[1]))
  for (let index = 1; index < levels.length; index++) {
    if (levels[index] > levels[index - 1] + 1) {
      return { from: levels[index - 1], to: levels[index] }
    }
  }
  return undefined
}

/**
 * Runs every render-phase rule over one rendered route.
 *
 * @param page - See {@linkcode RenderedPageInput}.
 * @param config - Project validation configuration.
 * @returns Diagnostics for this route, most severe first.
 */
export function validateRenderedDocument(
  page: RenderedPageInput,
  config: ValidationConfig = {},
): Diagnostic[] {
  const collector = new DiagnosticCollector(config)
  const { semantics, html } = page
  const where = { file: page.filePath, route: page.routePath }

  // No `hasUnconditionalRedirect` here, deliberately: a page that always redirects never produced
  // HTML to render, so it never reaches this phase at all. Only project route exemptions apply.
  if (isExemptFromDocumentRules(page.routePath, {}, config)) return []

  // --- document structure --------------------------------------------------------------------
  if (!semantics.isDocument) {
    collector.report('DOC003', {
      ...where,
      message:
        `Route '${page.routePath}' did not render a document (missing doctype, <html> or <body>).`,
      hint:
        'A root layout is trusted to render the document; check that it does, or remove it to fall back to the default shell.',
    })
    // Every rule below asks about a document's contents. Reporting them against something that is
    // not a document produces a cascade of findings with one real cause, so they stop here.
    return collector.results()
  }

  // --- head assembly -------------------------------------------------------------------------
  if (semantics.titles.length === 0) {
    // Distinguishes "the renderer lost the head" from "nothing declared a title": only the former
    // is a framework defect, and conflating them would point the reader at the wrong problem.
    if (page.expectedTitle !== undefined) {
      collector.report('FW003', {
        ...where,
        message:
          `Route '${page.routePath}' resolved the title '${page.expectedTitle}', but the rendered document contains none — the resolved head did not reach the document.`,
      })
    } else {
      collector.report('DOC001', {
        ...where,
        message: `Route '${page.routePath}' rendered no <title>.`,
      })
    }
  } else if (semantics.titles.length > 1) {
    collector.report('DOC002', {
      ...where,
      message: `Route '${page.routePath}' rendered ${semantics.titles.length} <title> elements.`,
      hint:
        'Only the first becomes document.title. If a layout or page renders its own, remove it and declare it through `head` instead.',
    })
  }

  if (!semantics.hasMetaCharset) collector.report('DOC004', where)

  // --- language ------------------------------------------------------------------------------
  if (semantics.lang === undefined || semantics.lang.trim() === '') {
    collector.report('A11Y001', {
      ...where,
      message: `Route '${page.routePath}' renders <html> without a lang attribute.`,
    })
  }

  // --- viewport ------------------------------------------------------------------------------
  if (semantics.viewport === undefined) {
    collector.report('A11Y003', {
      ...where,
      message: `Route '${page.routePath}' declares no viewport meta.`,
    })
  } else if (viewportBlocksZoom(semantics.viewport)) {
    collector.report('A11Y002', {
      ...where,
      message:
        `Route '${page.routePath}' has a viewport that prevents zoom: '${semantics.viewport}'.`,
      hint: 'Remove user-scalable=no and any maximum-scale below 2.',
    })
  }

  // --- headings ------------------------------------------------------------------------------
  if (semantics.h1Count === 0) {
    collector.report('A11Y006', {
      ...where,
      message:
        `Route '${page.routePath}' contains no <h1>. This is not a requirement of HTML, WCAG or Google Search; it is reported because it often indicates an incomplete template.`,
    })
  } else if (semantics.h1Count > 1) {
    collector.report('A11Y008', {
      ...where,
      message: `Route '${page.routePath}' contains ${semantics.h1Count} <h1> elements. Valid HTML.`,
    })
  }

  // --- content -------------------------------------------------------------------------------
  if (!semantics.hasTextContent) {
    collector.report('SEO008', {
      ...where,
      message: `Route '${page.routePath}' rendered no text content.`,
    })
  }

  // --- rules needing the raw markup ------------------------------------------------------------
  if (html !== undefined) {
    const missingAlt = imagesWithoutAlt(html)
    if (missingAlt > 0) {
      collector.report('A11Y004', {
        ...where,
        message:
          `Route '${page.routePath}' has ${missingAlt} <img> element(s) with no alt attribute.`,
        hint: 'Use alt="" for decorative images — that is correct and is never reported.',
      })
    }

    const namelessLinks = linksWithoutAccessibleName(html)
    if (namelessLinks > 0) {
      collector.report('A11Y005', {
        ...where,
        message: `Route '${page.routePath}' has ${namelessLinks} link(s) with no accessible name.`,
      })
    }

    const skip = firstHeadingSkip(html)
    if (skip) {
      collector.report('A11Y007', {
        ...where,
        message: `Route '${page.routePath}' skips from h${skip.from} to h${skip.to}.`,
      })
    }
  }

  return collector.results()
}

/**
 * Runs {@linkcode validateRenderedDocument} over several routes, returning one merged list in the
 * same stable order a single route's findings come back in.
 *
 * Sorting only. Each finding was already resolved against `config` by the call that produced it, so
 * merging must never re-report them through a fresh collector — that would run the same severity
 * policy a second time and discard each finding's own resolution trace in the process.
 */
export function validateRenderedDocuments(
  pages: RenderedPageInput[],
  config: ValidationConfig = {},
): Diagnostic[] {
  return sortDiagnostics(pages.flatMap((page) => validateRenderedDocument(page, config)))
}
