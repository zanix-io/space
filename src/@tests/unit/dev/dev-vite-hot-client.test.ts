import { assert, assertEquals, assertFalse, assertMatch } from '@std/assert'
import {
  buildViteHotClientScript,
  createViteHotClientHandler,
  looksLikeViteHotClientRequest,
  VITE_CLIENT_REQUEST_PATH,
} from 'modules/dev/dev-vite-hot-client.ts'

type FakeModule = {
  // deno-lint-ignore no-explicit-any
  createHotContext: (id: string) => any
  injectQuery: (url: string) => string
  updateStyle: (id: string, css: string) => void
  removeStyle: (id: string) => void
}
// deno-lint-ignore no-explicit-any
type FakeWindow = Record<string, any>
type FakeLocation = { reload: () => void }
type FakeStyleElement = {
  tagName: 'STYLE'
  attributes: Record<string, string>
  textContent: string
  /** `undefined` until explicitly assigned — real browsers start a `createElement`d element's own
   * `nonce` IDL property empty, never inherited from anywhere, exactly what `__spaceGetCspNonce`'s
   * own doc relies on being true. */
  nonce?: string
  setAttribute: (name: string, value: string) => void
  remove: () => void
}
type FakeDocument = {
  head: { children: FakeStyleElement[]; appendChild: (el: FakeStyleElement) => void }
  createElement: (tagName: string) => FakeStyleElement
  /** Only ever asked for `'[nonce]'` by the real script — a real, minimal stand-in for that one
   * selector, not a general CSS selector engine. Searches `head.children` for the first element
   * carrying a truthy `.nonce`, matching `document.querySelector('[nonce]')`'s own real semantics
   * (the first element in document order with the attribute present). */
  querySelector: (selector: '[nonce]') => FakeStyleElement | null
}

/** A minimal fake DOM — just enough surface for `updateStyle`/`removeStyle` (`createElement`,
 * `head.appendChild`, `setAttribute`, `textContent`, `remove()`, `querySelector('[nonce]')`) to run
 * for real, the same "run the real script as a real module" discipline this file's own
 * `withViteHotClientScript` already applies to `window`/`location`. Deno's own global scope has no
 * real `document` either (same reasoning as `window`/`location` above).
 *
 * @param serverRenderedElements - Simulates whatever nonced element(s) a real SSR response already
 * rendered into `<head>`/`<body>` BEFORE any client script ever runs (`BUILTIN_CSS`'s own
 * `<style nonce>`, this app's own bootstrap `<script nonce>`, ...) — `__spaceGetCspNonce`'s own
 * doc explains why only a PARSER-inserted element's `.nonce` is ever real, never one this test
 * itself calls `createElement` for. Defaults to none, for the tests that don't care about CSP at
 * all.
 */
function createFakeDocument(serverRenderedElements: FakeStyleElement[] = []): FakeDocument {
  const headChildren: FakeStyleElement[] = [...serverRenderedElements]
  return {
    head: {
      children: headChildren,
      appendChild: (el) => headChildren.push(el),
    },
    createElement: (tagName) => {
      if (tagName !== 'style') throw new Error(`unexpected tagName: ${tagName}`)
      const el: FakeStyleElement = {
        tagName: 'STYLE',
        attributes: {},
        textContent: '',
        setAttribute: (name, value) => (el.attributes[name] = value),
        remove: () => {
          const index = headChildren.indexOf(el)
          if (index !== -1) headChildren.splice(index, 1)
        },
      }
      return el
    },
    querySelector: (selector) => {
      if (selector !== '[nonce]') throw new Error(`unexpected selector: ${selector}`)
      return headChildren.find((el) => el.nonce) ?? null
    },
  }
}

/** A fake element already carrying a real `nonce`, exactly as a real parser-inserted
 * `<style nonce>`/`<script nonce>` from a real SSR response would — see
 * {@linkcode createFakeDocument}'s own `serverRenderedElements` param doc. */
function fakeServerRenderedNoncedElement(nonce: string): FakeStyleElement {
  return {
    tagName: 'STYLE',
    attributes: {},
    textContent: '',
    nonce,
    setAttribute: () => {},
    remove: () => {},
  }
}

