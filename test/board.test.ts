/**
 * Browser view-model tests: snapshot in, panel tree out. Everything here is a
 * pure function, so no Host context, no React, and no database are involved.
 *
 * The Remote contract is checked in the same file because both halves share it:
 * a descriptor that stops being `strict` breaks mounting before any data moves.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  EMPTY_BOARD,
  LANE_ORDER,
  bugState,
  buildBoard,
  formatWhen,
  parseStoryBody,
  requirementLane,
  runState,
  storyState,
} from '../src/client/board.ts'
import {
  DESCRIPTORS,
  PACKAGE_NAME,
  REMOTE_CONTRIBUTION,
  SERVICE_KEY,
  TYPERT_MANIFEST,
} from '../src/remote/contract.ts'
import type { WorkbenchSnapshot } from '../src/remote/contract.ts'

/** One frame with a running requirement, a standalone story, a defect and two runs. */
function frame(): WorkbenchSnapshot {
  return {
    generatedAt: '2026-11-06T04:00:00.000Z',
    requirements: [
      {
        id: 'req_pause',
        workspaceId: 'ws-tetris',
        title: '支持暂停',
        summary: '',
        status: 'draft',
        completedAt: null,
        updatedAt: '2026-11-06T04:00:00.000Z',
        path: '.xirang-ai/dsh-teamflow/requirements/req_pause/requirement.md',
        body: '# 概设\n\n点击暂停后停止计时。',
        bodyMissing: false,
      },
      {
        id: 'req_new',
        workspaceId: 'ws-tetris',
        title: '会话创建的需求',
        summary: '还没有完成',
        status: 'draft',
        completedAt: null,
        updatedAt: '2026-11-06T09:30:00.000Z',
        path: '.xirang-ai/dsh-teamflow/requirements/req_new/requirement.md',
        body: '# 需求\n\n从会话创建。',
        bodyMissing: false,
      },
    ],
    stories: [
      {
        id: 'sty_pause',
        workspaceId: 'ws-tetris',
        requirementId: 'req_pause',
        title: '暂停按钮',
        status: 'developing',
        size: 's',
        sortOrder: 1,
        createdAt: '2026-11-06T01:00:00.000Z',
        doneAt: null,
        completedAt: null,
        createSessionId: null,
        sessions: [],
        updatedAt: '2026-11-06T03:00:00.000Z',
        path: '.xirang-ai/dsh-teamflow/stories/sty_pause/story.md',
        body: '玩家点击暂停，计时停止。\n\n## 验收标准\n\n1. 点击后暂停\n2. 再点恢复',
        bodyMissing: false,
      },
      {
        id: 'sty_solo',
        workspaceId: 'ws-snake',
        requirementId: null,
        title: '独立故事',
        status: 'ready',
        size: 'm',
        sortOrder: 1,
        createdAt: '2026-11-04T01:00:00.000Z',
        doneAt: null,
        completedAt: null,
        createSessionId: null,
        sessions: [],
        updatedAt: '2026-11-04T03:00:00.000Z',
        path: '.xirang-ai/dsh-teamflow/stories/sty_solo/story.md',
        body: '一句话就够了。',
        bodyMissing: false,
      },
      {
        id: 'sty_resume',
        workspaceId: 'ws-tetris',
        requirementId: 'req_pause',
        title: '恢复按钮',
        status: 'completed',
        size: 's',
        sortOrder: 2,
        createdAt: '2026-11-03T01:00:00.000Z',
        doneAt: '2026-11-05T03:30:00.000Z',
        completedAt: '2026-11-05T04:00:00.000Z',
        createSessionId: 'session-split',
        sessions: [],
        updatedAt: '2026-11-05T03:00:00.000Z',
        path: '.xirang-ai/dsh-teamflow/stories/sty_resume/story.md',
        body: '已经做完。',
        bodyMissing: false,
      },
    ],
    docs: [
      {
        id: 'doc_flow',
        requirementId: 'req_pause',
        kind: 'flow',
        title: '暂停流程',
        sortOrder: 1,
        createdAt: '2026-11-02T01:00:00.000Z',
        updatedAt: '2026-11-05T03:00:00.000Z',
        path: '.xirang-ai/dsh-teamflow/requirements/req_pause/docs/doc_flow.md',
        storyIds: ['sty_pause'],
      },
    ],
    bugs: [
      {
        id: 'bug_resume',
        workspaceId: 'ws-tetris',
        title: '暂停后无法恢复',
        severity: 'major',
        status: 'fixed',
        resolution: '',
        fixedAt: '2026-11-06T02:30:00.000Z',
        completedAt: null,
        createSessionId: 'session-bug',
        sessions: [],
        updatedAt: '2026-11-06T02:00:00.000Z',
        body: '## 复现步骤\n\n1. 开始游戏\n2. 暂停',
        bodyMissing: false,
      },
    ],
    requirementSessions: [
      {
        requirementId: 'req_pause',
        sessionId: 'session-design',
        kind: 'design',
        preparedAt: '2026-11-05T04:30:00.000Z',
        linkedAt: '2026-11-06T05:00:00.000Z',
        createdAt: '2026-11-05T04:30:00.000Z',
      },
      {
        requirementId: 'req_new',
        sessionId: 'session-requirement',
        kind: 'create',
        preparedAt: null,
        linkedAt: null,
        createdAt: '2026-11-06T09:30:00.000Z',
      },
    ],
    runs: [
      {
        id: 'run_live',
        kind: 'story_dev',
        storyId: 'sty_pause',
        bugId: null,
        status: 'running',
        sessionId: 'session-live',
        permissionTier: null,
        branch: 'feat/pause',
        summary: '',
        startedAt: '2026-11-06T03:30:00.000Z',
        finishedAt: null,
      },
      {
        id: 'run_old',
        kind: 'story_dev',
        storyId: 'sty_pause',
        bugId: null,
        status: 'failed',
        sessionId: null,
        permissionTier: null,
        branch: 'feat/pause-old',
        summary: '',
        startedAt: '2026-11-05T03:30:00.000Z',
        finishedAt: '2026-11-05T04:00:00.000Z',
      },
    ],
  }
}

