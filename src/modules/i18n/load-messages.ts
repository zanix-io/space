import { join } from '@std/path'
import logger from '@zanix/logger'
import { InternalError } from '@zanix/errors'
import { isDevClientEnabled } from 'modules/dev/dev-client-registry.ts'
import { getMessagesBuildDir, getMessagesDir, getMessageSources } from './messages-registry.ts'
import type { Messages, MessagesSource } from './messages-types.ts'

export type { CompiledMessageNode, Messages } from './messages-types.ts'

/** Options for {@linkcode loadMessages}. */
export type LoadMessagesOptions = {
  /** The language to load — matches `langPreHandler`'s own `availableLangs`/`:lang` route segment,
   * e.g. `'en'`. Resolved from every `.json` file directly under `{messagesDir}/{lang}/` (see
   * {@linkcode loadMessages}'s own doc for how those merge) — `index.json` is the conventional
   * default, not the only file read. */
  lang: string
  /** The population/segment to overlay on top of the base language catalog, e.g. from
   * `populationGuard`'s own `ctx.population`. Omitted entirely (not just falsy) skips override
   * resolution altogether — looked up as `{messagesDir}/{lang}/populations/{population}.json`. */
  population?: string
}

const cache = new Map<string, Messages>()
const inFlight = new Map<string, Promise<Messages>>()

/** Test-only escape hatch — clears both the resolved-message cache and any in-flight resolution,
 * for test isolation between fixtures that reuse the same `lang`/`population` keys. Re-exported
 * from `@zanix/space/testing` (see `mock-messages.ts`'s own doc) for a consumer app's own tests;
 * this package's own test suite still imports it directly, by relative path. */
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

/** Merges catalog layers key by key, the earlier layer winning a key both define. `undefined`
 * layers are skipped, and no layer at all resolves to `undefined`. */
function mergeLayers(layers: (Messages | undefined)[]): Messages | undefined {
  const present = layers.filter((layer): layer is Messages => layer !== undefined)
  if (present.length === 0) return undefined
  return present.reduceRight((merged, layer) => ({ ...merged, ...layer }), {})
}

/** Every directory's `{dir}/{relativePath}` that exists and parses, merged key by key with the
 * earlier directory winning a shared key — so a host directory overrides single messages of a base
 * directory without copying the file. Every directory is read: a key only a later one defines
 * still resolves. */
async function readLayered(dirs: string[], relativePath: string): Promise<Messages | undefined> {
  const layers = await Promise.all(dirs.map((dir) => readJsonObject(join(dir, relativePath))))
  return mergeLayers(layers)
}

/** What every declared source returns for one request, merged with the earlier source winning a
 * shared key. A source that throws, or returns something that is not a flat object, is logged and
 * skipped — the same per-file isolation a malformed catalog file gets. */
async function readSources(
  sources: MessagesSource[],
  lang: string,
  population: string | undefined,
): Promise<Messages | undefined> {
  const layers = await Promise.all(sources.map(async (source) => {
    try {
      const result = await source(lang, population)
      if (result === undefined) return undefined
      if (typeof result !== 'object' || result === null || Array.isArray(result)) {
        throw new TypeError('expected a flat object')
      }
      return result
    } catch (error) {
      logger.error(
        `A message source failed for lang '${lang}'${
          population ? ` and population '${population}'` : ''
        }, skipped`,
        error,
      )
      return undefined
    }
  }))
  return mergeLayers(layers)
}

/** Every `.json` file directly under `dir` — non-recursive, so a `populations/` subdirectory entry
 * is skipped exactly like any other directory entry, never walked into. This is the discovery half
 * of base-catalog segmentation ({@linkcode resolve}'s own doc): a plain filename list, not yet
 * resolved against `messagesDir`'s own array/first-match-wins semantics. `[]`, not a throw, when
 * `dir` itself doesn't exist — a root with no catalog at all for this `lang` is normal, mirrored by
 * every OTHER root still getting its own chance in {@linkcode resolve}. */
