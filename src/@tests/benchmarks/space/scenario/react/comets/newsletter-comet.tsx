'use comet'
import { defineComet } from 'modules/comets/define-comet.ts'
import { Newsletter } from '../newsletter.tsx'

// See `like-button-comet.tsx`'s own doc — the same required re-export, for the same reason.
export { Newsletter }
export default defineComet(Newsletter, import.meta.url)
