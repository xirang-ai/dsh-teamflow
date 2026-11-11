/**
 * Conversation-side mapping tests.
 *
 * `resolveSessionTopic` is the only place that decides which detail page the
 * read-only tab renders, so these cases pin the mapping table itself: every
 * stored 环节 kind, the precedence between a run and a requirement link, and
 * the fallbacks (no link, unknown kind, incomplete row) that the tab turns into
 * the empty and placeholder states.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { WorkbenchSnapshot } from '../src/remote/contract.ts'
import {
  SESSION_TOPIC_PAGES,
  resolveSessionTab,
  resolveSessionTopic,
} from '../src/client/session-link.ts'

/** The wire frame is readonly; tests build it up row by row instead. */
type MutableSnapshot = {
  -readonly [Key in keyof WorkbenchSnapshot]: WorkbenchSnapshot[Key] extends readonly (infer Row)[]
    ? Row[]
    : WorkbenchSnapshot[Key]
}

/** One empty frame; each test adds only the rows it is about. */
function frame(): MutableSnapshot {
  return {
    generatedAt: '2026-11-07T04:00:00.000Z',
    requirements: [],
    stories: [],
    docs: [],
    bugs: [],
    runs: [],
    requirementSessions: [],
  }
}

/** The story row a story run points at, optionally recording its origin. */
function storyRow(
  id: string,
  requirementId: string | null,
  createSessionId: string | null = null,
): WorkbenchSnapshot['stories'][number] {
  return {
    id,
    workspaceId: 'ws-tetris',
    requirementId,
    title: `story ${id}`,
    status: 'developing',
    size: 'm',
    sortOrder: 1,
    createdAt: '2026-11-07T04:00:00.000Z',
    doneAt: null,
    completedAt: null,
    createSessionId,
    updatedAt: '2026-11-07T04:00:00.000Z',
    path: `.xirang-ai/dsh-teamflow/stories/${id}/story.md`,
    body: '',
    bodyMissing: false,
    sessions: [],
  }
}

/** The defect row a fix run points at, optionally recording its origin. */
function bugRow(id: string, createSessionId: string | null = null): WorkbenchSnapshot['bugs'][number] {
  return {
    id,
    workspaceId: 'ws-tetris',
    title: `bug ${id}`,
    severity: 'major',
    status: 'reported',
    resolution: '',
    fixedAt: null,
    completedAt: null,
    createSessionId,
    updatedAt: '2026-11-07T04:00:00.000Z',
    body: '',
    bodyMissing: false,
    sessions: [],
  }
}