async function listSegmentFiles(dir: string): Promise<string[]> {
  const names: string[] = []
  try {
    for await (const entry of Deno.readDir(dir)) {
      if (entry.isFile && entry.name.endsWith('.json')) names.push(entry.name)
    }
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return names
    // Same "never leak a raw native error out of a `loader`" contract `readJsonObject` already
    // documents in full — see that function's own comment for why.
    throw new InternalError('Failed to list a message catalog directory from disk.', {
      code: 'SPACE_I18N_MESSAGES_READ_FAILED',
      meta: { source: 'zanix', path: dir },
      cause: error,
    })
  }
  return names
}

/** Every distinct base-segment filename across every root, for one `lang` — the UNION, not just
 * the first root's own listing, so a segment that exists only in a later root (host composition) still gets discovered and merged. Sorted so
 * merge order is deterministic across roots/platforms/directory-read ordering, not just
 * per-root-insertion-order — segments are expected to be namespaced/disjoint (see `loadMessages`'s
 * own doc), so this order only matters for the rare, non-recommended case of an actual key
 * collision between two segment files. */
async function listBaseSegmentNames(dirs: string[], lang: string): Promise<string[]> {
  const perRoot = await Promise.all(dirs.map((dir) => listSegmentFiles(join(dir, lang))))
  const names = new Set<string>()
  for (const found of perRoot) for (const name of found) names.add(name)
  return [...names].sort()
}

async function resolve(lang: string, population: string | undefined): Promise<Messages> {
  const configured = getMessagesDir()
  const sources = getMessageSources()
  if (configured === undefined && sources.length === 0) {
    logger.warn(
      "loadMessages() called but this app never declared 'messagesDir' or 'messageSources' in " +
        'defineSpaceApp() — returning an empty catalog',
    )
    return {}
  }
  const roots = configured === undefined
    ? []
    : Array.isArray(configured)
    ? configured
    : [configured]

  // `zanix space build` compiles this app's catalogs to `{clientBuildDir}/messages/{index}/...`
  // — mirroring `roots`' own array order/index, NEVER `messagesDir` itself (see
  // `writeCompiledMessagesTree`'s own doc in `@zanix/cli`). Read from there in production when
  // configured; `zanix space dev` never compiles anything, so it always reads `messagesDir` live,
  // same `!isDevClientEnabled()` gate `clientBuildDir`'s own consumption
  // (`define-space-app.ts`) already uses — a stale build dir on disk during dev must never win.
  const buildDir = getMessagesBuildDir()
  const dirs = buildDir !== undefined && !isDevClientEnabled()
    ? roots.map((_, index) => `${buildDir}/messages/${index}`)
    : roots

  const segmentNames = await listBaseSegmentNames(dirs, lang)
  const [segments, dirOverride, sourceBase, sourceOverride] = await Promise.all([
    Promise.all(segmentNames.map((name) => readLayered(dirs, `${lang}/${name}`))),
    population ? readLayered(dirs, `${lang}/populations/${population}.json`) : undefined,
    readSources(sources, lang, undefined),
    population ? readSources(sources, lang, population) : undefined,
  ])

  // A segment resolves to `undefined` when every root's copy was malformed (already logged by
  // `readJsonObject` itself) — filtered out here rather than failing the whole catalog, same
  // per-file isolation `compileMessagesTree`'s own doc in `@zanix/cli` establishes for the
  // build-time compiler. No valid segment and no source content collapses to the same "no message
  // file" signal a single missing/malformed `index.json` always gave before segmentation existed.
  const validSegments = segments.filter((segment): segment is Messages => segment !== undefined)
  const override = mergeLayers([dirOverride, sourceOverride])
  if (validSegments.length === 0 && sourceBase === undefined) {
    logger.warn(
      `No message file for lang '${lang}' in any configured messagesDir or message source`,
    )
    return override ?? {}
  }

  // The app's own directories win over the sources: a source is a package's default, the
  // directories are the app's own words.
  const dirBase = validSegments.reduce((merged, segment) => ({ ...merged, ...segment }), {})
  const base = { ...sourceBase, ...dirBase }
  return override ? { ...base, ...override } : base
}

