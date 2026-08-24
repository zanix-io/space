import { join } from '@std/path'
import logger from '@zanix/logger'
import { InternalError } from '@zanix/errors'
import { isDevClientEnabled } from 'modules/dev/dev-client-registry.ts'
import { getMessagesDir } from './messages-registry.ts'

/** A flat message catalog — namespaced string keys mapping to message strings, e.g.
 * `{ 'products/title': 'Our products' }`. Deliberately NOT nested objects: a shallow merge (base
 * catalog, then population override) is only correct for a flat shape — see {@linkcode loadMessages}'s
 * own doc for why this is a real constraint, not an arbitrary choice. */
export type Messages = Record<string, string>

/** Options for {@linkcode loadMessages}. */
export type LoadMessagesOptions = {
  /** The language to load — matches `langPreHandler`'s own `availableLangs`/`:lang` route segment,
   * e.g. `'en'`. Looked up as `{messagesDir}/{lang}/index.json`. */
  lang: string
  /** The population/segment to overlay on top of the base language catalog, e.g. from
   * `populationGuard`'s own `ctx.population`. Omitted entirely (not just falsy) skips override
   * resolution altogether — looked up as `{messagesDir}/{lang}/populations/{population}.json`. */
  population?: string
}

const cache = new Map<string, Messages>()
const inFlight = new Map<string, Promise<Messages>>()

/** Test-only escape hatch — clears both the resolved-message cache and any in-flight resolution,
 * for test isolation between fixtures that reuse the same `lang`/`population` keys. Not exported
 * from this package's public entry points. */
export function resetMessagesCache(): void {
  cache.clear()
  inFlight.clear()
}

async function readJsonObject(path: string): Promise<Messages | undefined> {
  let raw: string
  try {
    raw = await Deno.readTextFile(path)
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return undefined
    // A native `Deno.errors.*` besides `NotFound` (permission denied, disk failure, ...) must
    // never cross this function unwrapped: its raw `.message` routinely embeds a real, absolute
    // filesystem path — `loadMessages()` is called from a page's own `loader`, and an unwrapped
    // native error thrown there is caught by `@zanix/server`'s `routerInterceptor` and turned
    // straight into an HTTP error response via `getPublicErrorResponse`, which allowlists
    // `message` by default (this never reaches `error.tsx`'s fallback — that boundary only
    // catches RENDER errors, not a `loader` throw). The real error detail still reaches the log
    // via `cause`.
    throw new InternalError('Failed to read a message catalog file from disk.', {
      code: 'SPACE_I18N_MESSAGES_READ_FAILED',
      meta: { source: 'zanix', path },
      cause: error,
    })
  }

  try {
    const parsed = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new TypeError('expected a flat JSON object')
    }
    return parsed as Messages
  } catch (error) {
    logger.error(`Malformed message file, skipped: ${path}`, error)
    return undefined
  }
}

/** First directory (in array order) whose `{dir}/{relativePath}` exists and parses — mirrors
 * `scanAssets`'s own first-match-wins precedent, but resolved lazily for one known path instead of
 * an eager whole-directory walk (a message catalog has a small, bounded key space — `lang` ×
 * `population` — unlike an asset's arbitrary request path). */
async function resolveFirstMatch(
  dirs: string[],
  relativePath: string,
): Promise<Messages | undefined> {
  // Genuinely sequential: first-match-wins means a LATER directory must never even be read once
  // an earlier one already answered, same contract `scanAssets`'s own doc states — a `Promise.all`
  // here would read every directory regardless.
  for (const dir of dirs) {
    // deno-lint-ignore no-await-in-loop -- see the comment above the loop
    const found = await readJsonObject(join(dir, relativePath))
    if (found) return found
  }
  return undefined
}

async function resolve(lang: string, population: string | undefined): Promise<Messages> {
  const configured = getMessagesDir()
  if (configured === undefined) {
    logger.warn(
      "loadMessages() called but this app never declared 'messagesDir' in defineSpaceApp() " +
        '— returning an empty catalog',
    )
    return {}
  }
  const dirs = Array.isArray(configured) ? configured : [configured]

  const [base, override] = await Promise.all([
    resolveFirstMatch(dirs, `${lang}/index.json`),
    population ? resolveFirstMatch(dirs, `${lang}/populations/${population}.json`) : undefined,
  ])

  if (!base) {
    logger.warn(`No message file for lang '${lang}' in any configured messagesDir`)
    return override ?? {}
  }

  return override ? { ...base, ...override } : base
}