describe('session topic mapping', () => {
  it('maps requirement, outline, detailed design and story splitting to the requirement page', () => {
    for (const kind of ['create', 'design', 'detail', 'split'] as const) {
      const snapshot = frame()
      snapshot.requirementSessions.push({
        requirementId: 'req_1',
        sessionId: `session-${kind}`,
        kind,
        preparedAt: '2026-11-07T04:00:00.000Z',
        linkedAt: kind === 'create' ? null : '2026-11-07T04:05:00.000Z',
        createdAt: '2026-11-07T04:00:00.000Z',
      })
      assert.deepEqual(resolveSessionTopic(snapshot, `session-${kind}`), {
        kind,
        page: 'requirement',
        target: { kind: 'requirement', id: 'req_1' },
      })
    }
  })

  it('shows the story page for a development run and keeps its requirement', () => {
    const snapshot = frame()
    snapshot.stories.push(storyRow('sty_1', 'req_1'))
    snapshot.runs.push({
      id: 'run_1',
      kind: 'story_dev',
      storyId: 'sty_1',
      bugId: null,
      status: 'running',
      sessionId: 'session-dev',
      permissionTier: null,
      branch: 'teamflow/sty_1',
      summary: '',
      startedAt: '2026-11-07T04:00:00.000Z',
      finishedAt: null,
    })
    assert.deepEqual(resolveSessionTopic(snapshot, 'session-dev'), {
      kind: 'story_dev',
      page: 'story',
      target: { kind: 'story', id: 'sty_1', requirementId: 'req_1' },
    })
  })

  it('shows the page of the story a conversation created', () => {
    const snapshot = frame()
    snapshot.stories.push(storyRow('sty_1', 'req_1', 'session-create'))
    assert.deepEqual(resolveSessionTopic(snapshot, 'session-create'), {
      kind: 'story_create',
      page: 'story',
      target: { kind: 'story', id: 'sty_1', requirementId: 'req_1' },
    })
    assert.deepEqual(resolveSessionTab(snapshot, 'session-create'), {
      kind: 'detail',
      target: { kind: 'story', id: 'sty_1', requirementId: 'req_1' },
    })
  })

  it('shows the page of the defect a conversation created', () => {
    const snapshot = frame()
    snapshot.bugs.push(bugRow('bug_1', 'session-create-bug'))
    assert.deepEqual(resolveSessionTopic(snapshot, 'session-create-bug'), {
      kind: 'bug_create',
      page: 'bug',
      target: { kind: 'bug', id: 'bug_1' },
    })
    assert.deepEqual(resolveSessionTab(snapshot, 'session-create-bug'), {
      kind: 'detail',
      target: { kind: 'bug', id: 'bug_1' },
    })
  })

  it('prefers the work a conversation is doing over what it created', () => {
    const snapshot = frame()
    snapshot.stories.push(storyRow('sty_1', 'req_1', 'session-both'))
    snapshot.bugs.push(bugRow('bug_1', 'session-both'))
    snapshot.runs.push({
      id: 'run_dev',
      kind: 'story_dev',
      storyId: 'sty_1',
      bugId: null,
      status: 'running',
      sessionId: 'session-both',
      permissionTier: null,
      branch: '',
      summary: '',
      startedAt: null,
      finishedAt: null,
    })
    assert.deepEqual(resolveSessionTopic(snapshot, 'session-both'), {
      kind: 'story_dev',
      page: 'story',
      target: { kind: 'story', id: 'sty_1', requirementId: 'req_1' },
    })
  })

  it('keeps a standalone story without a parent requirement', () => {
    const snapshot = frame()
    snapshot.stories.push(storyRow('sty_alone', null))
    snapshot.runs.push({
      id: 'run_1',
      kind: 'story_dev',
      storyId: 'sty_alone',
      bugId: null,
      status: 'running',
      sessionId: 'session-dev',
      permissionTier: null,
      branch: '',
      summary: '',
      startedAt: null,
      finishedAt: null,
    })
    const topic = resolveSessionTopic(snapshot, 'session-dev')
    assert.deepEqual(topic?.target, { kind: 'story', id: 'sty_alone', requirementId: null })
  })

  it('shows the bug page for a fix run', () => {
    const snapshot = frame()
    snapshot.runs.push({
      id: 'run_fix',
      kind: 'bug_fix',
      storyId: null,
      bugId: 'bug_1',
      status: 'running',
      sessionId: 'session-fix',
      permissionTier: null,
      branch: '',
      summary: '',
      startedAt: null,
      finishedAt: null,
    })
    assert.deepEqual(resolveSessionTopic(snapshot, 'session-fix'), {
      kind: 'bug_fix',
      page: 'bug',
      target: { kind: 'bug', id: 'bug_1' },
    })
  })

  it('prefers the latest run over a requirement link in the same conversation', () => {
    const snapshot = frame()
    snapshot.requirementSessions.push({
      requirementId: 'req_1',
      sessionId: 'session-both',
      kind: 'create',
      preparedAt: null,
      linkedAt: null,
      createdAt: '2026-11-07T04:00:00.000Z',
    })
    snapshot.stories.push(storyRow('sty_1', 'req_1'))
    snapshot.runs.push(
      {
        id: 'run_old',
        kind: 'story_dev',
        storyId: 'sty_1',
        bugId: null,
        status: 'succeeded',
        sessionId: 'session-both',
        permissionTier: null,
        branch: '',
        summary: '',
        startedAt: null,
        finishedAt: null,
      },
    )
    assert.equal(resolveSessionTopic(snapshot, 'session-both')?.page, 'story')
  })

  it('returns no topic for a conversation without a link', () => {
    const snapshot = frame()
    snapshot.requirementSessions.push({
      requirementId: 'req_1',
      sessionId: 'session-other',
      kind: 'design',
      preparedAt: null,
      linkedAt: '2026-11-07T04:00:00.000Z',
      createdAt: '2026-11-07T04:00:00.000Z',
    })
    assert.equal(resolveSessionTopic(snapshot, 'session-mine'), null)
    assert.equal(resolveSessionTopic(snapshot, undefined), null)
    assert.equal(resolveSessionTopic(snapshot, ''), null)
  })

  it('falls through to the placeholder for a kind the table does not know', () => {
    const snapshot = frame()
    snapshot.requirementSessions.push({
      requirementId: 'req_1',
      sessionId: 'session-future',
      // A kind added by a later plugin build; the tab must not guess a page.
      kind: 'future_stage' as never,
      preparedAt: null,
      linkedAt: null,
      createdAt: '2026-11-07T04:00:00.000Z',
    })
    assert.deepEqual(resolveSessionTopic(snapshot, 'session-future'), {
      kind: 'future_stage',
      page: null,
      target: null,
    })
    assert.equal(SESSION_TOPIC_PAGES.future_stage, undefined)
  })

  it('keeps a story run without a story id as a page-less topic', () => {
    const snapshot = frame()
    snapshot.runs.push({
      id: 'run_broken',
      kind: 'story_dev',
      storyId: null,
      bugId: null,
      status: 'running',
      sessionId: 'session-broken',
      permissionTier: null,
      branch: '',
      summary: '',
      startedAt: null,
      finishedAt: null,
    })
    assert.deepEqual(resolveSessionTopic(snapshot, 'session-broken'), {
      kind: 'story_dev',
      page: 'story',
      target: null,
    })
  })
})

