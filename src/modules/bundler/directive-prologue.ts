/**
 * Source of the leading-comments prefix every directive-prologue regex shares: any run of `//` line
 * comments and `/* *\/` block comments (each optionally preceded by whitespace), then optional
 * whitespace, before the directive's own string literal.
 *
 * The block-comment body is the standard C-comment pattern, `[^*]*\*+(?:[^/*][^*]*\*+)*`, which ends
 * at the FIRST closing `*\/`. The lazy `[\s\S]*?` alternative can also span a later `*\/`, so the
 * same text parses several ways inside the repeated group; on a source with no directive (any CSS
 * file with many comments, most of all a stylesheet an `@import` chain concatenated) the engine
 * explores every one of those splits and the time grows exponentially with the number of comments.
 * Every comment here has exactly one parse, so a rejection is linear in the source length.
 *
 * Lives in its own module, with no imports, so {@linkcode USE_COMET_DIRECTIVE} and
 * {@linkcode SERVER_ONLY_DIRECTIVE} (and any future directive) build from the one prefix instead of
 * each carrying a copy that could drift.
 */
const DIRECTIVE_LEADING_COMMENTS = String
  .raw`(?:\s*\/\/[^\n]*\n|\s*\/\*[^*]*\*+(?:[^/*][^*]*\*+)*\/)*\s*`

/**
 * Builds the regex that recognizes `directive` as a string-literal directive prologue: optional
 * leading comments, then `'directive'` or `"directive"` with an optional `;`, anchored at the start
 * of the source.
 *
 * @param directive - The directive text, without quotes. Must not contain regex metacharacters
 * other than `-`, which is literal outside a character class.
 * @returns A non-global regex, so `test()` carries no `lastIndex` state between calls.
 */
export function directivePrologueRegex(directive: string): RegExp {
  return new RegExp(`^${DIRECTIVE_LEADING_COMMENTS}(['"])${directive}\\1;?`)
}
