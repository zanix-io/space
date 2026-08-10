// deno-coverage-ignore-file

/**
 * Removes the `<!-- -->` markers React's SSR output inserts between adjacent text
 * expressions/nodes to mark hydration boundaries — shared by every test that asserts on rendered
 * HTML content, so each test file doesn't re-implement the same regex.
 */
export function stripHydrationComments(html: string): string {
  return html.replace(/<!--\s*-->/g, '')
}
