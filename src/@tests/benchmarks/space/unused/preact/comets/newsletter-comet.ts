'use comet'
import { defineComet } from 'modules/comets/define-comet.ts'
import { Newsletter } from '../newsletter.ts'

// Re-exported by name: `defineComet` records `Component.name`, and the client imports that export
// back out of THIS module after loading its chunk.
export { Newsletter }
const Component = Newsletter
export default defineComet(Component, import.meta.url)
