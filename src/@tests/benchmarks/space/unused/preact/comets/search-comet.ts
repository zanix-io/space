'use comet'
import { defineComet } from 'modules/comets/define-comet.ts'
import { Search } from '../search.ts'

// Re-exported by name: `defineComet` records `Component.name`, and the client imports that export
// back out of THIS module after loading its chunk.
export { Search }
const Component = Search
export default defineComet(Component, import.meta.url)
