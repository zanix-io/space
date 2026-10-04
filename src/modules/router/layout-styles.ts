import { InternalError } from '@zanix/errors'
import type { StylesheetRef } from '../render/css-manifest.ts'

/**
 * Reads a layout module's `styles` export and checks its shape: an array whose entries are an href
 * string or an `{ href, media? }` object — the same shape a page's `static styles` takes. Anything
 * else is a mistake in the layout, reported where the layout is loaded (`loadRoutes()`, and the
 * client build) instead of surfacing later as a stylesheet that never links.
 *
 * Shared by `loadRoutes()` and the build's page discovery, so both read the export the same way.
 *
 * @param layoutFilePath - The layout's source path, for the error message only.
 * @param value - The module's `styles` export (`undefined` when it declares none).
 * @returns The declared stylesheets, or `undefined` when the layout declares none.
 * @throws {InternalError} When `styles` is declared and is not that shape.
 */
export function readLayoutStyles(
  layoutFilePath: string | undefined,
  value: unknown,
): StylesheetRef[] | undefined {
  if (value === undefined) return undefined
  const valid = Array.isArray(value) && value.every((entry) =>
    typeof entry === 'string' ||
    (typeof entry === 'object' && entry !== null &&
      typeof (entry as { href?: unknown }).href === 'string' &&
      ((entry as { media?: unknown }).media === undefined ||
        typeof (entry as { media?: unknown }).media === 'string'))
  )
  if (!valid) {
    throw new InternalError(
      `The layout "${layoutFilePath}" exports a \`styles\` that is not a list of stylesheets: ` +
        "export an array of 'href' strings or { href, media } objects, relative to the layout file.",
      { code: 'SPACE_LAYOUT_STYLES_INVALID', meta: { source: 'zanix', layoutFilePath } },
    )
  }
  return value as StylesheetRef[]
}
