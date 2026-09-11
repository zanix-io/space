import { assertEquals, assertRejects } from '@std/assert'
import { dirname, join } from '@std/path'
import logger from '@zanix/logger'
import { getTemporaryFolder } from '@zanix/helpers'
import { InternalError } from '@zanix/errors'
import { setDevClientEnabled } from 'modules/dev/dev-client-registry.ts'
import { loadMessages, resetMessagesCache } from 'modules/i18n/load-messages.ts'
import {
  resetMessagesBuildDir,
  resetMessagesDir,
  setMessagesBuildDir,
  setMessagesDir,
} from 'modules/i18n/messages-registry.ts'

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
  resetMessagesBuildDir()
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

Deno.test(
  'loadMessages: multiple base segment files under {lang}/ merge into one base catalog',
  async () => {
    reset()
    const dir = await withTempDir(async (dir) => {
      await writeJson(join(dir, 'en', 'index.json'), { 'home/title': 'Welcome' })
      await writeJson(join(dir, 'en', 'iam.json'), { 'login/submit': 'Sign in' })
      await writeJson(join(dir, 'en', 'profile.json'), { 'profile/name': 'Name' })
    })
    try {
      setMessagesDir(dir)
      const messages = await loadMessages({ lang: 'en' })
      assertEquals(messages, {
        'home/title': 'Welcome',
        'login/submit': 'Sign in',
        'profile/name': 'Name',
      })
    } finally {
      await cleanup(dir)
    }
  },
)

Deno.test(
  'loadMessages: segment discovery never recurses into populations/ — its files never become ' +
    'base-catalog segments',
  async () => {
    reset()
    const dir = await withTempDir(async (dir) => {
      await writeJson(join(dir, 'en', 'iam.json'), { 'login/submit': 'Sign in' })
      await writeJson(join(dir, 'en', 'populations', 'zanix.json'), { 'login/submit': 'Enter' })
    })
    try {
      setMessagesDir(dir)
      const messages = await loadMessages({ lang: 'en' })
      assertEquals(messages, { 'login/submit': 'Sign in' })
    } finally {
      await cleanup(dir)
    }
  },
)

Deno.test(
  'loadMessages: a population override still overlays on top of a multi-segment base, override ' +
    'keys win regardless of which segment file they shadow',
  async () => {
    reset()
    const dir = await withTempDir(async (dir) => {
      await writeJson(join(dir, 'en', 'index.json'), { 'home/title': 'Welcome' })
      await writeJson(join(dir, 'en', 'profile.json'), { 'profile/name': 'Name' })
      await writeJson(join(dir, 'en', 'populations', 'zanix.json'), {
        'profile/name': 'Zanix name',
      })
    })
    try {
      setMessagesDir(dir)
      const messages = await loadMessages({ lang: 'en', population: 'zanix' })
      assertEquals(messages, { 'home/title': 'Welcome', 'profile/name': 'Zanix name' })
    } finally {
      await cleanup(dir)
    }
  },
)

Deno.test(
  'loadMessages: a segment present only in a later messagesDir[] root is still discovered and ' +
    'merged — segmentation composes with host composition',
  async () => {
    reset()
    const hostDir = await Deno.makeTempDir({ dir: TMP_ROOT })
    const baseDir = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      await writeJson(join(hostDir, 'en', 'index.json'), { 'home/title': 'Welcome' })
      await writeJson(join(baseDir, 'en', 'iam.json'), { 'login/submit': 'Sign in' })
      setMessagesDir([hostDir, baseDir])
      const messages = await loadMessages({ lang: 'en' })
      assertEquals(messages, { 'home/title': 'Welcome', 'login/submit': 'Sign in' })
    } finally {
      await cleanup(hostDir, baseDir)
    }
  },
)

