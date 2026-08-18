'use comet'
import { defineComet } from 'modules/comets/define-comet.ts'
import { Cart } from '../cart.tsx'

// See `like-button-comet.tsx`'s own doc — the same required re-export, for the same reason.
export { Cart }
export default defineComet(Cart, import.meta.url)
