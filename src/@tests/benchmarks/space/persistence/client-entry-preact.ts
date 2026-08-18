/// <reference lib="dom" />
import { hydrateComets, initOrbit } from 'modules/client/mod-preact.ts'

// Preact counterpart — the ONLY difference from `client-entry-react.ts` is the barrel, which is
// exactly the pairing `clientBarrelGuardPlugin` now enforces at build time.
hydrateComets()
initOrbit({ prefetch: false })