/**
 * Runs the real, unmodified `buildViteHotClientScript()` output as a real ES module (via a real
 * dynamic `import()` of a `data:` url — not `new Function`, since this content genuinely IS an ES
 * module, `export` statements included) against fake `window`/`location` objects, restored
 * afterward. Deno's own global scope has neither a real `window` nor a real `location` (confirmed:
 * `typeof window === 'undefined'`/`typeof location === 'undefined'` under `deno test`) — this script
 * only ever runs in a real browser, where both always exist; the fakes here stand in for that, same
 * reasoning `dev-client-script.test.ts`'s own fake globals already establish for the classic-script
 * counterpart of this same transport.
 *
 * `fn` runs WHILE the fakes are still installed — cleanup must not happen until the caller is done
 * using `mod`/`window`, since `accept()`-registered callbacks and `__spaceApplyClientUpdate` are
 * typically exercised well after the `import()` itself resolves.
 *
 * A trailing comment, unique per call, is appended before encoding — Deno's own module cache keys a
 * `data:` import by its full url, so two calls with byte-identical content would resolve to the SAME
 * cached module and only run its top-level `window.__spaceApplyClientUpdate = ...` assignment the
 * FIRST time, against whichever `fakeWindow` happened to be installed then (confirmed the hard way:
 * without this, every test after the first one failed with `window.__spaceApplyClientUpdate is not a
 * function`, since later tests install a NEW `fakeWindow` object the never-re-run module body never
 * touches).
 */
const globalWithGlobals = globalThis as unknown as {
  window?: FakeWindow
  location?: FakeLocation
  document?: FakeDocument
}

let callCounter = 0
async function withViteHotClientScript<T>(
  fn: (
    mod: FakeModule,
    window: FakeWindow,
    location: FakeLocation,
    document: FakeDocument,
  ) => T | Promise<T>,
  serverRenderedElements: FakeStyleElement[] = [],
): Promise<T> {
  const fakeWindow: FakeWindow = {}
  const fakeLocation: FakeLocation = { reload: () => {} }
  const fakeDocument = createFakeDocument(serverRenderedElements)
  globalWithGlobals.window = fakeWindow
  globalWithGlobals.location = fakeLocation
  globalWithGlobals.document = fakeDocument
  try {
    const source = `${buildViteHotClientScript()}\n// cache-bust:${callCounter++}`
    const dataUrl = `data:text/javascript;base64,${btoa(source)}`
    const mod = await import(dataUrl) as FakeModule
    return await fn(mod, fakeWindow, fakeLocation, fakeDocument)
  } finally {
    delete globalWithGlobals.window
    delete globalWithGlobals.location
    delete globalWithGlobals.document
  }
}

Deno.test('VITE_CLIENT_REQUEST_PATH: matches the real path importAnalysis hardcodes', () => {
  assertEquals(VITE_CLIENT_REQUEST_PATH, '/@vite/client')
})

Deno.test('looksLikeViteHotClientRequest: recognizes only the exact /@vite/client path', () => {
  assert(looksLikeViteHotClientRequest('/@vite/client'))
  assert(!looksLikeViteHotClientRequest('/@vite/client/foo'))
  assert(!looksLikeViteHotClientRequest('/comets/counter.tsx'))
})

Deno.test(
  'buildViteHotClientScript: createHotContext().accept() registers a real callback on window.__spaceHotAccept',
  async () => {
    await withViteHotClientScript((mod, window) => {
      const ctx = mod.createHotContext('/comets/counter.tsx')
      let received: unknown
      ctx.accept((m: unknown) => {
        received = m
      })

      assertEquals(
        typeof window.__spaceHotAccept['/comets/counter.tsx'],
        'function',
      )
      window.__spaceHotAccept['/comets/counter.tsx']({ ok: true })
      assertEquals(received, { ok: true })
    })
  },
)

Deno.test(
  'buildViteHotClientScript: on/off/send/prune/dispose/decline are real, harmless no-ops',
  async () => {
    await withViteHotClientScript((mod) => {
      const ctx = mod.createHotContext('/comets/counter.tsx')
      // None of these may throw — either renderer's own transform is free to call any of them.
      ctx.on()
      ctx.off()
      ctx.send()
      ctx.prune()
      ctx.dispose()
      ctx.decline()
    })
  },
)

Deno.test(
  "buildViteHotClientScript: invalidate() falls back to a real reload, React's own real usage",
  async () => {
    await withViteHotClientScript((mod, _window, location) => {
      let reloaded = false
      location.reload = () => (reloaded = true)

      const ctx = mod.createHotContext('/comets/counter.tsx')
      // Real React transform output calls this when `RefreshRuntime.validateRefreshBoundaryAndEnqueueUpdate`
      // decides a module is no longer a valid refresh boundary — confirmed against a real transform
      // spike, not assumed. Preact's own transform never calls this in practice.
      ctx.invalidate('module no longer exports only components')

      assert(
        reloaded,
        'invalidate() must fall back to a real reload, not silently do nothing',
      )
    })
  },
)