describe('status mapping', () => {
  it('folds story statuses onto the three list states', () => {
    assert.equal(storyState('ready'), 'ready')
    assert.equal(storyState('developing'), 'running')
    assert.equal(storyState('self_testing'), 'running')
    assert.equal(storyState('done'), 'done')
    assert.equal(storyState('completed'), 'done')
    assert.equal(storyState('cancelled'), 'done')
  })

  it('keeps a fixed defect in the work queue until the user confirms it', () => {
    assert.equal(bugState('reported'), 'ready')
    assert.equal(bugState('fixing'), 'running')
    assert.equal(bugState('fixed'), 'ready')
    assert.equal(bugState('completed'), 'done')
    assert.equal(bugState('wontfix'), 'done')
  })

  it('puts open requirements in the discussion lane and finished ones in done', () => {
    assert.equal(requirementLane('draft'), 'discussing')
    assert.equal(requirementLane('completed'), 'done')
    assert.equal(requirementLane('archived'), 'done')
    assert.deepEqual(LANE_ORDER, ['running', 'ready', 'discussing', 'done'])
  })

  it('counts a run as moving until it reaches a terminal status', () => {
    assert.equal(runState('running'), 'running')
    assert.equal(runState('self_testing'), 'running')
    assert.equal(runState('succeeded'), 'done')
    assert.equal(runState('failed'), 'done')
    assert.equal(runState('cancelled'), 'done')
  })
})

describe('story body parsing', () => {
  it('splits the prose from the acceptance list', () => {
    const parsed = parseStoryBody('玩家点击暂停。\n\n## 验收标准\n\n1. 点击后暂停\n- 再点恢复\n')
    assert.equal(parsed.description, '玩家点击暂停。')
    assert.deepEqual(parsed.acceptance, ['点击后暂停', '再点恢复'])
  })

  it('accepts an English heading and a body without one', () => {
    assert.deepEqual(parseStoryBody('Pause the timer.\n\n## Acceptance criteria\n\n- timer stops').acceptance, [
      'timer stops',
    ])
    assert.deepEqual(parseStoryBody('只有一句话。'), { description: '只有一句话。', acceptance: [] })
  })
})

