'use comet'
import { defineComet } from 'modules/comets/define-comet.ts'
import { Newsletter } from '../newsletter.ts'

// See `like-button-comet.tsx`'s own doc for why no cast is needed here (`defineComet` is
// renderer-neutral) AND why the re-export below is required (client hydration reads it back by
// name).
export { Newsletter }
export default defineComet(Newsletter, import.meta.url)
