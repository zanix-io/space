'use comet'
import { defineComet } from 'modules/comets/define-comet.ts'
import { Filters } from '../filters.ts'

// Re-exported by name: `defineComet` records `Component.name`, and the client imports that export
// back out of THIS module after loading its chunk.
export { Filters }
const Component = Filters
export default defineComet(Component, import.meta.url)
