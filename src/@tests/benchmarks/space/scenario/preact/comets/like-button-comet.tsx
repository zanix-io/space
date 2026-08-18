'use comet'
import { defineComet } from 'modules/comets/define-comet.ts'
import { LikeButton } from '../like-button.ts'

// No cast on `LikeButton` — `defineComet`'s own signature is renderer-neutral (`CometComponent`,
// `typings/comet.ts`), so a real Preact component type-checks here directly. It did not always:
// the signature named React's own `ComponentType`, and this file carried an
// `as unknown as ComponentType<...>` cast for exactly that reason — a type-level-only gap this
// benchmark is what surfaced. See `define-comet-renderer-types.test.ts` for the regression suite
// that now pins it shut.
// Also required: re-exporting `LikeButton` under its own name from THIS file — client hydration
// reads `data-comet-export` and does `module[exportName]`, expecting the raw component as a NAMED
// export of the comet file itself (see `react/comets/like-button-comet.tsx`'s own doc for the full
// story of how this was found — hydration silently rendered nothing without it).
export { LikeButton }
export default defineComet(LikeButton, import.meta.url)
