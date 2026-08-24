import { assertEquals, assertRejects } from '@std/assert'
import { dirname, join } from '@std/path'
import logger from '@zanix/logger'
import { getTemporaryFolder } from '@zanix/helpers'
import { InternalError } from '@zanix/errors'
import { setDevClientEnabled } from 'modules/dev/dev-client-registry.ts'
import { loadMessages, resetMessagesCache } from 'modules/i18n/load-messages.ts'
import { resetMessagesDir, setMessagesDir } from 'modules/i18n/messages-registry.ts'

const TMP_ROOT = getTemporaryFolder(import.meta.url)

console.error = () => {}

async function withTempDir(build: (dir: string) => Promise<void>): Promise<string> {
  const dir = await Deno.makeTempDir({ dir: TMP_ROOT })
  await build(dir)
  return dir
}

async function writeJson(path: string, content: unknown): Promise<void> {
  await Deno.mkdir(dirname(path), { recursive: true })
  await Deno.writeTextFile(path, JSON.stringify(content))
}

async function cleanup(...dirs: string[]): Promise<void> {
  await Promise.all(dirs.map((dir) => Deno.remove(dir, { recursive: true })))
}

function reset() {
  resetMessagesDir()
  resetMessagesCache()
}

function countCalls(method: 'warn' | 'error'): { count: () => number; restore: () => void } {
  const original = logger[method]
  let calls = 0
  logger[method] = ((...args: unknown[]) => {
    calls++
    return original.apply(logger, args as never)
  }) as typeof original
  return { count: () => calls, restore: () => (logger[method] = original) }
}

Deno.test(
  'loadMessages: with no messagesDir configured, warns and resolves to an empty catalog',
  async () => {
    reset()
    const warn = countCalls('warn')
    try {
      const messages = await loadMessages({ lang: 'en' })
      assertEquals(messages, {})
      assertEquals(warn.count(), 1)
    } finally {
      warn.restore()
    }
  },
)

Deno.test('loadMessages: resolves the base catalog with no population given', async () => {
  reset()
  const dir = await withTempDir(async (dir) => {
    await writeJson(join(dir, 'en', 'index.json'), { 'home/title': 'Welcome' })
  })
  try {
    setMessagesDir(dir)
    const messages = await loadMessages({ lang: 'en' })
    assertEquals(messages, { 'home/title': 'Welcome' })
  } finally {
    await cleanup(dir)
  }
})

Deno.test(
  'loadMessages: a population override merges over the base, override keys win',
  async () => {
    reset()
    const dir = await withTempDir(async (dir) => {
      await writeJson(join(dir, 'en', 'index.json'), {
        'home/title': 'Welcome',
        'home/subtitle': 'Generic subtitle',
      })
      await writeJson(join(dir, 'en', 'populations', 'zanix.json'), {
        'home/title': 'Welcome to Zanix',
      })
    })
    try {
      setMessagesDir(dir)
      const messages = await loadMessages({ lang: 'en', population: 'zanix' })
      assertEquals(messages, {
        'home/title': 'Welcome to Zanix',
        'home/subtitle': 'Generic subtitle',
      })
    } finally {
      await cleanup(dir)
    }
  },
)

Deno.test(
  'loadMessages: a population with no override file at all silently resolves to base-only',
  async () => {
    reset()
    const dir = await withTempDir(async (dir) => {
      await writeJson(join(dir, 'en', 'index.json'), { 'home/title': 'Welcome' })
    })
    try {
      setMessagesDir(dir)
      const messages = await loadMessages({ lang: 'en', population: 'unknown-population' })
      assertEquals(messages, { 'home/title': 'Welcome' })
    } finally {
      await cleanup(dir)
    }
  },
)

Deno.test(
  'loadMessages: a missing base language warns and resolves to an empty catalog',
  async () => {
    reset()
    const dir = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      setMessagesDir(dir)
      const warn = countCalls('warn')
      try {
        const messages = await loadMessages({ lang: 'fr' })
        assertEquals(messages, {})
        assertEquals(warn.count(), 1)
      } finally {
        warn.restore()
      }
    } finally {
      await cleanup(dir)
    }
  },
)

