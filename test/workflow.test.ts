/**
 * Workflow state-machine tests against a real SQLite file: no Host context, no
 * mocks. They cover both the product path (requirement → design → story) and
 * the direct path (standalone story → development), plus defects and the run
 * lifecycle.
 *
 * There is no confirmation gate: content and stories are usable as soon as they
 * exist. A successful run only marks execution finished; completion is a
 * separate, explicit user action.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, it } from 'node:test'

import { openTeamflowDatabase, type TeamflowDatabase } from '../src/store/db.ts'
import { WorkflowError } from '../src/store/model.ts'

const directories: string[] = []
const handles: TeamflowDatabase[] = []

function open(): TeamflowDatabase {
  const dataDir = mkdtempSync(join(tmpdir(), 'teamflow-workflow-'))
  directories.push(dataDir)
  const handle = openTeamflowDatabase({
    dataDir,
    docsRoot: join(dataDir, 'workspace'),
    version: '0.1.0',
    log: { info: () => {}, warn: () => {}, error: () => {} },
  })
  handles.push(handle)
  return handle
}


afterEach(() => {
  while (handles.length > 0) handles.pop()?.close()
  while (directories.length > 0) {
    const dir = directories.pop()
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  }
})

function rejects(code: WorkflowError['code'], body: () => unknown): void {
  assert.throws(body, (error: unknown) => {
    assert.ok(error instanceof WorkflowError, `expected WorkflowError, got ${String(error)}`)
    assert.equal(error.code, code)
    return true
  })
}

describe('requirement completion', () => {
  it('completes a draft requirement on demand and is idempotent', () => {
    const handle = open()
    const workflow = handle.workflow
    const requirement = workflow.createRequirement({
      workspaceId: 'ws-tetris',
      title: '支持暂停',
      content: '用户希望能暂停一局游戏。',
    })
    assert.match(requirement.id, /^req_[A-Za-z0-9_-]{10,}$/)
    assert.equal(requirement.status, 'draft')
    assert.equal(requirement.completedAt, null)

    const updated = workflow.updateRequirement(requirement.id, { summary: '支持暂停并停止计时' })
    assert.equal(updated.summary, '支持暂停并停止计时')

    const completed = workflow.completeRequirement(requirement.id)
    assert.equal(completed.status, 'completed')
    assert.notEqual(completed.completedAt, null)
    // 重复点击完成是幂等的，不会报错也不会改时间。
    assert.equal(workflow.completeRequirement(requirement.id).completedAt, completed.completedAt)
    // 完成后仍可继续打磨正文：这里没有定稿，也不拒绝用户继续改。
    assert.equal(
      workflow.updateRequirement(requirement.id, { summary: '完成后的补充' }).summary,
      '完成后的补充',
    )
    // 已归档的需求不能完成。
    workflow.archiveRequirement(requirement.id)
    rejects('invalid_transition', () => workflow.completeRequirement(requirement.id))
  })
})

describe('requirement session binding', () => {
  it('records the creating session once and exposes it on the board', () => {
    const handle = open()
    const workflow = handle.workflow
    const requirement = workflow.createRequirement({
      workspaceId: 'ws-tetris',
      title: '从会话创建',
      sessionId: 'session-requirement',
    })
    assert.deepEqual(
      workflow.listRequirementSessions(requirement.id).map((session) => session.sessionId),
      ['session-requirement'],
    )
    assert.equal(workflow.getRequirementBySession('session-requirement')?.id, requirement.id)
    assert.deepEqual(
      workflow.listBoard().requirementSessions.map((session) => session.requirementId),
      [requirement.id],
    )
    assert.equal(
      workflow.bindRequirementSession(requirement.id, 'session-requirement').sessionId,
      'session-requirement',
    )
    rejects('invalid_input', () =>
      workflow.createRequirement({
        workspaceId: 'ws-tetris',
        title: '同一会话的第二个需求',
        sessionId: 'session-requirement',
      }),
    )
    assert.equal(workflow.getRequirementBySession('session-requirement')?.id, requirement.id)
  })
})

describe('creation session ids', () => {
  it('records the conversation that created a story or a defect', () => {
    const handle = open()
    const workflow = handle.workflow
    const story = workflow.createStory({
      workspaceId: 'ws-create',
      title: '从会话创建的故事',
      sessionId: 'session-story',
    })
    assert.equal(story.createSessionId, 'session-story')
    assert.equal(workflow.getStory(story.id)?.createSessionId, 'session-story')

    const bug = workflow.createBug({
      workspaceId: 'ws-create',
      title: '从会话创建的缺陷',
      sessionId: 'session-bug',
    })
    assert.equal(bug.createSessionId, 'session-bug')
    assert.equal(workflow.getBug(bug.id)?.createSessionId, 'session-bug')

    const board = workflow.listBoard()
    assert.equal(board.stories.find((row) => row.id === story.id)?.createSessionId, 'session-story')
    assert.equal(board.bugs.find((row) => row.id === bug.id)?.createSessionId, 'session-bug')
  })

  it('leaves the origin empty when the caller did not run in a conversation', () => {
    const handle = open()
    const workflow = handle.workflow
    const story = workflow.createStory({ workspaceId: 'ws-create-none', title: '无来源', sessionId: '  ' })
    assert.equal(story.createSessionId, null)
    const bug = workflow.createBug({ workspaceId: 'ws-create-none', title: '无来源的缺陷' })
    assert.equal(bug.createSessionId, null)
  })
})

describe('requirement readiness', () => {
  it('lets a story start immediately, even while the requirement is still a draft', () => {
    const handle = open()
    const workflow = handle.workflow
    const requirement = workflow.createRequirement({
      workspaceId: 'ws-tetris',
      title: '排行榜',
      summary: '增加本地最高分排行榜',
    })
    const story = workflow.createStory({
      requirementId: requirement.id,
      title: '展示排行榜列表',
      content: '## 验收标准\n\n前 10 名按分数倒序展示。',
    })
    assert.equal(story.workspaceId, requirement.workspaceId)
    assert.equal(story.status, 'ready')
    assert.deepEqual(workflow.getStoryReadiness(story.id), { ready: true, parentReady: true })
    assert.equal(workflow.startStoryRun(story.id).status, 'running')
  })

  it('refuses a story under an archived requirement', () => {
    const handle = open()
    const workflow = handle.workflow
    const requirement = workflow.createRequirement({ workspaceId: 'ws-p', title: '已归档', summary: '不再做' })
    workflow.archiveRequirement(requirement.id)
    rejects('invalid_transition', () =>
      workflow.createStory({ requirementId: requirement.id, title: '太晚的故事' }),
    )
  })
})

describe('development runs', () => {
  it('moves a passed story to done, stamps done_at, and completes it by hand', () => {
    const handle = open()
    const workflow = handle.workflow
    const story = workflow.createStory({ workspaceId: 'ws-p', title: '会通过的故事' })
    const run = workflow.startStoryRun(story.id)
    assert.equal(workflow.getStory(story.id)?.status, 'developing')

    workflow.beginSelfTest(run.id)
    assert.equal(workflow.getRun(run.id)?.status, 'self_testing')
    assert.equal(workflow.getStory(story.id)?.status, 'self_testing')

    const finished = workflow.finishRun({
      runId: run.id,
      selfTestStatus: 'passed',
      summary: '实现并通过自测',
    })
    assert.equal(finished.status, 'succeeded')
    const done = workflow.getStory(story.id)
    assert.equal(done?.status, 'done')
    assert.notEqual(done?.doneAt, null)
    assert.equal(done?.completedAt, null)

    const completed = workflow.completeStory(story.id)
    assert.equal(completed.status, 'completed')
    assert.notEqual(completed.completedAt, null)
    rejects('invalid_transition', () => workflow.completeStory(story.id))
  })

  it('cancels an active run and puts the story back in the queue', () => {
    const handle = open()
    const workflow = handle.workflow
    const story = workflow.createStory({ workspaceId: 'ws-p', title: '放弃的故事' })
    const run = workflow.startStoryRun(story.id)
    workflow.beginSelfTest(run.id)

    const cancelled = workflow.cancelStoryRun(story.id)
    assert.equal(cancelled.id, run.id)
    assert.equal(cancelled.status, 'cancelled')
    assert.equal(workflow.getStory(story.id)?.status, 'ready')
    rejects('not_found', () => workflow.cancelStoryRun(story.id))
  })

  it('cancels an idle story and refuses to reopen it', () => {
    const handle = open()
    const workflow = handle.workflow
    const story = workflow.createStory({ workspaceId: 'ws-p', title: '不再做的故事' })

    const cancelled = workflow.cancelStory(story.id)
    assert.equal(cancelled.status, 'cancelled')
    rejects('invalid_transition', () => workflow.startStoryRun(story.id))
    rejects('invalid_transition', () => workflow.cancelStory(story.id))
  })

  it('returns a failed story to ready and allows another attempt', () => {
    const handle = open()
    const workflow = handle.workflow
    const story = workflow.createStory({ workspaceId: 'ws-p', title: '会失败的故事' })
    const run = workflow.startStoryRun(story.id)
    workflow.beginSelfTest(run.id)
    const finished = workflow.finishRun({
      runId: run.id,
      selfTestStatus: 'failed',
      selfTestNotes: '断言失败',
    })
    assert.equal(finished.status, 'failed')
    assert.equal(workflow.getStory(story.id)?.status, 'ready')
    assert.equal(workflow.startStoryRun(story.id).status, 'running')
  })

  it('completes the requirement when the user completes its last story', () => {
    const handle = open()
    const workflow = handle.workflow
    const requirement = workflow.createRequirement({ workspaceId: 'ws-p', title: '一次做完' })
    const first = workflow.createStory({ requirementId: requirement.id, title: '第一步' })
    const second = workflow.createStory({ requirementId: requirement.id, title: '第二步' })

    workspaceComplete(workflow, first.id)
    assert.equal(workflow.getRequirement(requirement.id)?.status, 'draft')
    workspaceComplete(workflow, second.id)
    assert.equal(workflow.getRequirement(requirement.id)?.status, 'completed')
  })
})

/** Run one story to `done` and then complete it, the way the panel does. */
function workspaceComplete(workflow: TeamflowDatabase['workflow'], storyId: string): void {
  const run = workflow.startStoryRun(storyId)
  workflow.beginSelfTest(run.id)
  workflow.finishRun({ runId: run.id, selfTestStatus: 'passed', summary: '完成' })
  workflow.completeStory(storyId)
}