Deno.test(
  'loadMessages: a malformed segment file degrades to every OTHER valid segment plus the override ' +
    '— it never discards unrelated valid content',
  async () => {
    reset()
    const dir = await withTempDir(async (dir) => {
      await writeJson(join(dir, 'en', 'index.json'), { 'home/title': 'Welcome' })
      await Deno.writeTextFile(join(dir, 'en', 'iam.json'), '{ not valid json')
    })
    try {
      setMessagesDir(dir)
      const error = countCalls('error')
      const warn = countCalls('warn')
      try {
        const messages = await loadMessages({ lang: 'en' })
        assertEquals(messages, { 'home/title': 'Welcome' })
        assertEquals(error.count(), 1)
        assertEquals(warn.count(), 0)
      } finally {
        error.restore()
        warn.restore()
      }
    } finally {
      await cleanup(dir)
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
  'loadMessages: a catalog mixing plain strings and CompiledMessageNode[] values round-trips ' +
    'untouched — this function never inspects or transforms a value',
  async () => {
    reset()
    const dir = await withTempDir(async (dir) => {
      // `home/compiled` stands in for a precompiled AST value — the exact shape `@zanix/cli`'s own
      // ICU→AST compiler produces, and a real, first-class `Messages` value (`Record<string, string
      // | CompiledMessageNode[]>` — see this module's own doc for why both shapes are legitimate,
      // not just tolerated). `loadMessages()` still never inspects or transforms either shape: it
      // only ever reads/merges the flat JSON object, never a value's own internal structure.
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
        'home/compiled': [{ type: 0, value: 'Precompiled' }],
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
 *
 * Two distinct sites now do this wrapping, since base-segment discovery (`listSegmentFiles`,
 * `Deno.readDir`) runs BEFORE any individual file read (`readJsonObject`, `Deno.readTextFile`) —
 * both are covered below rather than assuming the older single-file repro still exercises the
 * (now earlier) discovery step.
 */
Deno.test(
  'loadMessages: a non-NotFound failure LISTING the {lang}/ directory is wrapped into ' +
    'InternalError, never rethrown raw',
  async () => {
    reset()
    const dir = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      // `{lang}` itself is a plain file, not a directory — `Deno.readDir` on it throws
      // `Deno.errors.NotADirectory` (never `NotFound`), a real, deterministic, cross-platform way
      // to fail segment DISCOVERY itself, before any individual catalog file is even read.
      await Deno.writeTextFile(join(dir, 'en'), 'not a directory')
      setMessagesDir(dir)

      const error = await assertRejects(
        () => loadMessages({ lang: 'en' }),
        InternalError,
      )
      assertEquals(error.code, 'SPACE_I18N_MESSAGES_READ_FAILED')
      assertEquals(error.cause instanceof Deno.errors.NotADirectory, true)
    } finally {
      await cleanup(dir)
    }
  },
)

Deno.test(
  'loadMessages: a non-NotFound failure READING a discovered segment file is wrapped into ' +
    'InternalError, never rethrown raw',
  async () => {
    reset()
    const dir = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      // A real file discovered by segment listing, made unreadable — a real, deterministic way to
      // fail the per-file read (`readJsonObject`) rather than discovery itself.
      const segmentPath = join(dir, 'en', 'index.json')
      await writeJson(segmentPath, { 'home/title': 'Welcome' })
      await Deno.chmod(segmentPath, 0o000)
      setMessagesDir(dir)

      try {
        const error = await assertRejects(
          () => loadMessages({ lang: 'en' }),
          InternalError,
        )
        assertEquals(error.code, 'SPACE_I18N_MESSAGES_READ_FAILED')
        assertEquals(error.cause instanceof Deno.errors.PermissionDenied, true)
      } finally {
        await Deno.chmod(segmentPath, 0o644)
      }
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

Deno.test(
  'loadMessages: outside dev mode, with a build dir configured, reads compiled output from ' +
    '{buildDir}/messages/{rootIndex}/... — NEVER the live messagesDir source, mirroring ' +
    "clientBuildDir's own contract",
  async () => {
    reset()
    const messagesDir = await withTempDir(async (dir) => {
      // Live source — must be ignored entirely once a build dir is configured, in production.
      await writeJson(join(dir, 'en', 'index.json'), { 'home/title': 'Live source (unused)' })
    })
    const buildDir = await withTempDir(async (dir) => {
      await writeJson(join(dir, 'messages', '0', 'en', 'index.json'), {
        'home/title': 'Compiled output',
      })
    })
    try {
      setMessagesDir(messagesDir)
      setMessagesBuildDir(buildDir)
      const messages = await loadMessages({ lang: 'en' })
      assertEquals(messages, { 'home/title': 'Compiled output' })
    } finally {
      await cleanup(messagesDir, buildDir)
    }
  },
)

Deno.test(
  'loadMessages: outside dev mode, with a build dir configured, MULTIPLE compiled segment files ' +
    'under {buildDir}/messages/{rootIndex}/{lang}/ merge correctly — segmentation composes with ' +
    "the production build-dir path exactly like it does with messagesDir's own live-source path",
  async () => {
    reset()
    const messagesDir = await withTempDir(async (dir) => {
      // Live source — must be ignored entirely once a build dir is configured, in production.
      await writeJson(join(dir, 'en', 'index.json'), { 'home/title': 'Live source (unused)' })
    })
    const buildDir = await withTempDir(async (dir) => {
      // Mirrors what `zanix space build`'s own compiler (`@zanix/cli`'s `writeCompiledCatalogs`)
      // actually produces for a segmented `messagesDir`: one compiled file per source segment,
      // same relative path, each value now precompiled AST rather than a raw ICU string.
      await writeJson(join(dir, 'messages', '0', 'en', 'index.json'), {
        'home/title': [{ type: 0, value: 'Compiled home title' }],
      })
      await writeJson(join(dir, 'messages', '0', 'en', 'iam.json'), {
        'login/submit': [{ type: 0, value: 'Compiled sign in' }],
      })
      await writeJson(join(dir, 'messages', '0', 'en', 'profile.json'), {
        'profile/name': [{ type: 0, value: 'Compiled name' }],
      })
      // A population override, also compiled — must still overlay on top of the merged segments.
      await writeJson(join(dir, 'messages', '0', 'en', 'populations', 'zanix.json'), {
        'profile/name': [{ type: 0, value: 'Compiled Zanix name' }],
      })
    })
    try {
      setMessagesDir(messagesDir)
      setMessagesBuildDir(buildDir)
      const messages = await loadMessages({ lang: 'en', population: 'zanix' })
      assertEquals(messages, {
        'home/title': [{ type: 0, value: 'Compiled home title' }],
        'login/submit': [{ type: 0, value: 'Compiled sign in' }],
        // The population override wins over the segment it shadows — same precedence the live-
        // source path already guarantees, now proven against compiled AST values too.
        'profile/name': [{ type: 0, value: 'Compiled Zanix name' }],
      })
    } finally {
      await cleanup(messagesDir, buildDir)
    }
  },
)

Deno.test(
  'loadMessages: under dev mode, a configured build dir is IGNORED — messagesDir is always read ' +
    'live, same as when no build dir is configured at all',
  async () => {
    reset()
    const messagesDir = await withTempDir(async (dir) => {
      await writeJson(join(dir, 'en', 'index.json'), { 'home/title': 'Live source' })
    })
    const buildDir = await withTempDir(async (dir) => {
      // A stale build sitting on disk — must never win under dev, same reasoning `clientBuildDir`
      // itself already documents for its own manifests.
      await writeJson(join(dir, 'messages', '0', 'en', 'index.json'), {
        'home/title': 'Stale compiled output',
      })
    })
    try {
      setMessagesDir(messagesDir)
      setMessagesBuildDir(buildDir)
      setDevClientEnabled(true)
      try {
        const messages = await loadMessages({ lang: 'en' })
        assertEquals(messages, { 'home/title': 'Live source' })
      } finally {
        setDevClientEnabled(false)
      }
    } finally {
      await cleanup(messagesDir, buildDir)
    }
  },
)

Deno.test(
  'loadMessages: a multi-root messagesDir[] resolves its compiled counterpart by ARRAY INDEX, ' +
    'preserving first-match-wins precedence exactly as the live-source array does',
  async () => {
    reset()
    const overrideDir = await Deno.makeTempDir({ dir: TMP_ROOT })
    const baseDir = await Deno.makeTempDir({ dir: TMP_ROOT })
    const buildDir = await withTempDir(async (dir) => {
      // Index 0 -> overrideDir, index 1 -> baseDir — same order `setMessagesDir([override, base])`
      // declares below.
      await writeJson(join(dir, 'messages', '0', 'en', 'populations', 'zanix.json'), {
        'home/title': 'Compiled override',
      })
      await writeJson(join(dir, 'messages', '1', 'en', 'index.json'), {
        'home/title': 'Compiled base',
        'home/subtitle': 'Compiled subtitle',
      })
    })
    try {
      setMessagesDir([overrideDir, baseDir])
      setMessagesBuildDir(buildDir)
      const messages = await loadMessages({ lang: 'en', population: 'zanix' })
      assertEquals(messages, {
        'home/title': 'Compiled override',
        'home/subtitle': 'Compiled subtitle',
      })
    } finally {
      await cleanup(overrideDir, baseDir, buildDir)
    }
  },
)
