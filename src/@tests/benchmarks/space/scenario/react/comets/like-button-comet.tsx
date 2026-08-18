'use comet'
import { defineComet } from 'modules/comets/define-comet.ts'
import { LikeButton } from '../like-button.tsx'

// Real bug found and fixed while building this benchmark: `defineComet`'s own documented
// contract requires the wrapped component to be a NAMED export of the comet file itself — client
// hydration reads `data-comet-export` and does `module[exportName]` to get the RAW component back
// (see `define-comet.ts`'s own doc/example). Splitting `LikeButton` into its own file (shared
// with variant A's plain, non-Comet usage) means this file must explicitly RE-EXPORT it under its
// own name — importing it alone is not enough, since an `import` never becomes this MODULE's own
// export. Without this line, hydration silently rendered nothing (no console error at all in a
// production build — React suppresses the underlying warning), confirmed via direct DOM
// inspection in a real browser before this fix.
export { LikeButton }
export default defineComet(LikeButton, import.meta.url)