Deno.test(
  'loadMessages: a malformed population override degrades to base-only, base content survives',
  async () => {
    reset()
    const dir = await withTempDir(async (dir) => {
      await writeJson(join(dir, 'en', 'index.json'), { 'home/title': 'Welcome' })
      await Deno.mkdir(join(dir, 'en', 'populations'), { recursive: true })
      await Deno.writeTextFile(join(dir, 'en', 'populations', 'zanix.json'), '{ not valid json')
    })
    try {
      setMessagesDir(dir)
      const error = countCalls('error')
      try {
        const messages = await loadMessages({ lang: 'en', population: 'zanix' })
        assertEquals(messages, { 'home/title': 'Welcome' })
        assertEquals(error.count(), 1)
      } finally {
        error.restore()
      }
    } finally {
      await cleanup(dir)
    }
  },
)

Deno.test(
  'loadMessages: a malformed base file logs and resolves to an empty catalog, not a throw',
  async () => {
    reset()
    const dir = await withTempDir(async (dir) => {
      await Deno.mkdir(join(dir, 'en'), { recursive: true })
      await Deno.writeTextFile(join(dir, 'en', 'index.json'), '["not", "an", "object"]')
    })
    try {
      setMessagesDir(dir)
      const error = countCalls('error')
      const warn = countCalls('warn')
      try {
        const messages = await loadMessages({ lang: 'en' })
        assertEquals(messages, {})
        assertEquals(error.count(), 1)
        assertEquals(warn.count(), 1)
      } finally {
        error.restore()
        warn.restore()
      }
    } finally {
      await cleanup(dir)
    }
  },
)

Deno.test(
  'loadMessages(messagesDir[]): the base and override resolve independently, first-match-wins each',
  async () => {
    reset()
    const overrideDir = await Deno.makeTempDir({ dir: TMP_ROOT })
    const baseDir = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      // Base only exists in the base dir; the override only exists in the override dir — both must
      // still resolve and merge, even though neither directory alone has both pieces.
      await writeJson(join(baseDir, 'en', 'index.json'), { 'home/title': 'Welcome' })
      await writeJson(join(overrideDir, 'en', 'populations', 'zanix.json'), {
        'home/title': 'Welcome to Zanix',
      })
      setMessagesDir([overrideDir, baseDir])
      const messages = await loadMessages({ lang: 'en', population: 'zanix' })
      assertEquals(messages, { 'home/title': 'Welcome to Zanix' })
    } finally {
      await cleanup(overrideDir, baseDir)
    }
  },
)

Deno.test(
  "loadMessages(messagesDir[]): an earlier directory's base catalog shadows a later one entirely",
  async () => {
    reset()
    const overrideDir = await Deno.makeTempDir({ dir: TMP_ROOT })
    const baseDir = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      await writeJson(join(overrideDir, 'en', 'index.json'), { 'home/title': 'From override dir' })
      await writeJson(join(baseDir, 'en', 'index.json'), { 'home/title': 'From base dir' })
      setMessagesDir([overrideDir, baseDir])
      const messages = await loadMessages({ lang: 'en' })
      assertEquals(messages, { 'home/title': 'From override dir' })
    } finally {
      await cleanup(overrideDir, baseDir)
    }
  },
)

Deno.test('loadMessages: a second call for the same key reuses the cache, no re-read', async () => {
  reset()
  const dir = await withTempDir(async (dir) => {
    await writeJson(join(dir, 'en', 'index.json'), { 'home/title': 'Welcome' })
  })
  try {
    setMessagesDir(dir)
    const first = await loadMessages({ lang: 'en' })
    // Overwrite on disk — a cached second call must NOT see this, proving reuse rather than re-read.
    await writeJson(join(dir, 'en', 'index.json'), { 'home/title': 'Changed' })
    const second = await loadMessages({ lang: 'en' })
    assertEquals(first, second)
    assertEquals(second, { 'home/title': 'Welcome' })
  } finally {
    await cleanup(dir)
  }
})

