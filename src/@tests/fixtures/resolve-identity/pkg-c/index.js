'use strict'
// CJS -> ESM bare require of a real ESM "npm package" (no `package.json` "type": "module" here —
// this file is CommonJS) — `bare-specifier-resolve.ts`'s own doc, item 5. `pkg-a` has no `default`
// export at all, which is exactly what `cjs-interop.ts`'s own `.default`-narrowing bug used to
// silently return `undefined` for.
var pkgA = require('@test-fixtures/pkg-a')
pkgA.touch('pkg-c')
exports.state = pkgA.state
