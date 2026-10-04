import { assertEquals } from '@std/assert'
import {
  dedupeStylesheetRefs,
  resolveLayoutCssHrefs,
  resolveRootLayoutCssHrefs,
  resolveScopedCssHrefs,
  setCssManifest,
} from 'modules/render/css-manifest.ts'
import { setDevClientEnabled } from 'modules/dev/dev-client-registry.ts'
import { setRootLayoutStyles } from 'modules/router/app-shell-registry.ts'

function reset() {
  setCssManifest(undefined)
  setDevClientEnabled(false)
  setRootLayoutStyles(undefined)
}

Deno.test('dedupeStylesheetRefs: the first occurrence of an href wins, order is kept', () => {
  assertEquals(
    dedupeStylesheetRefs([
      '/a.css',
      '/b.css',
      { href: '/a.css', media: 'print' },
      '/c.css',
      '/b.css',
    ]),
    ['/a.css', '/b.css', '/c.css'],
  )
  assertEquals(dedupeStylesheetRefs([]), [])
})

Deno.test(
  'resolveLayoutCssHrefs (production): layouts link root layout first, from the manifest, ' +
    'without repeats, skipping a segment with no layout',
  () => {
    setCssManifest({
      global: [],
      layouts: {
        '/r/layout.tsx': ['/assets/root.css'],
        '/r/area/layout.tsx': ['/assets/area.css', '/assets/root.css'],
      },
    })
    try {
      assertEquals(
        resolveLayoutCssHrefs([
          { layoutFilePath: '/r/layout.tsx' },
          {},
          { layoutFilePath: '/r/area/layout.tsx' },
          { layoutFilePath: '/r/unknown/layout.tsx' },
        ]),
        ['/assets/root.css', '/assets/area.css'],
      )
      assertEquals(resolveLayoutCssHrefs([]), [])
    } finally {
      reset()
    }
  },
)

Deno.test('resolveLayoutCssHrefs (production): no manifest means no layout styles', () => {
  assertEquals(resolveLayoutCssHrefs([{ layoutFilePath: '/r/layout.tsx' }]), [])
})

Deno.test(
  'resolveLayoutCssHrefs (dev): the live styles resolve relative to each layout file, as ?direct ' +
    'hrefs; the manifest is ignored',
  () => {
    setDevClientEnabled(true)
    setCssManifest({ global: [], layouts: { 'src/routes/layout.tsx': ['/assets/stale.css'] } })
    try {
      assertEquals(
        resolveLayoutCssHrefs([
          { layoutFilePath: 'src/routes/layout.tsx', styles: ['./root.css'] },
          {
            layoutFilePath: 'src/routes/area/layout.tsx',
            styles: [{ href: './area.css', media: 'print' }],
          },
          { layoutFilePath: 'src/routes/plain/layout.tsx' },
        ]),
        [
          '/src/routes/root.css?direct',
          { href: '/src/routes/area/area.css?direct', media: 'print' },
        ],
      )
    } finally {
      reset()
    }
  },
)

Deno.test(
  'resolveScopedCssHrefs: layouts root to leaf, then the page, without repeats; a page never ' +
    'routed through loadRoutes has none',
  () => {
    setCssManifest({
      global: ['/assets/global.css'],
      layouts: { '/r/layout.tsx': ['/assets/root.css'], '/r/a/layout.tsx': ['/assets/a.css'] },
      pages: { '/r/a/page.tsx': ['/assets/page.css', '/assets/a.css'] },
    })
    try {
      const tree = {
        filePath: '/r/a/page.tsx',
        segments: [{ layoutFilePath: '/r/layout.tsx' }, { layoutFilePath: '/r/a/layout.tsx' }],
      }
      assertEquals(
        resolveScopedCssHrefs(tree, undefined),
        ['/assets/root.css', '/assets/a.css', '/assets/page.css'],
      )
      assertEquals(resolveScopedCssHrefs(undefined, ['./x.css']), [])
    } finally {
      reset()
    }
  },
)

Deno.test('resolveRootLayoutCssHrefs: the root layout alone, for documents outside a page', () => {
  assertEquals(resolveRootLayoutCssHrefs(), [])
  setCssManifest({ global: [], layouts: { '/r/layout.tsx': ['/assets/root.css'] } })
  setRootLayoutStyles({ layoutFilePath: '/r/layout.tsx' })
  try {
    assertEquals(resolveRootLayoutCssHrefs(), ['/assets/root.css'])
  } finally {
    reset()
  }
})
