import { assertEquals } from '@std/assert'
import {
  getValidationConfig,
  resetValidationConfig,
  setValidationConfig,
} from 'modules/validation/config-registry.ts'
import type { ValidationConfig } from 'modules/validation/engine.ts'

// ================================================================================================
// This is a module-level singleton shared across the whole test process — every test resets it in
// a `finally` block so a failure here never leaks state into whatever test runs next.
// ================================================================================================

Deno.test('config-registry: unset is undefined — "never configured" is the initial state', () => {
  try {
    assertEquals(getValidationConfig(), undefined)
  } finally {
    resetValidationConfig()
  }
})

Deno.test('config-registry: set then get returns the exact config that was set', () => {
  try {
    const config: ValidationConfig = { strict: true, categories: ['a11y'] }
    setValidationConfig(config)
    assertEquals(getValidationConfig(), config)
  } finally {
    resetValidationConfig()
  }
})

Deno.test(
  "config-registry: set(false) then get returns false — 'explicitly disabled', distinct from " +
    "'never configured' (undefined)",
  () => {
    try {
      setValidationConfig(false)
      assertEquals(getValidationConfig(), false)
    } finally {
      resetValidationConfig()
    }
  },
)

Deno.test(
  'config-registry: false and undefined are distinguishable from one another',
  () => {
    try {
      setValidationConfig(false)
      const disabled = getValidationConfig()
      resetValidationConfig()
      const neverConfigured = getValidationConfig()

      assertEquals(disabled, false)
      assertEquals(neverConfigured, undefined)
      assertEquals(disabled === neverConfigured, false)
    } finally {
      resetValidationConfig()
    }
  },
)

Deno.test('config-registry: reset clears a previously set config back to undefined', () => {
  try {
    setValidationConfig({ strict: true })
    resetValidationConfig()
    assertEquals(getValidationConfig(), undefined)
  } finally {
    resetValidationConfig()
  }
})