describe('direct story path', () => {
  it('lets a user-described story start development without requirement or design', () => {
    const handle = open()
    const workflow = handle.workflow
    const story = workflow.createStory({
      workspaceId: 'ws-tetris',
      title: '修复按钮错位',
      content: '## 验收标准\n\n按钮在 320px 宽度下不重叠。',
      size: 'xs',
    })
    assert.match(story.id, /^sty_/)
    assert.equal(story.requirementId, null)
    assert.equal(story.status, 'ready')

    const run = workflow.startStoryRun(story.id, { agent: 'dev-agent', branch: 'fix/button' })
    assert.match(run.id, /^run_/)
    assert.equal(run.kind, 'story_dev')
    rejects('duplicate_active_run', () => workflow.startStoryRun(story.id))
  })
})

describe('bug lifecycle', () => {
  it('goes reported → fixing → fixed → completed, with no confirmation gate', () => {
    const handle = open()
    const workflow = handle.workflow
    const bug = workflow.createBug({
      workspaceId: 'ws-tetris',
      title: '暂停后计时仍在走',
      content: '## 复现\n\n开始游戏 → 暂停 → 等待 5 秒\n\n## 期望\n\n计时停止\n\n## 实际\n\n计时继续',
      severity: 'major',
    })
    assert.match(bug.id, /^bug_/)
    assert.equal(bug.status, 'reported')

    // 缺陷收集完成即可直接进入修复，不再需要确认。
    const run = workflow.startBugFixRun(bug.id)
    assert.equal(workflow.getBug(bug.id)?.status, 'fixing')

    workflow.beginSelfTest(run.id)
    workflow.finishRun({ runId: run.id, selfTestStatus: 'passed', summary: '暂停时冻结计时器' })
    const fixed = workflow.getBug(bug.id)
    assert.equal(fixed?.status, 'fixed')
    assert.notEqual(fixed?.fixedAt, null)
    assert.equal(fixed?.completedAt, null)

    const completed = workflow.completeBug(bug.id)
    assert.equal(completed.status, 'completed')
    assert.notEqual(completed.completedAt, null)
    rejects('invalid_transition', () => workflow.completeBug(bug.id))
  })

  it('lets a collector merge a duplicate by editing a reported bug', () => {
    const handle = open()
    const workflow = handle.workflow
    const bug = workflow.createBug({ workspaceId: 'ws-p', title: '重复缺陷' })
    assert.equal(
      workflow.updateBug(bug.id, { title: '合并后的缺陷', severity: 'critical' }).title,
      '合并后的缺陷',
    )
  })

  it('requires a resolution to mark wontfix', () => {
    const handle = open()
    const workflow = handle.workflow
    const bug = workflow.createBug({ workspaceId: 'ws-p', title: '设计如此' })
    rejects('invalid_input', () => workflow.wontfixBug(bug.id, '   '))
    assert.equal(workflow.wontfixBug(bug.id, '符合预期，不修复').status, 'wontfix')
  })
})

