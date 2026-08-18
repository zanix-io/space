/// <reference lib="dom" />
import { hydrateComets } from 'modules/client/mod.ts'

// Real, unmodified Space client bootstrap — variants B/C's own hydration entry, the same call any
// real Space app's own `main.client.ts` makes. `hydrateComets()` is synchronous and fires every
// comet's own dynamic `import()` concurrently with no external completion signal (confirmed by its
// own signature — returns `void`, not a `Promise`) — this file deliberately does NOT fabricate a
// "hydration done" event on top of it. `run.ts`'s own measurement instead waits for a REAL,
// observable sign of interactivity (a Like button's click handler actually running), which is true
// regardless of how hydration itself signals completion internally.
hydrateComets()