Deno.test(
  'loadMessages: concurrent calls for the same not-yet-cached key share one in-flight resolution',
  async () => {
    reset()
    const dir = await withTempDir(async (dir) => {
      await writeJson(join(dir, 'en', 'index.json'), { 'home/title': 'Welcome' })
    })
    try {
      setMessagesDir(dir)
      const [a, b, c] = await Promise.all([
        loadMessages({ lang: 'en' }),
        loadMessages({ lang: 'en' }),
        loadMessages({ lang: 'en' }),
      ])
      assertEquals(a, { 'home/title': 'Welcome' })
      assertEquals(a, b)
      assertEquals(b, c)
    } finally {
      await cleanup(dir)
    }
  },
)

Deno.test(
  'loadMessages: the cache key composes lang and population with a delimiter, no collision',
  async () => {
    reset()
    const dir = await withTempDir(async (dir) => {
      await writeJson(join(dir, 'en', 'index.json'), { greet: 'base' })
      await writeJson(join(dir, 'en', 'populations', 'x.json'), { greet: 'pop-x' })
    })
    try {
      setMessagesDir(dir)
      // 'en' + undefined and 'en' + 'x' must never collide into the same cache key.
      const withoutPop = await loadMessages({ lang: 'en' })
      const withPop = await loadMessages({ lang: 'en', population: 'x' })
      assertEquals(withoutPop, { greet: 'base' })
      assertEquals(withPop, { greet: 'pop-x' })
    } finally {
      await cleanup(dir)
    }
  },
)

Deno.test(
  'loadMessages: under dev mode (isDevClientEnabled), the cache is bypassed — an edited file is ' +
    'reflected on the very next call, no restart needed',
  async () => {
    reset()
    const dir = await withTempDir(async (dir) => {
      await writeJson(join(dir, 'en', 'index.json'), { 'home/title': 'Welcome' })
    })
    try {
      setMessagesDir(dir)
      setDevClientEnabled(true)
      try {
        const first = await loadMessages({ lang: 'en' })
        assertEquals(first, { 'home/title': 'Welcome' })

        await writeJson(join(dir, 'en', 'index.json'), { 'home/title': 'Changed' })
        const second = await loadMessages({ lang: 'en' })
        assertEquals(second, { 'home/title': 'Changed' })
      } finally {
        setDevClientEnabled(false)
      }
    } finally {
      await cleanup(dir)
    }
  },
)

Deno.test(
  'loadMessages: dev mode still de-duplicates genuinely concurrent calls for the same key — ' +
    'only the cache read/write is skipped, not in-flight sharing',
  async () => {
    reset()
    const dir = await withTempDir(async (dir) => {
      await writeJson(join(dir, 'en', 'index.json'), { 'home/title': 'Welcome' })
    })
    try {
      setMessagesDir(dir)
      setDevClientEnabled(true)
      try {
        const [a, b] = await Promise.all([
          loadMessages({ lang: 'en' }),
          loadMessages({ lang: 'en' }),
        ])
        assertEquals(a, { 'home/title': 'Welcome' })
        assertEquals(a, b)
      } finally {
        setDevClientEnabled(false)
      }
    } finally {
      await cleanup(dir)
    }
  },
)

