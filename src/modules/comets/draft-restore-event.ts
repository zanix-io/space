/**
 * Marks the events a draft restore dispatches, so a listener that reacts to the visitor's edits
 * (see `clear-invalid-on-input.ts`) can tell a value the form wrote itself from one the visitor
 * changed. A restore dispatches real, bubbling `input`/`change` events on purpose: a controlled
 * wrapper around the field only syncs its own state from an event.
 *
 * @module
 */

const restoreEvents = new WeakSet<Event>()

/** Dispatches `type` on `element` as a bubbling event recognized by {@linkcode isDraftRestoreEvent}. */
export function dispatchDraftRestoreEvent(element: Element, type: 'input' | 'change'): void {
  const event = new Event(type, { bubbles: true })
  restoreEvents.add(event)
  element.dispatchEvent(event)
}

/** Whether `event` was dispatched by a draft restore rather than by the visitor. */
export function isDraftRestoreEvent(event: Event): boolean {
  return restoreEvents.has(event)
}