describe('session tab state', () => {
  it('renders the empty state without a link', () => {
    assert.deepEqual(resolveSessionTab(frame(), 'session-mine'), { kind: 'empty' })
  })

  it('renders the placeholder for a 环节 without a detail page', () => {
    const snapshot = frame()
    snapshot.requirementSessions.push({
      requirementId: 'req_1',
      sessionId: 'session-future',
      kind: 'future_stage' as never,
      preparedAt: null,
      linkedAt: null,
      createdAt: '2026-11-07T04:00:00.000Z',
    })
    assert.deepEqual(resolveSessionTab(snapshot, 'session-future'), {
      kind: 'placeholder',
      topicKind: 'future_stage',
    })
  })

  it('renders the detail state for a requirement link', () => {
    const snapshot = frame()
    snapshot.requirementSessions.push({
      requirementId: 'req_1',
      sessionId: 'session-design',
      kind: 'design',
      preparedAt: '2026-11-07T04:00:00.000Z',
      linkedAt: null,
      createdAt: '2026-11-07T04:00:00.000Z',
    })
    snapshot.requirements.push({
      id: 'req_1',
      workspaceId: 'ws-tetris',
      title: '需求',
      summary: '',
      status: 'draft',
      updatedAt: '2026-11-07T04:00:00.000Z',
      path: '.xirang-ai/dsh-teamflow/requirements/req_1/requirement.md',
      body: '',
      bodyMissing: false,
      completedAt: null,
    })
    assert.deepEqual(resolveSessionTab(snapshot, 'session-design'), {
      kind: 'detail',
      target: { kind: 'requirement', id: 'req_1' },
    })
  })

  it('reports a missing record when the link outlives its row', () => {
    const snapshot = frame()
    snapshot.requirementSessions.push({
      requirementId: 'req_gone',
      sessionId: 'session-design',
      kind: 'design',
      preparedAt: null,
      linkedAt: null,
      createdAt: '2026-11-07T04:00:00.000Z',
    })
    assert.deepEqual(resolveSessionTab(snapshot, 'session-design'), { kind: 'missing' })

    const devSnapshot = frame()
    devSnapshot.runs.push({
      id: 'run_1',
      kind: 'story_dev',
      storyId: 'sty_gone',
      bugId: null,
      status: 'running',
      sessionId: 'session-dev',
      permissionTier: null,
      branch: '',
      summary: '',
      startedAt: null,
      finishedAt: null,
    })
    assert.deepEqual(resolveSessionTab(devSnapshot, 'session-dev'), { kind: 'missing' })
  })

  it('renders the detail state for development and fix runs', () => {
    const snapshot = frame()
    snapshot.stories.push(storyRow('sty_1', 'req_1'))
    snapshot.bugs.push({
      id: 'bug_1',
      workspaceId: 'ws-tetris',
      title: '缺陷',
      severity: 'major',
      status: 'fixing',
      resolution: '',
      fixedAt: null,
      completedAt: null,
      createSessionId: null,
      updatedAt: '2026-11-07T04:00:00.000Z',
      body: '',
      bodyMissing: false,
      sessions: [],
    })
    snapshot.runs.push(
      {
        id: 'run_dev',
        kind: 'story_dev',
        storyId: 'sty_1',
        bugId: null,
        status: 'running',
        sessionId: 'session-dev',
        permissionTier: null,
        branch: '',
        summary: '',
        startedAt: null,
        finishedAt: null,
      },
      {
        id: 'run_fix',
        kind: 'bug_fix',
        storyId: null,
        bugId: 'bug_1',
        status: 'running',
        sessionId: 'session-fix',
        permissionTier: null,
        branch: '',
        summary: '',
        startedAt: null,
        finishedAt: null,
      },
    )
    assert.deepEqual(resolveSessionTab(snapshot, 'session-dev'), {
      kind: 'detail',
      target: { kind: 'story', id: 'sty_1', requirementId: 'req_1' },
    })
    assert.deepEqual(resolveSessionTab(snapshot, 'session-fix'), {
      kind: 'detail',
      target: { kind: 'bug', id: 'bug_1' },
    })
  })
})
