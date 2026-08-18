/// <reference lib="dom" />
import { hydrateComets, initOrbit } from 'modules/client/mod.ts'

// Real, unmodified Space client bootstrap for a React app — the same two calls a real
// `main.client.ts` makes. `initOrbit` is what turns same-origin link clicks into fragment
// navigations, which is the navigation this spike measures state across.
hydrateComets()
initOrbit({ prefetch: false })
