import { assertEquals } from '@std/assert'
import {
  getAssetPath,
  getResolvedAssets,
  resetResolvedAssets,
  setResolvedAssets,
} from 'modules/assets/asset-registry.ts'

Deno.test(
  'getResolvedAssets: undefined until setResolvedAssets is called — distinct from an empty Map',
  () => {
    resetResolvedAssets()
    try {
      assertEquals(getResolvedAssets(), undefined)
    } finally {
      resetResolvedAssets()
    }
  },
)

Deno.test('setResolvedAssets/getAssetPath: resolves a path that exists in the map', () => {
  try {
    setResolvedAssets(new Map([['logo.svg', '/real/path/logo.svg']]))
    assertEquals(getAssetPath('logo.svg'), '/real/path/logo.svg')
  } finally {
    resetResolvedAssets()
  }
})

Deno.test('getAssetPath: undefined for a path not in the map', () => {
  try {
    setResolvedAssets(new Map([['logo.svg', '/real/path/logo.svg']]))
    assertEquals(getAssetPath('missing.png'), undefined)
  } finally {
    resetResolvedAssets()
  }
})

Deno.test('getAssetPath: undefined when no map was ever set (feature never opted into)', () => {
  resetResolvedAssets()
  assertEquals(getAssetPath('logo.svg'), undefined)
})

Deno.test('resetResolvedAssets: clears back to undefined, distinct from an empty Map', () => {
  setResolvedAssets(new Map())
  assertEquals(getResolvedAssets()?.size, 0)
  resetResolvedAssets()
  assertEquals(getResolvedAssets(), undefined)
})