describe('workspace ownership', () => {
  it('inherits the requirement workspace down the chain and onto runs', () => {
    const handle = open()
    const workflow = handle.workflow
    const requirement = workflow.createRequirement({
      workspaceId: 'ws-a',
      title: '工作区归属',
      summary: '所有实体都带上工作区',
    })
    const story = workflow.createStory({ requirementId: requirement.id, title: '故事' })
    const run = workflow.startStoryRun(story.id)

    assert.equal(requirement.workspaceId, 'ws-a')
    assert.equal(story.workspaceId, 'ws-a')
    assert.equal(run.workspaceId, 'ws-a')
    assert.deepEqual(
      workflow.listStories({ workspaceId: 'ws-a' }).map((entry) => entry.id),
      [story.id],
    )
    assert.deepEqual(workflow.listStories({ workspaceId: 'ws-b' }), [])
  })

  it('rejects a child that claims a different workspace than its parent', () => {
    const handle = open()
    const workflow = handle.workflow
    const requirement = workflow.createRequirement({
      workspaceId: 'ws-a',
      title: '跨工作区',
      summary: '不允许',
    })
    rejects('invalid_input', () =>
      workflow.createStory({ workspaceId: 'ws-b', requirementId: requirement.id, title: '故事' }),
    )
  })

  it('requires a workspace for entities without a parent', () => {
    const handle = open()
    const workflow = handle.workflow
    rejects('invalid_input', () => workflow.createStory({ title: '独立故事' }))
    rejects('invalid_input', () => workflow.createBug({ workspaceId: '', title: '独立缺陷' }))
  })
})

