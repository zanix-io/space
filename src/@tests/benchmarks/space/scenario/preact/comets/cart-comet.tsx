'use comet'
import { defineComet } from 'modules/comets/define-comet.ts'
import { Cart } from '../cart.ts'

// See `like-button-comet.tsx`'s own doc for why no cast is needed here (`defineComet` is
// renderer-neutral) AND why the re-export below is required (client hydration reads it back by
// name).
export { Cart }
export default defineComet(Cart, import.meta.url)