Deno.test(
  'loadMessages: a catalog mixing plain strings and non-string (e.g. precompiled AST) values ' +
    'round-trips untouched — this function never inspects or transforms a value',
  async () => {
    reset()
    const dir = await withTempDir(async (dir) => {
      // `home/compiled` stands in for a precompiled AST value — an array, the shape
      // `@zanix/cli`'s own ICU→AST compiler produces. `loadMessages()` has no idea what this is
      // and must not care: it only ever reads/merges the flat JSON object, never each value's own
      // shape (see this module's own doc for why `Messages` stays `Record<string, string>` as a
      // convenience type, not an enforced runtime contract).
      await writeJson(join(dir, 'en', 'index.json'), {
        'home/title': 'Welcome',
        'home/compiled': [{ type: 0, value: 'Precompiled' }],
      })
    })
    try {
      setMessagesDir(dir)
      const messages = await loadMessages({ lang: 'en' })
      assertEquals(messages, {
        'home/title': 'Welcome',
        // deno-lint-ignore no-explicit-any -- deliberately not a `Messages`-shaped value; see above.
        'home/compiled': [{ type: 0, value: 'Precompiled' }] as any,
      })
    } finally {
      await cleanup(dir)
    }
  },
)

Deno.test(
  'loadMessages: a population override can be non-ICU while the base is precompiled, or vice ' +
    "versa — merge never depends on either side's own value shape",
  async () => {
    reset()
    const dir = await withTempDir(async (dir) => {
      await writeJson(join(dir, 'en', 'index.json'), {
        greet: [{ type: 0, value: 'Compiled base' }],
      })
      await writeJson(join(dir, 'en', 'populations', 'zanix.json'), {
        greet: 'Hello, {name}!',
      })
    })
    try {
      setMessagesDir(dir)
      const messages = await loadMessages({ lang: 'en', population: 'zanix' })
      // The override (still a raw ICU string) wins over the compiled base — ordinary shallow-merge
      // precedence, exactly as if both were plain strings.
      assertEquals(messages, { greet: 'Hello, {name}!' })
    } finally {
      await cleanup(dir)
    }
  },
)

/**
 * Regression coverage for a confirmed raw-native-error leak: `readJsonObject` used to rethrow any
 * non-`NotFound` `Deno.errors.*` completely unwrapped — whose `.message` routinely embeds the
 * real, absolute on-disk path (confirmed via a real repro: `Deno.readTextFile()` on a directory
 * throws `Is a directory (os error 21): readfile '<the real path>'`). `loadMessages()` is called
 * from a page's own `loader`, so an unwrapped native error thrown here is caught by
 * `@zanix/server`'s `routerInterceptor` and turned straight into an HTTP error response via
 * `getPublicErrorResponse`, which allowlists `message` by default — never reaching `error.tsx`'s
 * fallback (that boundary only catches RENDER errors, not a `loader` throw). Fixed by wrapping
 * into `InternalError` — this proves the specific class + `code`, not a generic `Error`/message
 * substring.
 */
Deno.test(
  'loadMessages: a non-NotFound native read failure is wrapped into InternalError, never rethrown raw',
  async () => {
    reset()
    const dir = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      // A directory where the base catalog file is expected — a real, deterministic,
      // cross-platform way to trigger `Deno.errors.IsADirectory` (never `NotFound`).
      await Deno.mkdir(join(dir, 'en', 'index.json'), { recursive: true })
      setMessagesDir(dir)

      const error = await assertRejects(
        () => loadMessages({ lang: 'en' }),
        InternalError,
      )
      assertEquals(error.code, 'SPACE_I18N_MESSAGES_READ_FAILED')
      assertEquals(error.cause instanceof Deno.errors.IsADirectory, true)
    } finally {
      await cleanup(dir)
    }
  },
)

Deno.test(
  'loadMessages: outside dev mode, a cached value is NOT bypassed — production keeps the ' +
    'process-lifetime cache unchanged',
  async () => {
    reset()
    const dir = await withTempDir(async (dir) => {
      await writeJson(join(dir, 'en', 'index.json'), { 'home/title': 'Welcome' })
    })
    try {
      setMessagesDir(dir)
      const first = await loadMessages({ lang: 'en' })
      await writeJson(join(dir, 'en', 'index.json'), { 'home/title': 'Changed' })
      const second = await loadMessages({ lang: 'en' })
      assertEquals(first, second)
      assertEquals(second, { 'home/title': 'Welcome' })
    } finally {
      await cleanup(dir)
    }
  },
)