describe('identifier shape', () => {
  it('uses prefixed nanoids rather than auto-increment integers', () => {
    const handle = open()
    const workflow = handle.workflow
    const requirement = workflow.createRequirement({
      workspaceId: 'ws-p',
      title: 'ID 测试',
      summary: 'ID 测试',
    })
    const story = workflow.createStory({ workspaceId: 'ws-p', title: '独立故事' })
    assert.ok(requirement.id.length > 10)
    assert.ok(story.id.length > 10)
    assert.notEqual(requirement.id, story.id)
    assert.equal(Number.isInteger(Number(requirement.id)), false)
  })
})

describe('design documents', () => {
  it('keeps the long material out of the requirement body and links it to the stories it covers', () => {
    const handle = open()
    const workflow = handle.workflow
    const requirement = workflow.createRequirement({ workspaceId: 'ws-docs', title: '账号安全加固' })
    workflow.updateRequirement(requirement.id, { summary: '把刷新收敛到一个闸门' })
    const first = workflow.createStory({ requirementId: requirement.id, title: '静默刷新去重' })
    const second = workflow.createStory({ requirementId: requirement.id, title: '刷新失败回跳' })

    assert.deepEqual(workflow.listDesignDocs(requirement.id), [])

    const doc = workflow.createDesignDoc({
      requirementId: requirement.id,
      kind: 'flow',
      title: '刷新链路时序与并发窗口',
      content: '## 时序\n闸门 -> 重放',
      storyIds: [first.id],
    })
    assert.match(doc.id, /^doc_[A-Za-z0-9_-]{10,}$/)
    assert.equal(doc.sortOrder, 1)
    assert.equal(doc.kind, 'flow')

    const secondDoc = workflow.createDesignDoc({
      requirementId: requirement.id,
      kind: 'data',
      title: '令牌存储与清理规则',
      sortOrder: 1,
    })
    assert.deepEqual(
      workflow.listDesignDocs(requirement.id).map((entry) => entry.id),
      [doc.id, secondDoc.id],
    )
    assert.deepEqual(workflow.listDocStoryIds(doc.id), [first.id])

    workflow.linkDocStory(doc.id, second.id)
    workflow.linkDocStory(doc.id, second.id)
    assert.deepEqual(
      [...workflow.listDocStoryIds(doc.id)].sort(),
      [first.id, second.id].sort(),
    )

    const updated = workflow.updateDesignDoc(secondDoc.id, { title: '令牌存储、清理与回退', kind: 'rule' })
    assert.equal(updated.title, '令牌存储、清理与回退')
    assert.equal(updated.kind, 'rule')

    rejects('not_found', () =>
      workflow.createDesignDoc({ requirementId: requirement.id, title: '越界覆盖', storyIds: ['sty_missing'] }),
    )
  })

  it('refuses to cover a story that belongs to another requirement', () => {
    const handle = open()
    const workflow = handle.workflow
    const first = workflow.createRequirement({ workspaceId: 'ws-a', title: 'A', summary: 'A 的结论' })
    const second = workflow.createRequirement({ workspaceId: 'ws-a', title: 'B', summary: 'B 的结论' })
    const storyB = workflow.createStory({ requirementId: second.id, title: 'B 的故事' })

    const doc = workflow.createDesignDoc({ requirementId: first.id, title: 'A 的详设' })
    rejects('invalid_input', () => workflow.linkDocStory(doc.id, storyB.id))
  })
})

