// deno-coverage-ignore-file

// Own copy of `request-dedupe-routes/dedupe-counter.ts`'s exact shape — kept separate rather than
// imported across fixture directories so this Preact fixture's own call count can never be
// confused with (or accidentally shared state with) the React fixture's own, even though both
// exercise the identical `ctx.dedupe` mechanism.

export let callCount = 0

export function resetCallCount(): void {
  callCount = 0
}

export function fetchSharedUser(): Promise<{ name: string }> {
  callCount++
  return Promise.resolve({ name: 'ana' })
}