describe('board assembly', () => {
  it('turns one snapshot into requirements, standalone stories and defects', () => {
    const board = buildBoard(frame())
    assert.deepEqual(board.requirements.map((requirement) => requirement.id), ['req_pause', 'req_new'])
    const [pause, draft] = board.requirements
    assert.equal(pause?.state, 'running')
    assert.equal(pause?.branch, 'feat/pause')
    assert.equal(pause?.sessionId, 'session-design')
    assert.deepEqual(pause?.sessions, [
      { sessionId: 'session-design', kind: 'design', at: '2026-11-06T05:00:00.000Z' },
    ])
    assert.deepEqual(pause?.stories.map((story) => story.id), ['sty_pause', 'sty_resume'])
    assert.equal(draft?.state, 'ready')
    assert.equal(draft?.summary, '还没有完成')
    assert.deepEqual(draft?.sessions, [
      { sessionId: 'session-requirement', kind: 'create', at: '2026-11-06T09:30:00.000Z' },
    ])
    assert.equal(board.standalone.length, 1)
    assert.equal(board.standalone[0]?.story.id, 'sty_solo')
    assert.equal(board.standalone[0]?.workspaceId, 'ws-snake')
    assert.equal(board.bugs[0]?.state, 'ready')
  })

  it('carries the conversation that created a story or a defect, and nothing when none was recorded', () => {
    const board = buildBoard(frame())
    const [pause] = board.requirements
    // Only rows with an origin get the field: the surface renders an absent
    // origin as "no session", never as a broken link.
    assert.equal(pause?.stories[0]?.createSessionId, undefined)
    assert.equal(pause?.stories[1]?.createSessionId, 'session-split')
    assert.equal(board.standalone[0]?.story.createSessionId, undefined)
    assert.equal(board.bugs[0]?.createSessionId, 'session-bug')
  })

  it('links a story to the document that covers it and keeps the latest run', () => {
    const board = buildBoard(frame())
    const pause = board.requirements[0]
    assert.equal(pause?.docs[0]?.id, 'doc_flow')
    const story = pause?.stories[0]
    assert.equal(story?.docId, 'doc_flow')
    assert.equal(story?.sessionId, 'session-live')
    assert.deepEqual(story?.lastRun, { status: 'running', at: '2026-11-06T03:30:00.000Z' })
    assert.deepEqual(story?.runs.map((run) => run.id), ['run_live', 'run_old'])
    assert.deepEqual(story?.acceptance, ['点击后暂停', '再点恢复'])
    // The story surface renders `story.md` itself, so the board must keep the
    // raw markdown (headings, tables, blank lines) instead of the parsed view.
    assert.equal(story?.body, '玩家点击暂停，计时停止。\n\n## 验收标准\n\n1. 点击后暂停\n2. 再点恢复')
  })

  it("orders a requirement's stories and documents by the stored position, not by arrival", () => {
    const snapshot = frame()
    // The Host pins running work first; the requirement page must not follow it.
    const reordered: WorkbenchSnapshot = {
      ...snapshot,
      stories: [...snapshot.stories].reverse(),
      docs: [...snapshot.docs].reverse(),
    }
    const pause = buildBoard(reordered).requirements.find((row) => row.id === 'req_pause')
    assert.deepEqual(pause?.stories.map((story) => story.id), ['sty_pause', 'sty_resume'])
    assert.deepEqual(pause?.docs.map((doc) => doc.id), ['doc_flow'])
  })

  it('falls back to creation time when two rows share a display position', () => {
    const snapshot = frame()
    const [pauseStory, , resumeStory] = snapshot.stories
    const tied: WorkbenchSnapshot = {
      ...snapshot,
      stories: [
        { ...resumeStory!, sortOrder: 7 },
        { ...pauseStory!, sortOrder: 7 },
      ],
    }
    const pause = buildBoard(tied).requirements.find((row) => row.id === 'req_pause')
    // sty_resume was created first, so it wins the tie regardless of status.
    assert.deepEqual(pause?.stories.map((story) => story.id), ['sty_resume', 'sty_pause'])
  })

  it('reports a finished requirement as done and an empty board as empty', () => {
    const snapshot = frame()
    const [first, ...rest] = snapshot.stories
    const finished: WorkbenchSnapshot = {
      ...snapshot,
      stories: [{ ...first!, status: 'completed' }, ...rest],
    }
    const requirement = buildBoard(finished).requirements[0]
    assert.equal(requirement?.state, 'done')

    // `done` means the run finished; only `completed` closes the story.
    const executed = buildBoard({ ...snapshot, stories: [{ ...first!, status: 'done' }, ...rest] })
    assert.notEqual(executed.requirements[0]?.state, 'done')
    assert.deepEqual(EMPTY_BOARD, { requirements: [], standalone: [], bugs: [] })
  })
})

