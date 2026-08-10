import { assertEquals } from '@std/assert'
import {
  getGlobalCssPaths,
  resolveCssHrefs,
  setCssManifest,
  setGlobalCssPaths,
} from 'modules/render/css-manifest.ts'
import { setDevClientEnabled } from 'modules/dev/dev-client-registry.ts'

function reset() {
  setCssManifest(undefined)
  setGlobalCssPaths(undefined)
  setDevClientEnabled(false)
}

Deno.test(
  'resolveCssHrefs: outside dev, returns the production manifest unchanged',
  () => {
    try {
      setCssManifest(['/assets/app-abc123.css'])
      assertEquals(resolveCssHrefs(), ['/assets/app-abc123.css'])
    } finally {
      reset()
    }
  },
)

Deno.test(
  'resolveCssHrefs: in dev, resolves globalCss paths instead of the production manifest',
  () => {
    try {
      setCssManifest(['/assets/app-abc123.css']) // present but must be ignored in dev
      setGlobalCssPaths(['./styles/app.css'])
      setDevClientEnabled(true)
      assertEquals(resolveCssHrefs(), ['/styles/app.css?direct'])
    } finally {
      reset()
    }
  },
)

Deno.test(
  'resolveCssHrefs: in dev, no globalCss declared resolves to an empty list, not undefined',
  () => {
    try {
      setDevClientEnabled(true)
      assertEquals(resolveCssHrefs(), [])
    } finally {
      reset()
    }
  },
)

Deno.test(
  'resolveCssHrefs: outside dev, no manifest loaded resolves to undefined',
  () => {
    try {
      assertEquals(resolveCssHrefs(), undefined)
    } finally {
      reset()
    }
  },
)

Deno.test('getGlobalCssPaths: reflects whatever setGlobalCssPaths last set', () => {
  try {
    assertEquals(getGlobalCssPaths(), undefined)
    setGlobalCssPaths(['./a.css'])
    assertEquals(getGlobalCssPaths(), ['./a.css'])
  } finally {
    reset()
  }
})
