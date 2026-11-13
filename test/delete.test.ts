/**
 * Physical deletion: status whitelist, run re-check, cascade, file/record
 * consistency and batch reporting, against a real SQLite file and real
 * Markdown files in a temporary workspace.
 */
import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, it } from 'node:test'

import { openTeamflowDatabase, type TeamflowDatabase } from '../src/store/db.ts'
import { WorkflowError } from '../src/store/model.ts'

interface Fixture {
  readonly handle: TeamflowDatabase
  readonly root: string
}

const directories: string[] = []
const handles: TeamflowDatabase[] = []

function open(): Fixture {
  const dataDir = mkdtempSync(join(tmpdir(), 'teamflow-delete-'))
  directories.push(dataDir)
  const root = join(dataDir, 'workspace')
  const handle = openTeamflowDatabase({
    dataDir,
    docsDir: root,
    version: '0.1.0',
    log: { info: () => {}, warn: () => {}, error: () => {} },
  })
  handles.push(handle)
  return { handle, root }
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

function count(handle: TeamflowDatabase, table: string, column: string, id: string): number {
  const row = handle.db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column} = ?`).get(id)
  return Number(row?.['n'] ?? 0)
}

describe('requirement cascade', () => {
  it('previews and then removes the requirement, its detailed designs and every file', () => {
    const { handle, root } = open()
    const workflow = handle.workflow
    const requirement = workflow.createRequirement({
      workspaceId: 'ws-delete',
      title: '可删除的需求',
      summary: '删除需求演示',
      content: '# 需求',
    })
    workflow.updateRequirement(requirement.id, { content: '# 概设正文' })
    const docs = ['流程', '接口', '数据'].map((title, index) =>
      workflow.createDesignDoc({
        requirementId: requirement.id,
        title,
        kind: (['flow', 'interface', 'data'] as const)[index] ?? 'flow',
        content: `# ${title}`,
      }),
    )
    const requirementFile = join(root, requirement.contentPath)
    assert.ok(existsSync(requirementFile))
    for (const doc of docs) assert.ok(existsSync(join(root, doc.contentPath)))

    const preview = workflow.previewDeletions([{ kind: 'requirement', id: requirement.id }])
    assert.equal(preview.deletableCount, 1)
    assert.equal(preview.docCount, 3)
    assert.equal(preview.items[0]?.docs.length, 3)
    assert.equal(preview.items[0]?.deletable, true)

    const report = workflow.deleteRecords([{ kind: 'requirement', id: requirement.id }])
    assert.equal(report.succeeded, 1)
    assert.equal(report.failed, 0)
    assert.equal(report.results[0]?.removedDocs, 3)
    assert.equal(report.results[0]?.removedRuns, 0)

    assert.equal(workflow.getRequirement(requirement.id), null)
    assert.equal(count(handle, 'design_docs', 'requirement_id', requirement.id), 0)
    assert.ok(!existsSync(requirementFile))
    for (const doc of docs) assert.ok(!existsSync(join(root, doc.contentPath)), `${doc.id} file remains`)
    assert.ok(!existsSync(dirname(requirementFile)), 'empty requirement directory should be pruned')
    assert.equal(workflow.listBoard().docs.length, 0)
  })

  it('refuses a requirement that still owns stories, and keeps its files', () => {
    const { handle, root } = open()
    const workflow = handle.workflow
    const requirement = workflow.createRequirement({
      workspaceId: 'ws-requirement-child',
      title: '父需求',
      summary: '父需求摘要',
    })
    const story = workflow.createStory({ requirementId: requirement.id, title: '子故事' })
    void story
    workflow.createDesignDoc({ requirementId: requirement.id, title: '还不该删的详设' })

    const preview = workflow.previewDeletions([{ kind: 'requirement', id: requirement.id }])
    assert.equal(preview.items[0]?.deletable, false)
    assert.equal(preview.items[0]?.reasonCode, 'has_children')
    assert.equal(preview.items[0]?.stories.length, 1)
    assert.equal(preview.items[0]?.docs.length, 1)
    assert.equal(preview.docCount, 0, 'a blocked requirement contributes no cascade')

    const report = workflow.deleteRecords([{ kind: 'requirement', id: requirement.id }])
    assert.equal(report.failed, 1)
    assert.equal(report.results[0]?.error?.code, 'has_children')
    assert.notEqual(workflow.getRequirement(requirement.id), null)
    assert.ok(existsSync(join(root, requirement.contentPath)))
  })
})