describe('display order', () => {
  it('appends new stories and documents after the current last position', () => {
    const handle = open()
    const workflow = handle.workflow
    const requirement = workflow.createRequirement({ workspaceId: 'ws-order', title: '顺序' })
    const first = workflow.createStory({ requirementId: requirement.id, title: '第一' })
    const second = workflow.createStory({ requirementId: requirement.id, title: '第二' })
    assert.deepEqual([first.sortOrder, second.sortOrder], [1, 2])

    const docA = workflow.createDesignDoc({ requirementId: requirement.id, title: '详设 A' })
    const docB = workflow.createDesignDoc({ requirementId: requirement.id, title: '详设 B' })
    assert.deepEqual([docA.sortOrder, docB.sortOrder], [1, 2])

    const third = workflow.createStory({ requirementId: requirement.id, title: '第三' })
    assert.equal(third.sortOrder, 3)
    assert.deepEqual(
      workflow.listStories({ requirementId: requirement.id }).map((row) => row.id),
      [first.id, second.id, third.id],
    )
    assert.deepEqual(
      workflow.listDesignDocs(requirement.id).map((row) => row.id),
      [docA.id, docB.id],
    )
  })

  it('keeps the position when the story runs and completes', () => {
    const handle = open()
    const workflow = handle.workflow
    const requirement = workflow.createRequirement({ workspaceId: 'ws-order', title: '顺序' })
    const first = workflow.createStory({ requirementId: requirement.id, title: '第一' })
    const second = workflow.createStory({ requirementId: requirement.id, title: '第二' })

    const run = workflow.startStoryRun(second.id)
    assert.equal(workflow.getStory(second.id)?.sortOrder, 2)
    workflow.beginSelfTest(run.id)
    workflow.finishRun({ runId: run.id, selfTestStatus: 'passed', summary: '完成' })
    assert.equal(workflow.getStory(second.id)?.sortOrder, 2)
    workflow.completeStory(second.id)
    assert.equal(workflow.getStory(second.id)?.sortOrder, 2)
    assert.deepEqual(
      workflow.listStories({ requirementId: requirement.id }).map((row) => row.id),
      [first.id, second.id],
    )
  })

  it('accepts an explicit position from the Agent and rejects invalid ones', () => {
    const handle = open()
    const workflow = handle.workflow
    const requirement = workflow.createRequirement({ workspaceId: 'ws-order', title: '顺序' })
    const first = workflow.createStory({ requirementId: requirement.id, title: '第一' })
    const second = workflow.createStory({ requirementId: requirement.id, title: '第二' })

    assert.equal(workflow.updateStory(second.id, { sortOrder: 0 }).sortOrder, 0)
    assert.deepEqual(
      workflow.listStories({ requirementId: requirement.id }).map((row) => row.id),
      [second.id, first.id],
    )
    rejects('invalid_input', () => workflow.updateStory(first.id, { sortOrder: -1 }))
    rejects('invalid_input', () => workflow.updateStory(first.id, { sortOrder: 1.5 }))
    rejects('invalid_input', () =>
      workflow.createDesignDoc({ requirementId: requirement.id, title: '越界位置', sortOrder: -2 }),
    )
    assert.equal(workflow.getStory(first.id)?.sortOrder, 1)
  })
})

