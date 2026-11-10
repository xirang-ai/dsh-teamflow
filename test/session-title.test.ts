/**
 * Linked-conversation label tests.
 *
 * Every requirement link, create row and deleted-session notice reads its label
 * through this helper, so these cases pin the three outcomes: durable title,
 * Host display fallback, and the id only when no title is known.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { SessionListLike } from '../src/client/context.ts'
import { sessionDisplayTitle } from '../src/client/session-title.ts'

describe('linked conversation titles', () => {
  it('prefers the Host display title over the session id', () => {
    const list: SessionListLike = {
      byId: { 'session-1': { displayTitle: '登录页重构' } },
    }
    assert.equal(sessionDisplayTitle(list, 'session-1'), '登录页重构')
  })

  it('falls back to the id when the list has no row', () => {
    const list: SessionListLike = { byId: {} }
    assert.equal(sessionDisplayTitle(list, 'session-1'), 'session-1')
  })

  it('falls back to the id before the Host list is available', () => {
    assert.equal(sessionDisplayTitle(undefined, 'session-1'), 'session-1')
  })

  it('does not show a blank title', () => {
    const list: SessionListLike = {
      byId: { 'session-1': { displayTitle: '  ' } },
    }
    assert.equal(sessionDisplayTitle(list, 'session-1'), 'session-1')
  })
})
