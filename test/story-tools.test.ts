/**
 * Story tools: reading a story with its design coverage, revising it under the
 * state machine, and deleting it through the shared preview/delete path. These
 * run against a real SQLite file and real Markdown files in a temporary
 * workspace, so the body read back after an update is the one on disk.
 */
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, it } from 'node:test'

import { Context } from '@deepseek-ai/cordis'

import { deleteStory } from '../src/tools/delete-story.ts'
import { readStory } from '../src/tools/get-story.ts'
import { PROFILE_TOOL_NAMES, TOOL_NAMES, apply } from '../src/tools/index.ts'
import { updateStoryRecord } from '../src/tools/update-story.ts'
import { openTeamflowDatabase, type TeamflowDatabase } from '../src/store/db.ts'
import { WorkflowError } from '../src/store/model.ts'

interface Fixture {
  readonly handle: TeamflowDatabase
  readonly root: string
}

const directories: string[] = []
const handles: TeamflowDatabase[] = []

function open(): Fixture {
  const dataDir = mkdtempSync(join(tmpdir(), 'teamflow-story-tools-'))
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

describe('story tool registration', () => {
  it('is opt-in through the story preset, not the shared collection', () => {
    assert.ok(TOOL_NAMES.includes('teamflow_get_story'))
    assert.ok(TOOL_NAMES.includes('teamflow_update_story'))
    assert.ok(TOOL_NAMES.includes('teamflow_delete_story'))
    const patch = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
    assert.match(patch, /id: xirang-story/)
    assert.match(patch, /profile: split/)
    assert.match(patch, /teamflow_delete_story/)
  })

  it('registers the three Story tools only under the split profile', () => {
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
    apply(ctx, { profile: 'split' })
    assert.deepEqual([...registered].sort(), [...PROFILE_TOOL_NAMES.split].sort())

    const plain: string[] = []
    const plainCtx = new Context()
    Object.defineProperty(plainCtx, 'tools', {
      value: {
        register: (definition: { readonly name: string }) => {
          plain.push(definition.name)
        },
      },
      configurable: true,
    })
    apply(plainCtx, { profile: 'requirement' })
    assert.ok(!plain.includes('teamflow_get_story'))
    assert.ok(!plain.includes('teamflow_update_story'))
    assert.ok(!plain.includes('teamflow_delete_story'))
  })
})

describe('reading a story', () => {
  it('returns the body, parent requirement and design coverage', () => {
    const { handle } = open()
    const workflow = handle.workflow
    const requirement = workflow.createRequirement({
      workspaceId: 'ws-story-read',
      title: '暂停能力',
      summary: '暂停并恢复计时',
    })
    const story = workflow.createStory({
      requirementId: requirement.id,
      title: '暂停按钮',
      content: '# 暂停按钮\n\n验收：点击后计时停止。',
      size: 'm',
    })
    const covered = workflow.createDesignDoc({
      requirementId: requirement.id,
      title: '暂停交互详设',
      content: '# 交互\n\n点击暂停。',
    })
    const other = workflow.createDesignDoc({
      requirementId: requirement.id,
      title: '恢复交互详设',
      content: '# 交互\n\n点击恢复。',
    })
    workflow.linkDocStory(covered.id, story.id)

    const detail = readStory(workflow, ` ${story.id} `)
    assert.equal(detail.id, story.id)
    assert.equal(detail.status, 'ready')
    assert.equal(detail.size, 'm')
    assert.equal(detail.requirementId, requirement.id)
    assert.equal(detail.requirementTitle, '暂停能力')
    assert.equal(detail.requirementStatus, 'draft')
    assert.match(detail.body, /点击后计时停止/)
    assert.deepEqual(
      detail.designDocs.map((doc) => [doc.id, doc.coversStory]),
      [
        [covered.id, true],
        [other.id, false],
      ],
    )
  })

  it('describes a standalone story without inventing a parent', () => {
    const { handle } = open()
    const story = handle.workflow.createStory({ workspaceId: 'ws-standalone', title: '独立故事' })
    const detail = readStory(handle.workflow, story.id)
    assert.equal(detail.requirementId, '')
    assert.equal(detail.requirementTitle, '')
    assert.equal(detail.requirementStatus, '')
    assert.deepEqual(detail.designDocs, [])
    assert.equal(detail.body, '')
  })

  it('rejects blank and unknown ids with a contextual error', () => {
    const { handle } = open()
    assert.throws(() => readStory(handle.workflow, '   '), /id 不能为空/)
    assert.throws(() => readStory(handle.workflow, 'story_missing'), /不存在/)
  })
})

describe('updating a story', () => {
  it('writes the new title, body and size to the row and story.md', () => {
    const { handle, root } = open()
    const workflow = handle.workflow
    const story = workflow.createStory({
      workspaceId: 'ws-story-update',
      title: '旧标题',
      content: '# 旧正文',
      size: 'xs',
    })

    const updated = updateStoryRecord(workflow, story.id, {
      title: '新标题',
      content: '# 新正文\n\n验收：保存后可读回。',
      size: 'l',
    })
    assert.equal(updated.title, '新标题')
    assert.equal(updated.size, 'l')
    assert.equal(updated.status, 'ready')
    assert.equal(readStory(workflow, story.id).body.trim(), '# 新正文\n\n验收：保存后可读回。')
    assert.match(readFileSync(join(root, story.contentPath), 'utf8'), /保存后可读回/)
  })

  it('requires at least one field and a non-blank title', () => {
    const { handle } = open()
    const story = handle.workflow.createStory({ workspaceId: 'ws-story-noop', title: '保持' })
    assert.throws(() => updateStoryRecord(handle.workflow, story.id, {}), /至少提供/)
    assert.throws(() => updateStoryRecord(handle.workflow, story.id, { title: '   ' }), /标题不能为空/)
    assert.throws(() => updateStoryRecord(handle.workflow, '   ', { title: 'x' }), /id 不能为空/)
  })

  it('refuses a story that already entered development', () => {
    const { handle } = open()
    const story = handle.workflow.createStory({ workspaceId: 'ws-story-busy', title: '开发中' })
    handle.workflow.startStoryRun(story.id)
    rejects('invalid_transition', () =>
      updateStoryRecord(handle.workflow, story.id, { title: '改不了' }),
    )
    assert.equal(handle.workflow.getStory(story.id)?.title, '开发中')
  })
})

describe('deleting a story', () => {
  it('removes the row, story.md and cancelled run history', () => {
    const { handle, root } = open()
    const workflow = handle.workflow
    const story = workflow.createStory({
      workspaceId: 'ws-story-delete',
      title: '待删故事',
      content: '# 待删',
    })
    const run = workflow.startStoryRun(story.id)
    workflow.cancelRun(run.id)

    const deleted = deleteStory(workflow, story.id)
    assert.equal(deleted.id, story.id)
    assert.equal(deleted.title, '待删故事')
    assert.equal(deleted.removedRuns, 1)
    assert.equal(workflow.getStory(story.id), null)
    assert.equal(workflow.getRun(run.id), null)
    assert.equal(existsSync(join(root, story.contentPath)), false)
  })

  it('refuses a story that is still being developed', () => {
    const { handle } = open()
    const story = handle.workflow.createStory({ workspaceId: 'ws-story-active', title: '研发中' })
    handle.workflow.startStoryRun(story.id)
    assert.throws(() => deleteStory(handle.workflow, story.id), /当前状态是 developing/)
    assert.notEqual(handle.workflow.getStory(story.id), null)
  })

  it('rejects blank and unknown ids', () => {
    const { handle } = open()
    assert.throws(() => deleteStory(handle.workflow, '   '), /id 不能为空/)
    assert.throws(() => deleteStory(handle.workflow, 'story_missing'), /不存在/)
  })
})
