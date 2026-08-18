/// <reference lib="dom" />
import { hydrateComets } from 'modules/client/mod.ts'

// Real Space bootstrap. `hydrateComets` only ever dynamically imports the chunk of a comet that
// actually has a boundary in THIS page's HTML — which is the entire mechanism under test.
hydrateComets()