describe('timestamp formatting', () => {
  it('renders the reader wall clock and keeps junk readable', () => {
    const at = new Date('2026-11-06T04:05:00.000Z')
    const pad = (value: number) => String(value).padStart(2, '0')
    const expected = `${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`
    assert.equal(formatWhen('2026-11-06T04:05:00.000Z'), expected)
    assert.equal(formatWhen('not a date'), 'not a date')
  })
})

describe('remote contract', () => {
  it('declares one strict descriptor per method', () => {
    assert.equal(REMOTE_CONTRIBUTION.package, PACKAGE_NAME)
    assert.equal(DESCRIPTORS.length, 16)
    assert.deepEqual(
      DESCRIPTORS.map((descriptor) => descriptor.method),
      [
        'snapshot',
        'readDoc',
        'startStoryRun',
        'cancelStoryRun',
        'startBugFixRun',
        'cancelBugRun',
        'completeRequirement',
        'completeStory',
        'cancelStory',
        'completeBug',
        'prepareRequirementSession',
        'prepareDiscussionSession',
        'sessionPermissionTier',
        'previewDelete',
        'deleteRecords',
        'attachmentPolicy',
      ],
    )
    for (const descriptor of DESCRIPTORS) {
      assert.equal(descriptor.service, SERVICE_KEY)
      assert.equal(descriptor.namespace, 'teamflow')
      assert.equal(descriptor.invocation.kind, 'direct')
      assert.equal(descriptor.result.mode, 'strict')
      assert.equal(typeof descriptor.result.create, 'function')
      for (const parameter of descriptor.parameters) {
        assert.equal(parameter.source, 'json')
        assert.equal(parameter.codec.mode, 'strict')
        assert.equal(typeof parameter.codec.create, 'function')
      }
    }
    assert.deepEqual(
      DESCRIPTORS[1]?.parameters.map((parameter) => parameter.wire),
      ['docId', 'locale'],
    )
    assert.deepEqual(
      DESCRIPTORS[2]?.parameters.map((parameter) => parameter.wire),
      ['storyId', 'sessionId', 'locale', 'permissionTier'],
    )
    assert.deepEqual(
      DESCRIPTORS[3]?.parameters.map((parameter) => parameter.wire),
      ['storyId', 'locale'],
    )
    assert.deepEqual(
      DESCRIPTORS[4]?.parameters.map((parameter) => parameter.wire),
      ['bugId', 'sessionId', 'locale', 'permissionTier'],
    )
    assert.deepEqual(
      DESCRIPTORS[5]?.parameters.map((parameter) => parameter.wire),
      ['bugId', 'locale'],
    )
    assert.deepEqual(
      DESCRIPTORS[6]?.parameters.map((parameter) => parameter.wire),
      ['requirementId', 'locale'],
    )
    for (const index of [7, 8]) {
      assert.deepEqual(
        DESCRIPTORS[index]?.parameters.map((parameter) => parameter.wire),
        ['storyId', 'locale'],
      )
    }
    assert.deepEqual(
      DESCRIPTORS[9]?.parameters.map((parameter) => parameter.wire),
      ['bugId', 'locale'],
    )
    assert.deepEqual(
      DESCRIPTORS[10]?.parameters.map((parameter) => parameter.wire),
      ['requirementId', 'sessionId', 'kind', 'locale'],
    )
    assert.deepEqual(
      DESCRIPTORS[11]?.parameters.map((parameter) => parameter.wire),
      ['subjectType', 'subjectId', 'sessionId', 'kind', 'locale'],
    )
    assert.deepEqual(
      DESCRIPTORS[12]?.parameters.map((parameter) => parameter.wire),
      ['sessionId', 'locale'],
    )
    for (const descriptor of DESCRIPTORS.slice(13, 15)) {
      assert.deepEqual(
        descriptor.parameters.map((parameter) => parameter.wire),
        ['targets', 'locale'],
      )
    }
    // The create page reads the Host's attachment rules; nothing but the
    // caller's locale goes over the wire.
    assert.deepEqual(
      DESCRIPTORS[15]?.parameters.map((parameter) => parameter.wire),
      ['locale'],
    )
  })

  it('registers the Host face with the same invocation table', () => {
    assert.equal(TYPERT_MANIFEST.face, 'host')
    assert.equal(TYPERT_MANIFEST.package, PACKAGE_NAME)
    assert.equal(TYPERT_MANIFEST.invocations, DESCRIPTORS)
    assert.equal(TYPERT_MANIFEST.model.services.length, 0)
  })
})