Deno.test('buildViteHotClientScript: injectQuery is a real identity passthrough', async () => {
  await withViteHotClientScript((mod) => {
    assertEquals(mod.injectQuery('/comets/counter.tsx'), '/comets/counter.tsx')
  })
})

Deno.test(
  'buildViteHotClientScript: updateStyle/removeStyle are real, named exports — required because ' +
    "Vite's own CSS transform (`vite@8.2.2`, `dist/node/chunks/node.js`) unconditionally imports " +
    'exactly these two names from `/@vite/client` for EVERY real CSS/CSS-Modules import a ' +
    'client-environment module reaches, first load included. Without both exports, the browser ' +
    'rejects the generated module outright (`SyntaxError: ... does not provide an export named ' +
    "'removeStyle'`), aborting hydration for a Comet importing a real `.module.css` file",
  async () => {
    await withViteHotClientScript((mod) => {
      assertEquals(typeof mod.updateStyle, 'function')
      assertEquals(typeof mod.removeStyle, 'function')
    })
  },
)

Deno.test(
  'updateStyle: creates a single real <style data-vite-dev-id> element in <head>, with the given ' +
    "CSS as its textContent — the same shape Vite's own real client uses to actually apply a CSS " +
    "Modules import's styles in dev-serve mode (there is no <link> tag for this; a real " +
    'production build is the only place one exists)',
  async () => {
    await withViteHotClientScript((mod, _window, _location, document) => {
      mod.updateStyle('/comets/counter.module.css', '.button{color:red}')

      assertEquals(document.head.children.length, 1)
      const [style] = document.head.children
      assertEquals(style.tagName, 'STYLE')
      assertEquals(style.attributes['data-vite-dev-id'], '/comets/counter.module.css')
      assertEquals(style.textContent, '.button{color:red}')
    })
  },
)

Deno.test(
  'updateStyle: a SECOND call for the SAME id updates the existing element in place — never a ' +
    "second <style> tag, matching Vite's own real client behavior for a later CSS edit",
  async () => {
    await withViteHotClientScript((mod, _window, _location, document) => {
      mod.updateStyle('/comets/counter.module.css', '.button{color:red}')
      mod.updateStyle('/comets/counter.module.css', '.button{color:blue}')

      assertEquals(document.head.children.length, 1)
      assertEquals(document.head.children[0].textContent, '.button{color:blue}')
    })
  },
)

Deno.test(
  "updateStyle: assigns the CURRENT page's real CSP nonce to the style element BEFORE it enters " +
    'the document — real gap found and fixed: a nonce-based CSP evaluates a <style> element the ' +
    'instant it is inserted, so assigning .nonce any later (even synchronously right after ' +
    'appendChild) is already too late and the browser blocks it regardless of content, reported ' +
    'against the SHA-256 hash of an EMPTY string (proof CSP saw the element before textContent ' +
    'ever ran, not that the CSS itself was invalid)',
  async () => {
    await withViteHotClientScript(
      (mod, _window, _location, document) => {
        mod.updateStyle('/comets/counter.module.css', '.button{color:red}')

        // Index 1 — index 0 is the seeded server-rendered element itself, already in `head`
        // before `updateStyle` ever runs; the style THIS call creates is appended after it.
        assertEquals(document.head.children[1].nonce, 'xloCDdR/fvXGionAi3e3Wg==')
      },
      [fakeServerRenderedNoncedElement('xloCDdR/fvXGionAi3e3Wg==')],
    )
  },
)

Deno.test(
  'updateStyle: reads the nonce off ANY server-rendered nonced element, not a specific tag — ' +
    'renderer-agnostic, same as this whole file: a real Space response always renders at least ' +
    "one such element before any client script can even start running (BUILTIN_CSS's own " +
    "<style nonce>, this app's own bootstrap <script nonce>, ...) — never a value this script " +
    'invents, hardcodes, or caches across calls',
  async () => {
    const serverRenderedScript: FakeStyleElement = {
      ...fakeServerRenderedNoncedElement('a-real-per-request-nonce'),
      tagName: 'STYLE', // stand-in; the real element would be a <script>, irrelevant to matching
    }
    await withViteHotClientScript(
      (mod, _window, _location, document) => {
        mod.updateStyle('/comets/counter.module.css', '.button{color:red}')

        assertEquals(document.head.children[1].nonce, 'a-real-per-request-nonce')
      },
      [serverRenderedScript],
    )
  },
)

