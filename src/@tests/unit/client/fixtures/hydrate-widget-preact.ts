import { createElement } from 'preact'

/**
 * A real, dynamically-importable Preact component — what `hydrate-comets-preact.test.ts`'s own
 * "real import succeeds" cases resolve `hydrateBoundary`'s `import(moduleUrl)` against, standing
 * in for a real app's own Comet module. The default export a boundary resolves when no explicit
 * `data-comet-export` attribute is set.
 */
export default function Widget({ label }: { label?: string }) {
  return createElement('span', { class: 'widget' }, `widget:${label ?? ''}`)
}

/** A second, named export — exercises `hydrateBoundary`'s own `data-comet-export` resolution. */
export function Named({ label }: { label?: string }) {
  return createElement('span', { class: 'named' }, `named:${label ?? ''}`)
}
