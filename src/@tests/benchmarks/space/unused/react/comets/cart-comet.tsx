'use comet'
import type { ComponentType } from 'react'
import { defineComet } from 'modules/comets/define-comet.ts'
import { Cart } from '../cart.tsx'

// Re-exported by name: `defineComet` records `Component.name`, and the client imports that export
// back out of THIS module after loading its chunk.
export { Cart }
const Component = Cart
export default defineComet(Component as ComponentType<Record<string, never>>, import.meta.url)
