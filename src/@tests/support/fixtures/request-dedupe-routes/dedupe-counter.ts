// deno-coverage-ignore-file

// Shared by every segment's own loader in this fixture (root layout, nested layout, page) — each
// calls `ctx.dedupe('shared-user', fetchSharedUser)` independently, with no way to see the others'
// own call. `callCount` is what proves whether `ctx.dedupe` actually deduped them: it increments
// only when the fetcher itself runs, never on a cache hit.

export let callCount = 0

export function resetCallCount(): void {
  callCount = 0
}

export function fetchSharedUser(): Promise<{ name: string }> {
  callCount++
  return Promise.resolve({ name: 'ana' })
}
