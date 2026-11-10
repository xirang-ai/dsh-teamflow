/**
 * Hand-off store tests.
 *
 * The panel's inject face is resolved once per entry and cached by the Host, so
 * neither the record the conversation tab asks for nor the sidebar entry's
 * request for the clean list can travel as a plain value: both go through a
 * live source. These cases pin the properties that make it work: the snapshot
 * is the same object until something changes, every change notifies the
 * subscribers the Host bound, a repeated request is still a new request, the
 * two routes are distinguishable, and consuming clears the request once.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { createRequestedViewStore, useEmptyRequestedView } from '../src/client/requested-view.ts'

describe('requested view store', () => {
  it('starts empty and keeps one snapshot identity until something changes', () => {
    const store = createRequestedViewStore()
    assert.equal(store.getSnapshot(), null)

    store.request({ kind: 'requirement', id: 'req_1' })
    const first = store.getSnapshot()
    assert.equal(first?.kind, 'record')
    assert.deepEqual(first?.kind === 'record' ? first.target : null, { kind: 'requirement', id: 'req_1' })
    // The Host compares snapshots by identity; re-reading must not re-render.
    assert.equal(store.getSnapshot(), first)
  })

  it('notifies subscribers on request and consumes, and stops after unsubscribe', () => {
    const store = createRequestedViewStore()
    const seen: Array<unknown> = []
    const unsubscribe = store.subscribe(() => seen.push(store.getSnapshot()))

    store.request({ kind: 'story', id: 'sty_1', requirementId: 'req_1' })
    store.consume()
    assert.deepEqual(seen, [
      {
        kind: 'record',
        target: { kind: 'story', id: 'sty_1', requirementId: 'req_1' },
        seq: 1,
      },
      null,
    ])

    // Consuming an already empty store is not a change and must not notify.
    store.consume()
    assert.equal(seen.length, 2)

    unsubscribe()
    store.request({ kind: 'bug', id: 'bug_1' })
    assert.equal(seen.length, 2)
  })

  it('treats a repeated request on the same record as a new request', () => {
    const store = createRequestedViewStore()
    store.request({ kind: 'bug', id: 'bug_1' })
    const first = store.getSnapshot()
    store.request({ kind: 'bug', id: 'bug_1' })
    const second = store.getSnapshot()

    // Same record, different snapshot: the panel's effect has to run again.
    assert.equal(second?.seq, (first?.seq ?? 0) + 1)
    assert.notEqual(second, first)
  })

  it('copies the target so a caller cannot rewrite a published snapshot', () => {
    const store = createRequestedViewStore()
    const target = { kind: 'bug' as const, id: 'bug_1' }
    store.request(target)
    target.id = 'bug_2'
    const snapshot = store.getSnapshot()
    assert.deepEqual(snapshot?.kind === 'record' ? snapshot.target : null, { kind: 'bug', id: 'bug_1' })
  })

  it('distinguishes the list request from a record request', () => {
    const store = createRequestedViewStore()
    store.requestHome()
    const home = store.getSnapshot()
    assert.deepEqual(home, { kind: 'home', seq: 1 })

    // The two routes share one hand-off, so the later one wins and is still a
    // new snapshot: the panel's effect must run for it.
    store.request({ kind: 'requirement', id: 'req_1' })
    assert.deepEqual(store.getSnapshot(), {
      kind: 'record',
      target: { kind: 'requirement', id: 'req_1' },
      seq: 2,
    })
    store.requestHome()
    assert.deepEqual(store.getSnapshot(), { kind: 'home', seq: 3 })
  })

  it('publishes every list request, so a re-selected entry retriggers the reset', () => {
    const store = createRequestedViewStore()
    store.requestHome()
    const first = store.getSnapshot()
    store.requestHome()
    const second = store.getSnapshot()
    assert.notEqual(second, first)
    assert.equal(second?.seq, (first?.seq ?? 0) + 1)
  })

  it('renders an empty stand-in when the Host hands no source', () => {
    let calls = 0
    const selected = useEmptyRequestedView((state) => {
      calls += 1
      return state
    })
    assert.equal(selected, null)
    assert.equal(calls, 1, 'the selector still runs, so hook calls stay unconditional')
  })
})