describe('idle status whitelist', () => {
  it('refuses a developing story, names the status and id, and writes nothing', () => {
    const { handle, root } = open()
    const workflow = handle.workflow
    const story = workflow.createStory({ workspaceId: 'ws-story', title: '正在开发', content: '# 正文' })
    const run = workflow.startStoryRun(story.id)

    const preview = workflow.previewDeletions([{ kind: 'story', id: story.id }])
    const item = preview.items[0]
    assert.equal(item?.deletable, false)
    assert.equal(item?.reasonCode, 'invalid_transition')
    assert.match(item?.reason ?? '', /developing/)
    assert.match(item?.reason ?? '', new RegExp(story.id))

    const report = workflow.deleteRecords([{ kind: 'story', id: story.id }])
    assert.equal(report.failed, 1)
    assert.equal(report.results[0]?.error?.code, 'invalid_transition')
    assert.match(report.results[0]?.error?.message ?? '', /developing/)
    assert.notEqual(workflow.getStory(story.id), null)
    assert.notEqual(workflow.getRun(run.id), null)
    assert.ok(existsSync(join(root, story.contentPath)))
  })

  it('refuses a requirement whose story is still running', () => {
    const { handle } = open()
    const workflow = handle.workflow
    const requirement = workflow.createRequirement({
      workspaceId: 'ws-review',
      title: '研发中的需求',
      summary: '研发摘要',
    })
    const story = workflow.createStory({ requirementId: requirement.id, title: '在开发的故事' })
    workflow.startStoryRun(story.id)

    const preview = workflow.previewDeletions([{ kind: 'requirement', id: requirement.id }])
    assert.equal(preview.items[0]?.deletable, false)
    assert.equal(preview.items[0]?.reasonCode, 'has_active_run')
    assert.equal(workflow.deleteRecords([{ kind: 'requirement', id: requirement.id }]).failed, 1)
    assert.notEqual(workflow.getRequirement(requirement.id), null)
  })

  it('re-checks the run table when the status still says ready', () => {
    const { handle, root } = open()
    const workflow = handle.workflow
    const story = workflow.createStory({ workspaceId: 'ws-race', title: '状态仍是 ready' })
    const now = new Date().toISOString()
    handle.db
      .prepare(
        `INSERT INTO runs
           (id, workspace_id, kind, story_id, bug_id, status, session_id, agent, branch,
            self_test_status, self_test_notes, summary, started_at, finished_at, created_at, updated_at)
         VALUES ('run_inconsistent', 'ws-race', 'story_dev', ?, NULL, 'running', NULL, 'agent', '',
                 'not_run', '', '', ?, NULL, ?, ?)`,
      )
      .run(story.id, now, now, now)

    const preview = workflow.previewDeletions([{ kind: 'story', id: story.id }])
    assert.equal(preview.items[0]?.status, 'ready')
    assert.equal(preview.items[0]?.deletable, false)
    assert.equal(preview.items[0]?.reasonCode, 'has_active_run')
    assert.equal(preview.items[0]?.activeRunId, 'run_inconsistent')

    const report = workflow.deleteRecords([{ kind: 'story', id: story.id }])
    assert.equal(report.failed, 1)
    assert.equal(count(handle, 'runs', 'story_id', story.id), 1)
    assert.notEqual(workflow.getStory(story.id), null)
    assert.ok(existsSync(join(root, story.contentPath)))
  })

  it('deletes a done story together with its run history', () => {
    const { handle, root } = open()
    const workflow = handle.workflow
    const story = workflow.createStory({ workspaceId: 'ws-done', title: '已完成的故事' })
    const run = workflow.startStoryRun(story.id)
    workflow.beginSelfTest(run.id)
    workflow.finishRun({ runId: run.id, selfTestStatus: 'passed', summary: '完成' })
    assert.equal(workflow.getStory(story.id)?.status, 'done')

    const preview = workflow.previewDeletions([{ kind: 'story', id: story.id }])
    assert.equal(preview.runCount, 1)
    assert.equal(preview.items[0]?.runCount, 1)

    const report = workflow.deleteRecords([{ kind: 'story', id: story.id }])
    assert.equal(report.succeeded, 1)
    assert.equal(report.results[0]?.removedRuns, 1)
    assert.equal(workflow.getStory(story.id), null)
    assert.equal(workflow.getRun(run.id), null)
    assert.ok(!existsSync(join(root, story.contentPath)))
  })
})

