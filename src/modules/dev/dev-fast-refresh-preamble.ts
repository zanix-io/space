/**
 * Hand-written, NOT imported from `@vitejs/plugin-react` (`viteReact.preambleCode`) — that package
 * is a dev/build-only npm dependency (`spacePlugin`'s own `client`-environment wiring), and this
 * module is reached from `render-to-response.tsx`, the production SSR path every request goes
 * through. Importing it here would pull `@vitejs/plugin-react` into every production render, the
 * exact class of eager-heavy-import regression already fixed once in `@zanix/cli` (see
 * `space/build/command.ts`'s own doc there). The content itself is small and stable enough to keep
 * as a literal, verified against the real package's own `preambleCode` export in this file's own
 * test (a real, disposable comparison — not an assumption it'll never drift).
 *
 * Must run as `type="module"` (it contains a real `import` statement) — the preamble content
 * itself, as-is, is invalid inside a classic `<script>`.
 */
function preambleSource(base: string): string {
  return `import { injectIntoGlobalHook } from "${base}@react-refresh";
injectIntoGlobalHook(window);
window.$RefreshReg$ = () => {};
window.$RefreshSig$ = () => (type) => type;`
}

/**
 * Builds the React Fast Refresh preamble script `renderToResponse` injects (as a `type="module"`
 * `<script>`, dev-mode only, whenever `devClient` is set — same gate as
 * {@linkcode buildDevClientScript}) — registers `window.$RefreshReg$`/`window.$RefreshSig$` and
 * connects `/@react-refresh`'s own runtime to `window` via `injectIntoGlobalHook`, BEFORE any
 * Comet's own transformed code runs. Every Comet transformed with `spacePlugin()`'s own `react()`
 * wired in calls `$RefreshSig$()`/`$RefreshReg$()` unconditionally at module evaluation time
 * (confirmed via a real, disposable spike reading the actual transform output) — without this
 * preamble having already run first, that throws `@vitejs/plugin-react can't detect preamble`.
 *
 * Placed BEFORE `bootstrapModules`' own emitted `<script type="module">` tags in document order —
 * `type="module"` scripts execute in relative document order (same guarantee `defer` gives classic
 * scripts) unless marked `async`, and neither this script nor React's own bootstrap scripts are, so
 * this one always finishes registering the globals first.
 *
 * @param base - The site's own base path, matching whatever Vite `base` config (if any) is in
 * effect. `@zanix/space`'s own bundler code never sets a custom one anywhere today, so this
 * defaults to `'/'` — the same assumption `dev-css-hrefs.ts`'s own root-relative paths already make.
 */
export function buildFastRefreshPreambleScript(base = '/'): string {
  return preambleSource(base)
}
