'use comet'
import type { ComponentType } from 'react'
import { defineComet } from 'modules/comets/define-comet.ts'
import { Reviews } from '../reviews.tsx'

// Re-exported by name: `defineComet` records `Component.name`, and the client imports that export
// back out of THIS module after loading its chunk.
export { Reviews }
const Component = Reviews
export default defineComet(Component as ComponentType<Record<string, never>>, import.meta.url)