describe('batch cleanup', () => {
  it('summarises by type, skips a fixing bug and reports per-record results', () => {
    const { handle } = open()
    const workflow = handle.workflow
    const reported = workflow.createBug({ workspaceId: 'ws-batch', title: '待处理缺陷', severity: 'minor' })
    const story = workflow.createStory({ workspaceId: 'ws-batch', title: '待办故事' })
    const fixing = workflow.createBug({ workspaceId: 'ws-batch', title: '修复中的缺陷' })
    workflow.startBugFixRun(fixing.id)

    const targets = [
      { kind: 'bug', id: reported.id },
      { kind: 'story', id: story.id },
      { kind: 'bug', id: fixing.id },
    ] as const
    const preview = workflow.previewDeletions(targets)
    assert.deepEqual(preview.counts, { bug: 2, story: 1, requirement: 0, design_doc: 0 })
    assert.equal(preview.deletableCount, 2)
    assert.equal(preview.skippedCount, 1)
    assert.equal(preview.items[2]?.reasonCode, 'invalid_transition')

    const report = workflow.deleteRecords(targets)
    assert.equal(report.succeeded, 2)
    assert.equal(report.failed, 1)
    assert.equal(report.results[2]?.ok, false)
    assert.match(report.results[2]?.error?.message ?? '', new RegExp(fixing.id))
    assert.equal(workflow.getBug(reported.id), null)
    assert.equal(workflow.getStory(story.id), null)
    assert.notEqual(workflow.getBug(fixing.id), null)
  })

  it('rejects a batch that spans workspaces without deleting anything', () => {
    const { handle } = open()
    const workflow = handle.workflow
    const first = workflow.createStory({ workspaceId: 'ws-one', title: '一' })
    const second = workflow.createStory({ workspaceId: 'ws-two', title: '二' })
    rejects('invalid_input', () =>
      workflow.previewDeletions([
        { kind: 'story', id: first.id },
        { kind: 'story', id: second.id },
      ]),
    )
    rejects('invalid_input', () =>
      workflow.deleteRecords([
        { kind: 'story', id: first.id },
        { kind: 'story', id: second.id },
      ]),
    )
    assert.notEqual(workflow.getStory(first.id), null)
    assert.notEqual(workflow.getStory(second.id), null)
  })

  it('reports a missing record as not_found without touching its neighbours', () => {
    const { handle } = open()
    const workflow = handle.workflow
    const story = workflow.createStory({ workspaceId: 'ws-missing', title: '存在' })
    const report = workflow.deleteRecords([
      { kind: 'story', id: story.id },
      { kind: 'bug', id: 'bug_missing' },
    ])
    assert.equal(report.succeeded, 1)
    assert.equal(report.failed, 1)
    assert.equal(report.results[1]?.error?.code, 'not_found')
    assert.equal(workflow.getStory(story.id), null)
  })
})