Deno.test(
  'updateStyle: assigns an empty nonce, never throws, when no server-rendered nonced element ' +
    'exists at all — a page with no CSP in effect must still apply real styles',
  async () => {
    await withViteHotClientScript((mod, _window, _location, document) => {
      mod.updateStyle('/comets/counter.module.css', '.button{color:red}')

      assertEquals(document.head.children[0].nonce, '')
    })
  },
)

Deno.test(
  "removeStyle: removes the real element updateStyle created for that id — the callback Vite's " +
    'own generated code registers via `import.meta.hot.prune()` for a CSS Modules file that stops ' +
    'being imported',
  async () => {
    await withViteHotClientScript((mod, _window, _location, document) => {
      mod.updateStyle('/comets/counter.module.css', '.button{color:red}')
      mod.removeStyle('/comets/counter.module.css')

      assertEquals(document.head.children.length, 0)
    })
  },
)

Deno.test(
  'removeStyle: a real no-op for an id updateStyle never created — never throws',
  async () => {
    await withViteHotClientScript((mod, _window, _location, document) => {
      mod.removeStyle('/never/updated.module.css')

      assertEquals(document.head.children.length, 0)
    })
  },
)

Deno.test(
  'window.__spaceApplyClientUpdate: re-imports the changed module cache-busted and invokes its accept callback, real round trip',
  async () => {
    const tempFile = await Deno.makeTempFile({ suffix: '.mjs' })
    try {
      await Deno.writeTextFile(tempFile, `export const marker = 'v1'`)
      const fileUrl = new URL(`file://${tempFile}`).href

      await withViteHotClientScript(async (_mod, window) => {
        let received: Record<string, unknown> | undefined
        window.__spaceHotAccept = {
          [fileUrl]: (m: Record<string, unknown>) => (received = m),
        }

        await window.__spaceApplyClientUpdate(fileUrl)

        assertEquals(received?.marker, 'v1')
      })
    } finally {
      await Deno.remove(tempFile)
    }
  },
)

Deno.test(
  'window.__spaceApplyClientUpdate: falls back to a real reload when nothing was registered for ' +
    'that url — no longer a silent no-op (real gap found: a Comet whose own static import chain ' +
    'failed on its very first load never reaches its own import.meta.hot.accept(...) call, ' +
    'permanently leaving no callback registered; a later edit to that SAME file must still recover ' +
    'via reload, not keep silently doing nothing forever)',
  async () => {
    await withViteHotClientScript(async (_mod, window, location) => {
      let reloaded = false
      location.reload = () => (reloaded = true)
      window.__spaceHotAccept = {}

      // Must not throw — a dev-only best-effort update failing to apply must not break the page.
      await window.__spaceApplyClientUpdate('/never/registered.tsx')

      assert(
        reloaded,
        'a missing accept() callback must fall back to a real reload, not silently do nothing',
      )
    })
  },
)

Deno.test(
  'window.__spaceApplyClientUpdate: the cache-bust token differs even when Date.now() collides, ' +
    'via a monotonic 13-digit timestamp (real gap probed: Date.now() alone repeats within the ' +
    'same millisecond — a real possibility for two file-watcher events from one save — which ' +
    'would cache-bust to the SAME url and silently serve stale content on the second call)',
  async () => {
    const tempFile = await Deno.makeTempFile({ suffix: '.mjs' })
    const originalNow = Date.now
    try {
      await Deno.writeTextFile(tempFile, `export const marker = 'v1'`)
      const fileUrl = new URL(`file://${tempFile}`).href

      // Freezes the ONE axis this fix adds entropy alongside — the real production code tracks a
      // monotonic 13-digit timestamp (`__spaceNextHmrTimestamp()`), never appending extra digits
      // onto `Date.now()` (see this test file's own next test for why that distinction is load-
      // bearing, not cosmetic: Vite's own `removeTimestampQuery` only strips an EXACTLY-13-digit
      // token).
      Date.now = () => 1234567890123

      await withViteHotClientScript(async (_mod, window) => {
        const seen: Record<string, unknown>[] = []
        window.__spaceHotAccept = {
          [fileUrl]: (m: Record<string, unknown>) => seen.push(m),
        }

        await window.__spaceApplyClientUpdate(fileUrl)
        await Deno.writeTextFile(tempFile, `export const marker = 'v2'`)
        await window.__spaceApplyClientUpdate(fileUrl)

        assertEquals(seen.length, 2)
        assertEquals(seen[0].marker, 'v1')
        // If the cache-bust token were `Date.now()` alone, this second call would resolve from
        // the module cache under the SAME (frozen) url as the first call and still see 'v1'.
        assertEquals(
          seen[1].marker,
          'v2',
          'the second call must not be served from the module cache',
        )
      })
    } finally {
      Date.now = originalNow
      await Deno.remove(tempFile)
    }
  },
)

