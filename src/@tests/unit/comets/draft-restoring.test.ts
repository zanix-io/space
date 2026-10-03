import { assertEquals, assertFalse } from '@std/assert'
import { installTimerMock, resetDom } from './dom-test-setup.ts'
import {
  awaitDraftValues,
  DRAFT_RESTORE_TIMEOUT_MS,
  forgetDraftValues,
  reportDraftValueRestored,
  startsRestoring,
  watchDraftRestoring,
} from 'modules/comets/draft-restoring.ts'
import { isDraftProbeMarked } from 'modules/comets/draft-probe.ts'

// deno-lint-ignore no-explicit-any
const globals = globalThis as any

/** A probe `<script>` the page's inline script already marked as restoring. */
function markedProbe(formId: string): void {
  resetDom()
  const probe = globals.document.createElement('script')
  probe.setAttribute('data-draft-probe', formId)
  probe.setAttribute('data-draft-restoring', formId)
  globals.document.body.appendChild(probe)
}

Deno.test('startsRestoring: only a render that follows a failed submit and shows no server values', () => {
  assertEquals(startsRestoring({ hasServerValues: false, returnedFromFailure: true }), true)
  assertFalse(startsRestoring({ hasServerValues: false, returnedFromFailure: false }))
  assertFalse(startsRestoring({ hasServerValues: false }))
  assertFalse(startsRestoring({ hasServerValues: true, returnedFromFailure: true }))
})

Deno.test('awaitDraftValues: settles at once when the form has no controlled value', () => {
  let settled = 0

  const stop = awaitDraftValues('dr-none', [], () => settled++)

  assertEquals(settled, 1)
  stop()
})

Deno.test('awaitDraftValues: settles once every controlled value has reported, in any order', () => {
  let settled = 0
  const stop = awaitDraftValues('dr-order', ['a', 'b'], () => settled++)

  reportDraftValueRestored('dr-order', 'b')
  assertEquals(settled, 0)
  reportDraftValueRestored('dr-order', 'a')

  assertEquals(settled, 1)
  stop()
})

Deno.test('awaitDraftValues: a value that reported before the form attached counts', () => {
  reportDraftValueRestored('dr-early', 'a')
  let settled = 0

  const stop = awaitDraftValues('dr-early', ['a'], () => settled++)

  assertEquals(settled, 1)
  stop()
})

Deno.test('awaitDraftValues: reports of another form never settle this one', () => {
  let settled = 0
  const stop = awaitDraftValues('dr-mine', ['a'], () => settled++)

  reportDraftValueRestored('dr-other', 'a')

  assertEquals(settled, 0)
  stop()
  forgetDraftValues('dr-other')
})

Deno.test('awaitDraftValues: settles by itself after the timeout, so a comet that never hydrates cannot hold the form', () => {
  const timers = installTimerMock()
  let settled = 0
  const stop = awaitDraftValues('dr-timeout', ['never-hydrates'], () => settled++)

  timers.advance(DRAFT_RESTORE_TIMEOUT_MS - 1)
  assertEquals(settled, 0)
  timers.advance(1)

  assertEquals(settled, 1)
  stop()
  timers.restore()
})

Deno.test('awaitDraftValues: settles once, however it is reached', () => {
  const timers = installTimerMock()
  let settled = 0
  const stop = awaitDraftValues('dr-once', ['a'], () => settled++)

  reportDraftValueRestored('dr-once', 'a')
  reportDraftValueRestored('dr-once', 'a')
  timers.advance(DRAFT_RESTORE_TIMEOUT_MS)

  assertEquals(settled, 1)
  stop()
  timers.restore()
})

Deno.test('awaitDraftValues: the cleanup stops waiting, and nothing settles after it', () => {
  const timers = installTimerMock()
  let settled = 0
  const stop = awaitDraftValues('dr-stop', ['a'], () => settled++)

  stop()
  reportDraftValueRestored('dr-stop', 'a')
  timers.advance(DRAFT_RESTORE_TIMEOUT_MS)

  assertEquals(settled, 0)
  forgetDraftValues('dr-stop')
  timers.restore()
})

Deno.test('awaitDraftValues: the cleanup forgets what was reported, so the next visit starts from nothing', () => {
  const timers = installTimerMock()
  reportDraftValueRestored('dr-revisit', 'a')
  awaitDraftValues('dr-revisit', ['a'], () => {})()
  let settled = 0

  const stop = awaitDraftValues('dr-revisit', ['a'], () => settled++)

  assertEquals(settled, 0)
  stop()
  timers.restore()
})

Deno.test('watchDraftRestoring: a render that restores nothing never settles anything, and still forgets on cleanup', () => {
  let settled = 0
  reportDraftValueRestored('dr-watch-none', 'a')

  const stop = watchDraftRestoring('dr-watch-none', { hasServerValues: false }, () => settled++)
  stop()

  assertEquals(settled, 0)
  // Forgotten: a later render that does restore waits for `a` again.
  const again = watchDraftRestoring(
    'dr-watch-none',
    { hasServerValues: false, returnedFromFailure: true, awaitValues: ['a'] },
    () => settled++,
  )
  assertEquals(settled, 0)
  again()
})

Deno.test('watchDraftRestoring: a render that follows a failed submit waits for the values it was given', () => {
  let settled = 0
  const stop = watchDraftRestoring(
    'dr-watch',
    { hasServerValues: false, returnedFromFailure: true, awaitValues: ['a'] },
    () => settled++,
  )

  assertEquals(settled, 0)
  reportDraftValueRestored('dr-watch', 'a')

  assertEquals(settled, 1)
  stop()
})

Deno.test('watchDraftRestoring: without awaitValues the form is done as soon as its own fields are', () => {
  let settled = 0

  const stop = watchDraftRestoring(
    'dr-watch-fields',
    { hasServerValues: false, returnedFromFailure: true },
    () => settled++,
  )

  assertEquals(settled, 1)
  stop()
})

Deno.test('watchDraftRestoring: a mark the page probe set settles at once and is removed when the form has no controlled value', () => {
  markedProbe('pr-none')
  let settled = 0

  const stop = watchDraftRestoring('pr-none', { hasServerValues: false }, () => settled++)

  assertEquals(settled, 1)
  assertFalse(isDraftProbeMarked('pr-none'))
  stop()
})

Deno.test('watchDraftRestoring: a mark the page probe set stays until every controlled value has restored', () => {
  markedProbe('pr-wait')
  let settled = 0

  const stop = watchDraftRestoring(
    'pr-wait',
    { hasServerValues: false, awaitValues: ['picked'] },
    () => settled++,
  )
  assertEquals(settled, 0)
  assertEquals(isDraftProbeMarked('pr-wait'), true)
  reportDraftValueRestored('pr-wait', 'picked')

  assertEquals(settled, 1)
  assertFalse(isDraftProbeMarked('pr-wait'))
  stop()
})

Deno.test('watchDraftRestoring: with no mark and no failure there is nothing to wait for', () => {
  resetDom()
  let settled = 0

  const stop = watchDraftRestoring('pr-clean', { hasServerValues: false }, () => settled++)

  assertEquals(settled, 0)
  stop()
})
