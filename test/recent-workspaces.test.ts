/**
 * Quick-pick ordering for the Create page workspace field.
 *
 * The page must not pre-select a workspace, so these helpers only decide which
 * five workspaces the quick-pick row offers and in what order: recently picked
 * ones first, then the Host's own order. The tests pin the pure part (parsing,
 * ordering, filtering) plus the `localStorage`-less fallback, which is what a
 * shell without storage sees.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { WorkspaceOption } from '../src/client/context.ts'
import {
  RECENT_LIMIT,
  filterWorkspaces,
  orderQuickPicks,
  parseRecent,
  pruneRecent,
  readRecentWorkspaces,
  rememberWorkspace,
  withRecent,
} from '../src/client/recent-workspaces.ts'

const option = (id: string, title: string = id.toUpperCase()): WorkspaceOption => ({ id, title })

describe('parseRecent', () => {
  it('returns an empty list for absent or malformed storage', () => {
    assert.deepEqual(parseRecent(null), [])
    assert.deepEqual(parseRecent(''), [])
    assert.deepEqual(parseRecent('not json'), [])
    assert.deepEqual(parseRecent('42'), [])
    assert.deepEqual(parseRecent('{"a":1}'), [])
  })

  it('keeps only non-empty strings, deduplicated and capped', () => {
    assert.deepEqual(parseRecent('["a",1,null,"a","b",""]'), ['a', 'b'])
    const many = JSON.stringify(Array.from({ length: RECENT_LIMIT + 4 }, (_value, index) => `ws-${index}`))
    assert.equal(parseRecent(many).length, RECENT_LIMIT)
    assert.equal(parseRecent(many)[0], 'ws-0')
  })
})

describe('withRecent', () => {
  it('puts the id in front, removes its old position and trims the tail', () => {
    assert.deepEqual(withRecent(['a', 'b', 'c'], 'b'), ['b', 'a', 'c'])
    assert.deepEqual(withRecent(['a', 'b'], 'c'), ['c', 'a', 'b'])
    assert.equal(withRecent(Array(RECENT_LIMIT).fill('x'), 'y').length, RECENT_LIMIT)
  })

  it('ignores an empty id', () => {
    assert.deepEqual(withRecent(['a'], ''), ['a'])
  })
})

describe('orderQuickPicks', () => {
  it('lists recently picked workspaces first, then fills from the Host order', () => {
    const workspaces = [option('a'), option('b'), option('c'), option('d'), option('e'), option('f')]
    assert.deepEqual(
      orderQuickPicks(workspaces, ['d', 'b']).map((entry) => entry.id),
      ['d', 'b', 'a', 'c', 'e'],
    )
  })

  it('drops remembered ids the Host no longer lists', () => {
    const workspaces = [option('a'), option('b')]
    assert.deepEqual(orderQuickPicks(workspaces, ['gone', 'b']).map((entry) => entry.id), ['b', 'a'])
  })

  it('falls back to the Host order when nothing was remembered', () => {
    assert.deepEqual(orderQuickPicks([option('a'), option('b')], []).map((entry) => entry.id), ['a', 'b'])
    assert.deepEqual(orderQuickPicks([], ['a']), [])
  })

  it('never exceeds the quick-pick limit', () => {
    const workspaces = Array.from({ length: 8 }, (_value, index) => option(`ws-${index}`))
    assert.equal(orderQuickPicks(workspaces, ['ws-4', 'ws-5']).length, 5)
  })
})

describe('filterWorkspaces', () => {
  it('matches titles case-insensitively and ignores surrounding spaces', () => {
    const workspaces = [option('a', 'Teamflow'), option('b', 'third_base')]
    assert.deepEqual(filterWorkspaces(workspaces, 'flow').map((entry) => entry.id), ['a'])
    assert.deepEqual(filterWorkspaces(workspaces, '  THIRD ').map((entry) => entry.id), ['b'])
    assert.deepEqual(filterWorkspaces(workspaces, 'nothing'), [])
  })

  it('returns the whole list for an empty query', () => {
    const workspaces = [option('a'), option('b')]
    assert.deepEqual(filterWorkspaces(workspaces, '   ').map((entry) => entry.id), ['a', 'b'])
  })
})

describe('pruneRecent', () => {
  it('drops remembered ids the Host no longer lists', () => {
    const workspaces = [option('a'), option('c')]
    assert.deepEqual(pruneRecent(['c', 'gone', 'a'], workspaces), ['c', 'a'])
  })

  it('keeps the same array when every id still exists', () => {
    const workspaces = [option('a'), option('b')]
    const recent = ['b', 'a']
    assert.equal(pruneRecent(recent, workspaces), recent)
  })

  it('empties the list when nothing is left', () => {
    assert.deepEqual(pruneRecent(['gone'], []), [])
  })
})

describe('storage fallback', () => {
  it('reads an empty list when localStorage is unavailable (Node shells)', () => {
    assert.equal(typeof localStorage, 'undefined')
    assert.deepEqual(readRecentWorkspaces(), [])
  })

  it('still returns the merged list when the write is skipped', () => {
    assert.deepEqual(rememberWorkspace('a', ['b']), ['a', 'b'])
  })
})