describe('run session ids', () => {
  it('records the conversation a run happened in so the workbench can jump back', () => {
    const handle = open()
    const workflow = handle.workflow
    const story = workflow.createStory({ workspaceId: 'ws-run', title: '独立故事' })
    const run = workflow.startStoryRun(story.id, { agent: 'agent', branch: 'feat/x', sessionId: 'session-abc' })
    assert.equal(run.sessionId, 'session-abc')
    assert.equal(workflow.getRun(run.id)?.sessionId, 'session-abc')

    workflow.cancelRun(run.id)
    const detached = workflow.startStoryRun(story.id, {})
    assert.equal(detached.sessionId, null)
  })
})

describe('workbench board query', () => {
  it('orders work in progress first, then newest first, and returns every row the panel needs', () => {
    const handle = open()
    const workflow = handle.workflow
    const runningRequirement = workflow.createRequirement({
      workspaceId: 'ws-board',
      title: '工作台',
      summary: '把研发过程搬进工作台',
    })

    const runningStory = workflow.createStory({
      requirementId: runningRequirement.id,
      title: '研发中的故事',
      content: '## 验收标准\n\n列表能读到真实数据。',
    })
    const run = workflow.startStoryRun(runningStory.id, { sessionId: 'session-board' })

    const idleRequirement = workflow.createRequirement({
      workspaceId: 'ws-board',
      title: '还在排队的需求',
      summary: '尚未开始',
    })
    const idleStory = workflow.createStory({ workspaceId: 'ws-board', title: '独立故事' })
    // 时间戳写死，避免同一毫秒内排序随机：闲置的需求更“新”，
    // 但排序的第一关键字是“是否在执行中”。
    handle.db
      .prepare("UPDATE requirements SET updated_at = '2030-01-01T00:00:00.000Z' WHERE id = ?")
      .run(idleRequirement.id)
    handle.db
      .prepare("UPDATE stories SET updated_at = '2030-01-01T00:00:00.000Z' WHERE id = ?")
      .run(idleStory.id)

    const doc = workflow.createDesignDoc({
      requirementId: runningRequirement.id,
      kind: 'flow',
      title: '暂停流程',
      content: '# 流程',
      storyIds: [runningStory.id],
    })
    const bug = workflow.createBug({ workspaceId: 'ws-board', title: '暂停失效', severity: 'major' })
    const bugRun = workflow.startBugFixRun(bug.id, { sessionId: 'session-board' })

    const rows = workflow.listBoard()
    assert.deepEqual(
      rows.requirements.map((requirement) => requirement.id),
      [runningRequirement.id, idleRequirement.id],
    )
    assert.deepEqual(
      rows.stories.map((story) => story.id),
      [runningStory.id, idleStory.id],
    )
    assert.deepEqual(
      rows.docs.map((entry) => entry.id),
      [doc.id],
    )
    assert.deepEqual(rows.docStories, [{ docId: doc.id, storyId: runningStory.id }])
    assert.deepEqual(
      rows.bugs.map((entry) => entry.id),
      [bug.id],
    )
    assert.ok(
      rows.runs.some((entry) => entry.id === run.id),
      'the story run is part of the frame',
    )
    assert.ok(
      rows.runs.some((entry) => entry.id === bugRun.id),
      'the fix run is part of the frame',
    )
    // 正文留在磁盘上：面板拿到路径后按需读取，快照里不带 markdown。
    assert.match(runningStory.contentPath, /^\.xirang-ai\/dsh-teamflow\/stories\//)
    assert.equal(workflow.getDesignDoc(doc.id)?.title, '暂停流程')
    assert.equal(workflow.getDesignDoc('doc_missing'), null)
  })
})
