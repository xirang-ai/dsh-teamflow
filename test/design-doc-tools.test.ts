/**
 * Detailed-design tools: deleting one document through the shared
 * preview/delete path, together with its Markdown body and coverage links, and
 * refusing while a covered story is executing. Everything runs against a real
 * SQLite file and real Markdown files in a temporary workspace.
 */
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, it } from 'node:test'

import { Context } from '@deepseek-ai/cordis'

import { deleteDesignDoc } from '../src/tools/delete-design-doc.ts'
import { PROFILE_TOOL_NAMES, TOOL_NAMES, apply } from '../src/tools/index.ts'
import { openTeamflowDatabase, type TeamflowDatabase } from '../src/store/db.ts'

interface Fixture {
  readonly handle: TeamflowDatabase
  readonly root: string
}

const directories: string[] = []
const handles: TeamflowDatabase[] = []

function open(): Fixture {
  const dataDir = mkdtempSync(join(tmpdir(), 'teamflow-design-doc-tools-'))
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

function count(handle: TeamflowDatabase, table: string, column: string, id: string): number {
  const row = handle.db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column} = ?`).get(id)
  return Number(row?.['n'] ?? 0)
}

describe('detailed-design deletion registration', () => {
  it('is part of the collection and the detail preset, not the other stages', () => {
    assert.ok(TOOL_NAMES.includes('teamflow_delete_design_doc'))
    assert.ok(PROFILE_TOOL_NAMES.detail.includes('teamflow_delete_design_doc'))
    assert.ok(!PROFILE_TOOL_NAMES.requirement.includes('teamflow_delete_design_doc'))
    assert.ok(!PROFILE_TOOL_NAMES.split.includes('teamflow_delete_design_doc'))
    assert.ok(!PROFILE_TOOL_NAMES.dev.includes('teamflow_delete_design_doc'))
  })

  it('registers exactly the detail profile under the detail row', () => {
    const registered: string[] = []
    const ctx = new Context()
    Object.defineProperty(ctx, 'tools', {
      value: {
        register: (definition: { readonly name: string }) => {
          registered.push(definition.name)
        },
      },
      configurable: true,
    })
    apply(ctx, { profile: 'detail' })
    assert.deepEqual([...registered].sort(), [...PROFILE_TOOL_NAMES.detail].sort())
  })
})

describe('deleting a detailed design', () => {
  it('removes the row, its Markdown body and every story coverage link', () => {
    const { handle, root } = open()
    const workflow = handle.workflow
    const requirement = workflow.createRequirement({
      workspaceId: 'ws-doc-delete',
      title: '待重写需求',
      summary: '旧文档要删掉',
    })
    const story = workflow.createStory({ requirementId: requirement.id, title: '覆盖它的故事' })
    const doc = workflow.createDesignDoc({
      requirementId: requirement.id,
      title: '旧流程',
      kind: 'flow',
      content: '# 旧流程',
      storyIds: [story.id],
    })
    assert.ok(existsSync(join(root, doc.contentPath)))
    assert.equal(count(handle, 'design_doc_stories', 'doc_id', doc.id), 1)

    const deleted = deleteDesignDoc(workflow, `  ${doc.id}  `)
    assert.equal(deleted.id, doc.id)
    assert.equal(deleted.requirementId, requirement.id)
    assert.equal(deleted.title, '旧流程')
    assert.equal(deleted.kind, 'flow')
    assert.equal(deleted.removedLinks, 1)
    assert.equal(workflow.getDesignDoc(doc.id), null)
    assert.equal(count(handle, 'design_doc_stories', 'doc_id', doc.id), 0)
    assert.equal(existsSync(join(root, doc.contentPath)), false)
    assert.notEqual(workflow.getRequirement(requirement.id), null)
    assert.notEqual(workflow.getStory(story.id), null)
  })

  it('allows a document whose covered story is finished', () => {
    const { handle } = open()
    const workflow = handle.workflow
    const requirement = workflow.createRequirement({
      workspaceId: 'ws-doc-done',
      title: '已完成需求',
      summary: '删旧建新',
    })
    const story = workflow.createStory({ requirementId: requirement.id, title: '已完成的故事' })
    const run = workflow.startStoryRun(story.id)
    workflow.beginSelfTest(run.id)
    workflow.finishRun({ runId: run.id, selfTestStatus: 'passed', summary: '完成' })
    const doc = workflow.createDesignDoc({
      requirementId: requirement.id,
      title: '已完成的详设',
      storyIds: [story.id],
    })

    const deleted = deleteDesignDoc(workflow, doc.id)
    assert.equal(deleted.removedLinks, 1)
    assert.equal(workflow.getDesignDoc(doc.id), null)
    assert.notEqual(workflow.getStory(story.id), null)
  })

  it('refuses a document covered by a story that is still developing', () => {
    const { handle, root } = open()
    const workflow = handle.workflow
    const requirement = workflow.createRequirement({
      workspaceId: 'ws-doc-busy',
      title: '研发中需求',
      summary: '不能删依据',
    })
    const story = workflow.createStory({ requirementId: requirement.id, title: '正在开发的故事' })
    workflow.startStoryRun(story.id)
    const doc = workflow.createDesignDoc({
      requirementId: requirement.id,
      title: '研发依据',
      storyIds: [story.id],
    })

    assert.throws(
      () => deleteDesignDoc(workflow, doc.id),
      /覆盖它的故事仍有研发运行 run_[\w-]+ 尚未结束；请先取消该运行再删除/,
    )
    assert.notEqual(workflow.getDesignDoc(doc.id), null)
    assert.equal(count(handle, 'design_doc_stories', 'doc_id', doc.id), 1)
    assert.ok(existsSync(join(root, doc.contentPath)))
  })

  it('refuses a document covered by a story whose status says developing', () => {
    const { handle } = open()
    const workflow = handle.workflow
    const requirement = workflow.createRequirement({
      workspaceId: 'ws-doc-status',
      title: '状态不一致需求',
      summary: '故事状态领先于运行表',
    })
    const story = workflow.createStory({ requirementId: requirement.id, title: '状态是 developing' })
    const doc = workflow.createDesignDoc({
      requirementId: requirement.id,
      title: '状态依据',
      storyIds: [story.id],
    })
    handle.db.prepare("UPDATE stories SET status = 'developing' WHERE id = ?").run(story.id)

    assert.throws(
      () => deleteDesignDoc(workflow, doc.id),
      /覆盖它的故事正在执行（developing \/ self_testing）；只有覆盖故事都空闲时才能删除详设/,
    )
    assert.notEqual(workflow.getDesignDoc(doc.id), null)
  })

  it('rejects blank and unknown ids', () => {
    const { handle } = open()
    assert.throws(() => deleteDesignDoc(handle.workflow, '   '), /id 不能为空/)
    assert.throws(() => deleteDesignDoc(handle.workflow, 'designDoc_missing'), /不存在/)
  })
})
