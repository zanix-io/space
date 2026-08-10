// Regression fixture for `bare-specifier-resolve.ts`'s own doc — a plain ESM "npm package" with a
// mutable, shared object. `touch()` is how every other fixture package in this directory proves it
// received the SAME `state` object (not a duplicate module instance): identity, not just value
// equality, is what `canonicalBareSpecifierResolvePlugin` exists to guarantee.
export const state = { count: 0, touchedBy: [] }

export function touch(who) {
  state.touchedBy.push(who)
  state.count++
}