/**
 * Resolves the message catalog for a `(lang, population)` pair — the "content resolution" half of
 * i18n (population/language IDENTIFICATION is `populationGuard`/`langPreHandler`/`langGuard`'s own
 * job, not this function's). Uses flat catalogs, a shallow override merge, and a module-lifetime
 * cache, and returns a plain {@linkcode Messages} object; formatting (plurals, dates, ICU) is
 * entirely the consuming app's own concern, using whatever library it prefers.
 *
 * Reads `{messagesDir}/{lang}/index.json` (the base catalog) and, when `population` is given,
 * `{messagesDir}/{lang}/populations/{population}.json` (an override — only the keys that differ
 * from the base need to be present), then shallow-merges them: `{ ...base, ...override }`. This is
 * only correct because catalogs are flat, namespaced-string-key objects, never nested — a nested
 * shape would need a real deep merge instead, silently losing sibling keys otherwise.
 *
 * A missing override file is normal (not every population overrides every language) and resolves
 * silently to the base catalog. A missing BASE file logs a warning and resolves to `{}` (or the
 * override alone, if one somehow exists without a base) — language-level fallback (redirecting to
 * `defaultLang`) is `langPreHandler`'s job, not this function's; by the time a page's `loader` calls
 * this, the URL's `lang` is already one of `availableLangs`. A MALFORMED file (invalid JSON, or not
 * a flat object) logs an error and is treated as missing — critically, the base and override are
 * each read and validated INDEPENDENTLY: a broken override file degrades to base-only instead of
 * discarding otherwise-valid base content.
 *
 * Cached for the process lifetime, keyed by `${lang}:${population ?? ''}` — the explicit delimiter
 * keeps two different `(lang, population)` pairs from ever colliding on the same concatenated
 * string, regardless of either value's length. Concurrent calls for the same not-yet-cached key
 * share a single in-flight resolution instead of each redoing the same file I/O.
 *
 * **The cache is bypassed entirely under `znx space dev`** (`isDevClientEnabled()`), so editing a
 * message file while the dev server is running is reflected on the very next request — no restart
 * needed, the same live-edit experience `assetsDir`'s own per-request `Deno.readFile` already gives
 * (concurrent in-flight de-duplication still applies even in dev; only the CACHE read/write is
 * skipped). This is automatic, driven by the SAME dev-mode flag every other Space dev-time behavior
 * already reads, not an opt-in flag a caller has to remember to pass.
 *
 * Deliberately deferred, not implemented here: a secondary "lazy content" tier fetched after first
 * paint. `@zanix/space` is SSR-first, so a page's `loader` already resolves (and embeds in the
 * initial serialized state) whatever it calls `loadMessages()` for; there's no post-hydration gap to
 * fill the way a CSR-first app would need to. If a real page ever needs to defer a genuinely large,
 * non-critical message subset, a Comet (this package's own selective-hydration mechanism) fetching
 * its own subset on hydration is the natural fit — not a bespoke fetch layer.
 *
 * @example
 * ```tsx
 * loader = async (ctx: { params: { lang: string }; population?: string }) => ({
 *   messages: await loadMessages({ lang: ctx.params.lang, population: ctx.population }),
 * })
 * component = ({ messages }: { messages: Messages }) => <h1>{messages['home/title']}</h1>
 * ```
 */
export function loadMessages(options: LoadMessagesOptions): Promise<Messages> {
  const { lang, population } = options
  const key = `${lang}:${population ?? ''}`
  const devMode = isDevClientEnabled()

  if (!devMode) {
    const cached = cache.get(key)
    if (cached) return Promise.resolve(cached)
  }

  const pending = inFlight.get(key)
  if (pending) return pending

  const promise = resolve(lang, population).then((messages) => {
    if (!devMode) cache.set(key, messages)
    inFlight.delete(key)
    return messages
  })
  inFlight.set(key, promise)
  return promise
}