Deno.test(
  'buildViteHotClientScript: the cache-bust token is EXACTLY a 13-digit monotonic timestamp, real ' +
    "root cause found and fixed after this package's own Etapa 4 pass — Vite's own " +
    '`removeTimestampQuery` (source: `vite@8.2.1`, `dist/node/chunks/node.js`) only strips a ' +
    '"?t=<digits>" query, BEFORE any plugin sees the id, when it matches `/\\bt=\\d{13}&?\\b/` — ' +
    'EXACTLY 13 digits. An earlier version appended a monotonic in-page counter directly onto ' +
    '`Date.now()` (14+ digits) to dodge a same-millisecond collision, which defeated that exact ' +
    "match and silently made @prefresh/vite's (and, by the same real Vite convention, " +
    "@vitejs/plugin-react's) own transform skip Fast-Refresh registration entirely for every " +
    're-imported module — confirmed by fetching the transform from inside a real headless ' +
    'browser in an isolated repro, not assumed',
  () => {
    const source = buildViteHotClientScript()

    // The real, found-and-fixed regression, guarded directly: appending anything onto Date.now()
    // grows the token past 13 digits and defeats Vite's own exact match.
    assertFalse(
      source.includes('Math.random'),
      'the cache-bust token must never include non-digit characters',
    )
    assertFalse(
      source.includes("Date.now() + ''"),
      'the cache-bust token must never append anything onto Date.now() — that grows it past the ' +
        "13 digits Vite's own removeTimestampQuery requires",
    )

    // Positive assertion for the real fix: Math.max(now, last + 1), never exceeding 13 digits in
    // any realistic run, monotonic across same-millisecond calls.
    assertMatch(
      source,
      /__spaceLastHmrTimestamp\s*=\s*Math\.max\(now,\s*__spaceLastHmrTimestamp\s*\+\s*1\)/,
      "expected a monotonic Math.max(Date.now(), last + 1) timestamp, matching Vite's own token shape",
    )
  },
)

Deno.test(
  'window.__spaceApplyClientUpdate: a real import failure falls back to a real reload, Etapa 4 ' +
    'hardening (real gap found: a syntax error in the edited file, or the accept() callback ' +
    'itself throwing, previously left an unhandled promise rejection and applied nothing)',
  async () => {
    await withViteHotClientScript(async (_mod, window, location) => {
      let reloaded = false
      location.reload = () => (reloaded = true)

      const brokenUrl = 'file:///this/file/does/not/exist.mjs'
      window.__spaceHotAccept = { [brokenUrl]: () => {} }

      // Must not throw/reject — a dev-only best-effort update failing to apply must not break the
      // page (same documented contract as the "nothing registered" case above).
      await window.__spaceApplyClientUpdate(brokenUrl)

      assert(
        reloaded,
        'a failed re-import must fall back to a real reload, not silently do nothing',
      )
    })
  },
)

Deno.test(
  'window.__spaceApplyClientUpdate: the accept() callback itself throwing also falls back to a ' +
    'real reload, not an unhandled rejection',
  async () => {
    const tempFile = await Deno.makeTempFile({ suffix: '.mjs' })
    try {
      await Deno.writeTextFile(tempFile, `export const marker = 'v1'`)
      const fileUrl = new URL(`file://${tempFile}`).href

      await withViteHotClientScript(async (_mod, window, location) => {
        let reloaded = false
        location.reload = () => (reloaded = true)
        window.__spaceHotAccept = {
          [fileUrl]: () => {
            throw new Error(
              'accept() callback exploded (e.g. a real RefreshRuntime bug)',
            )
          },
        }

        await window.__spaceApplyClientUpdate(fileUrl)

        assert(
          reloaded,
          'a throwing accept() callback must fall back to a real reload',
        )
      })
    } finally {
      await Deno.remove(tempFile)
    }
  },
)

Deno.test('createViteHotClientHandler: serves the real script at /@vite/client', async () => {
  const handler = createViteHotClientHandler()

  const res = handler(new Request('http://localhost/@vite/client'))
  assert(res)
  assertEquals(
    res.headers.get('content-type'),
    'application/javascript; charset=utf-8',
  )
  const body = await res.text()
  assertEquals(body, buildViteHotClientScript())
})

Deno.test('createViteHotClientHandler: returns null for anything else, falls through', () => {
  const handler = createViteHotClientHandler()

  assertEquals(
    handler(new Request('http://localhost/comets/counter.tsx')),
    null,
  )
  assertEquals(handler(new Request('http://localhost/@react-refresh')), null)
})