/**
 * Resolves the message catalog for a `(lang, population)` pair — the "content resolution" half of
 * i18n (population/language IDENTIFICATION is `populationGuard`/`langPreHandler`/`langGuard`'s own
 * job, not this function's). Uses flat catalogs, a shallow override merge, and a module-lifetime
 * cache, and returns a plain {@linkcode Messages} object; formatting (plurals, dates, ICU) is
 * entirely the consuming app's own concern, using whatever library it prefers.
 *
 * Reads the BASE catalog as every `.json` file found directly under `{messagesDir}/{lang}/` (never
 * recursing into `populations/`, which stays reserved for overrides below) — `index.json` is the
 * conventional single-file default, not a hardcoded requirement: an app free to split its base
 * catalog into feature-segmented files instead, e.g. `iam.json`, `profile.json`, `chat.json`,
 * alongside (or instead of) `index.json`. Every segment file found is shallow-merged together, in
 * filename-sorted order, into one base catalog — segments are expected to be namespaced/disjoint
 * (`'profile/name'`, `'chat/heading'`, ...), so merge order only matters for the unrecommended case
 * of two segment files actually sharing a key. With several `messagesDir` roots, a file present in
 * more than one is merged key by key, the earlier root winning a shared key and a key only a later
 * root defines still resolving, so a host overrides single messages without copying a file. Sources
 * declared through `defineSpaceApp({ messageSources })` fill in below the directories: a key the
 * app's own catalogs define always wins over a source's. When `population` is given,
 * `{messagesDir}/{lang}/populations/{population}.json` (an override — only the keys that differ
 * from the base need to be present) is shallow-merged on top of that merged base: `{ ...base,
 * ...override }`. This is only correct because catalogs are flat, namespaced-string-key objects,
 * never nested — a nested shape would need a real deep merge instead, silently losing sibling keys
 * otherwise.
 *
 * **In production, with `clientBuildDir` configured, reads from `{clientBuildDir}/messages/...`
 * instead** — where `zanix space build` compiles this app's ICU catalogs to AST, mirroring
 * `clientBuildDir`'s own "compiled output lives in its own directory, source is never touched"
 * contract (see `SpaceAppConfig.clientBuildDir`'s own doc). `messagesDir` itself is NEVER
 * overwritten. `zanix space dev` always reads `messagesDir` live — same dev/prod split
 * `clientBuildDir`'s own consumption already uses.
 *
 * A missing override file is normal (not every population overrides every language) and resolves
 * silently to the base catalog. Finding NO base segment file at all (no `index.json`, no other
 * `.json` file directly under `{lang}/`) logs a warning and resolves to `{}` (or the override
 * alone, if one somehow exists without a base) — language-level fallback (redirecting to
 * `defaultLang`) is `langPreHandler`'s job, not this function's; by the time a page's `loader` calls
 * this, the URL's `lang` is already one of `availableLangs`. A MALFORMED file (invalid JSON, or not
 * a flat object) logs an error and is treated as missing — critically, every base segment and the
 * override are each read and validated INDEPENDENTLY: one broken segment file degrades the merge to
 * every OTHER valid segment plus the override, never discarding otherwise-valid content elsewhere in
 * the catalog; only finding zero valid segments falls back to the "no base catalog" warning above.
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
 * import { IntlProvider, useIntl } from '@zanix/space-ui'
 *
 * loader = async (ctx: { params: { lang: string }; population?: string }) => ({
 *   lang: ctx.params.lang,
 *   messages: await loadMessages({ lang: ctx.params.lang, population: ctx.population }),
 * })
 *
 * // NEVER interpolate `messages[key]` directly — once `zanix space build` compiles this app's
 * // `messagesDir`, a catalog value is a `CompiledMessageNode[]`, not a `string` (see
 * // {@linkcode Messages}'s own doc), and rendering that array as a JSX child crashes at runtime.
 * // Always format through `@zanix/space-ui`'s `IntlProvider`/`useIntl`, which accepts either shape.
 * component = ({ lang, messages }) => (
 *   <IntlProvider locale={lang} messages={messages}>
 *     <Content />
 *   </IntlProvider>
 * )
 * function Content() {
 *   const { formatMessage } = useIntl()
 *   return <h1>{formatMessage('home/title')}</h1>
 * }
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