describe('file failure', () => {
  // Windows 不认目录权限位：chmod 一个目录不会阻止删除其中的文件，这条用例只在 POSIX 上有意义。
  it('keeps the record when the file cannot be staged, and a retry succeeds', { skip: process.platform === 'win32' ? 'chmod does not block deletion on Windows' : false }, () => {
    const { handle, root } = open()
    const workflow = handle.workflow
    const story = workflow.createStory({ workspaceId: 'ws-file', title: '文件删不掉', content: '# 正文' })
    const file = join(root, story.contentPath)
    writeFileSync(file, '# 正文\n')
    const directory = dirname(file)
    chmodSync(directory, 0o555)
    try {
      const report = workflow.deleteRecords([{ kind: 'story', id: story.id }])
      assert.equal(report.failed, 1)
      assert.equal(report.results[0]?.error?.code, 'file_error')
      assert.notEqual(workflow.getStory(story.id), null, 'record must survive a failed file operation')
      assert.ok(existsSync(file), 'file must stay in place when the record stays')
    } finally {
      chmodSync(directory, 0o755)
    }

    const retry = workflow.deleteRecords([{ kind: 'story', id: story.id }])
    assert.equal(retry.succeeded, 1)
    assert.equal(workflow.getStory(story.id), null)
    assert.ok(!existsSync(file))
  })
})

describe('guards', () => {
  it('rejects an empty or oversized target list', () => {
    const { handle } = open()
    const workflow = handle.workflow
    rejects('invalid_input', () => workflow.previewDeletions([]))
    rejects('invalid_input', () => workflow.deleteRecords([]))
    rejects('invalid_input', () =>
      workflow.previewDeletions([
        { kind: 'story', id: 'sty_a' },
        { kind: 'story', id: 'sty_b' },
        { kind: 'story', id: 'sty_c' },
        { kind: 'story', id: 'sty_d' },
        { kind: 'story', id: 'sty_e' },
        { kind: 'story', id: 'sty_f' },
        { kind: 'story', id: 'sty_g' },
        { kind: 'story', id: 'sty_h' },
        { kind: 'story', id: 'sty_i' },
        { kind: 'story', id: 'sty_j' },
        { kind: 'story', id: 'sty_k' },
        { kind: 'story', id: 'sty_l' },
        { kind: 'story', id: 'sty_m' },
        { kind: 'story', id: 'sty_n' },
        { kind: 'story', id: 'sty_o' },
        { kind: 'story', id: 'sty_p' },
        { kind: 'story', id: 'sty_q' },
        { kind: 'story', id: 'sty_r' },
        { kind: 'story', id: 'sty_s' },
        { kind: 'story', id: 'sty_t' },
        { kind: 'story', id: 'sty_u' },
        { kind: 'story', id: 'sty_v' },
        { kind: 'story', id: 'sty_w' },
        { kind: 'story', id: 'sty_x' },
        { kind: 'story', id: 'sty_y' },
        { kind: 'story', id: 'sty_z' },
        { kind: 'story', id: 'sty_aa' },
        { kind: 'story', id: 'sty_ab' },
        { kind: 'story', id: 'sty_ac' },
        { kind: 'story', id: 'sty_ad' },
        { kind: 'story', id: 'sty_ae' },
        { kind: 'story', id: 'sty_af' },
        { kind: 'story', id: 'sty_ag' },
        { kind: 'story', id: 'sty_ah' },
        { kind: 'story', id: 'sty_ai' },
        { kind: 'story', id: 'sty_aj' },
        { kind: 'story', id: 'sty_ak' },
        { kind: 'story', id: 'sty_al' },
        { kind: 'story', id: 'sty_am' },
        { kind: 'story', id: 'sty_an' },
        { kind: 'story', id: 'sty_ao' },
        { kind: 'story', id: 'sty_ap' },
        { kind: 'story', id: 'sty_aq' },
        { kind: 'story', id: 'sty_ar' },
        { kind: 'story', id: 'sty_as' },
        { kind: 'story', id: 'sty_at' },
        { kind: 'story', id: 'sty_au' },
        { kind: 'story', id: 'sty_av' },
        { kind: 'story', id: 'sty_aw' },
        { kind: 'story', id: 'sty_ax' },
        { kind: 'story', id: 'sty_ay' },
      ]),
    )
  })
})
