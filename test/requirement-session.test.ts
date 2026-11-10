/**
 * Requirement discussion sessions: a browser prepares a pending binding when it
 * creates the conversation, the Agent confirms it with a no-argument tool, and
 * only confirmed rows reach the workbench snapshot. These tests use a real
 * SQLite file so the migration, the pending state and the FK cascade are all
 * exercised.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, it } from 'node:test'

import { Context } from '@deepseek-ai/cordis'

import {
  DETAIL_DISCUSSION_PRESET,
  REQUIREMENT_DISCUSSION_PRESET,
  STORY_SPLIT_PRESET,
  buildRequirementDiscussionPrompt,
  presetForRequirementDiscussion,
} from '../src/requirement-discussion.ts'
import { readDesignDoc } from '../src/tools/get-design-doc.ts'
import { getRequirementTool } from '../src/tools/get-requirement.ts'
import type { ToolEnvironment } from '../src/tools/shared.ts'
import { WorkbenchService } from '../src/remote/service.ts'
import { openTeamflowDatabase, type TeamflowDatabase } from '../src/store/db.ts'
import { WorkflowError } from '../src/store/model.ts'

const directories: string[] = []
const handles: TeamflowDatabase[] = []

function open(): TeamflowDatabase {
  const dataDir = mkdtempSync(join(tmpdir(), 'teamflow-requirement-session-'))
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

/** One confirmed requirement. */
function seeded(handle: TeamflowDatabase): { readonly requirementId: string } {
  const requirement = handle.workflow.createRequirement({
    workspaceId: 'ws-requirement',
    title: '暂停能力',
    summary: '暂停并恢复计时',
    content: '# 暂停\n\n点击暂停后停止计时。',
  })
  return { requirementId: requirement.id }
}

describe('requirement session binding', () => {
  it('keeps a prepared session out of the board until the Agent confirms it', () => {
    const handle = open()
    const { requirementId } = seeded(handle)
    const prepared = handle.workflow.prepareRequirementSession(requirementId, 'session-design')
    assert.equal(prepared.linkedAt, null)
    assert.equal(prepared.kind, 'design')
    assert.equal(handle.workflow.getRequirementSession('session-design')?.requirementId, requirementId)
    assert.deepEqual(handle.workflow.listRequirementSessions(requirementId), [])
    assert.deepEqual(handle.workflow.listRequirementSessions(requirementId, { includePending: true }), [prepared])
    assert.deepEqual(handle.workflow.listBoard().requirementSessions, [])

    const linked = handle.workflow.linkRequirementSession('session-design')
    assert.notEqual(linked.linkedAt, null)
    assert.equal(handle.workflow.getRequirementSession('session-design')?.linkedAt, linked.linkedAt)
    assert.deepEqual(handle.workflow.listRequirementSessions(requirementId), [linked])
    assert.deepEqual(
      handle.workflow.listBoard().requirementSessions.map((session) => session.sessionId),
      ['session-design'],
    )
  })

  it('keeps outline and detailed-design discussions apart', () => {
    const handle = open()
    const { requirementId } = seeded(handle)

    const detail = handle.workflow.prepareRequirementSession(requirementId, 'session-detail', 'detail')
    assert.equal(detail.kind, 'detail')
    const linked = handle.workflow.linkRequirementSession('session-detail')
    assert.equal(linked.kind, 'detail')
    assert.notEqual(linked.linkedAt, null)

    const design = handle.workflow.prepareRequirementSession(requirementId, 'session-outline')
    assert.equal(design.kind, 'design')
    handle.workflow.linkRequirementSession('session-outline')
    assert.deepEqual(
      handle.workflow.listRequirementSessions(requirementId).map((session) => session.kind),
      ['design', 'detail'],
    )

    rejects('invalid_input', () =>
      handle.workflow.prepareRequirementSession(requirementId, 'session-detail', 'design'),
    )
    rejects('invalid_input', () =>
      handle.workflow.prepareRequirementSession(requirementId, 'session-bad', 'create'),
    )
  })

  it('records a story-splitting discussion without mixing it with design ones', () => {
    const handle = open()
    const { requirementId } = seeded(handle)

    const split = handle.workflow.prepareRequirementSession(requirementId, 'session-split', 'split')
    assert.equal(split.kind, 'split')
    assert.equal(split.linkedAt, null)
    const linked = handle.workflow.linkRequirementSession('session-split')
    assert.equal(linked.kind, 'split')
    assert.notEqual(linked.linkedAt, null)
    assert.deepEqual(
      handle.workflow.listRequirementSessions(requirementId).map((session) => session.kind),
      ['split'],
    )
  })

  it('is idempotent and refuses to move one session to another requirement', () => {
    const handle = open()
    const { requirementId } = seeded(handle)
    const prepared = handle.workflow.prepareRequirementSession(requirementId, 'session-once')
    assert.equal(
      handle.workflow.prepareRequirementSession(requirementId, 'session-once').preparedAt,
      prepared.preparedAt,
    )
    const linked = handle.workflow.linkRequirementSession('session-once')
    assert.equal(handle.workflow.linkRequirementSession('session-once').linkedAt, linked.linkedAt)

    const other = handle.workflow.createRequirement({
      workspaceId: 'ws-requirement',
      title: '另一个需求',
      summary: '另一个需求的摘要',
    })
    rejects('invalid_input', () => handle.workflow.prepareRequirementSession(other.id, 'session-once'))
  })

  it('does not turn a creation session into a discussion session', () => {
    const handle = open()
    const created = handle.workflow.createRequirement({
      workspaceId: 'ws-requirement',
      title: '创建会话',
      summary: '创建时绑定的会话',
      sessionId: 'session-create',
    })
    assert.equal(handle.workflow.getRequirementSession('session-create')?.kind, 'create')
    rejects('invalid_input', () => handle.workflow.prepareRequirementSession(created.id, 'session-create'))
    rejects('invalid_input', () => handle.workflow.linkRequirementSession('session-create'))
  })

  it('reports a missing binding with an actionable error', () => {
    const handle = open()
    rejects('not_found', () => handle.workflow.linkRequirementSession('session-unknown'))
    assert.equal(handle.workflow.getRequirementSession('session-unknown'), null)
  })
})

describe('requirement session remote method', () => {
  it('prepares the binding and exposes only confirmed sessions in the snapshot', () => {
    const handle = open()
    const { requirementId } = seeded(handle)
    const service = new WorkbenchService(new Context(), handle.workflow)

    const reply = service.prepareRequirementSession(requirementId, ' session-remote ')
    assert.equal(reply.requirementId, requirementId)
    assert.equal(reply.sessionId, 'session-remote')
    assert.equal(reply.kind, 'design')
    assert.equal(reply.linkedAt, null)
    assert.deepEqual(service.snapshot().requirementSessions, [])

    handle.workflow.linkRequirementSession('session-remote')
    const snapshot = service.snapshot()
    assert.deepEqual(snapshot.requirementSessions, [
      {
        requirementId,
        sessionId: 'session-remote',
        kind: 'design',
        preparedAt: handle.workflow.getRequirementSession('session-remote')?.preparedAt,
        linkedAt: handle.workflow.getRequirementSession('session-remote')?.linkedAt,
        createdAt: handle.workflow.getRequirementSession('session-remote')?.createdAt,
      },
    ])
    assert.equal(snapshot.requirements[0]?.body.trim(), '# 暂停\n\n点击暂停后停止计时。')
    assert.equal(snapshot.requirements[0]?.status, 'draft')
  })

  it('rejects blank ids before touching the store', () => {
    const handle = open()
    const service = new WorkbenchService(new Context(), handle.workflow)
    rejects('invalid_input', () => service.prepareRequirementSession('   ', 'session-1'))
    rejects('invalid_input', () => service.prepareRequirementSession('req_1', '   '))
  })
})

describe('requirement discussion prompt', () => {
  it('keeps only the title and the supplement slot in the design prefill', () => {
    const prompt = buildRequirementDiscussionPrompt()
    assert.equal(REQUIREMENT_DISCUSSION_PRESET, 'xirang-requirement')
    assert.equal(prompt, ['【继续讨论需求与概要设计】', '', '我的补充：'].join('\n'))
    assert.doesNotMatch(prompt, /teamflow_/)
    assert.doesNotMatch(prompt, /工具|调用|确认|评审|定稿/)
    assert.doesNotMatch(prompt, /req_/)
    assert.doesNotMatch(prompt, /暂停后停止计时/)
  })

  it('gives each discussion kind its own preset so the picker names the real job', () => {
    assert.equal(presetForRequirementDiscussion('design'), 'xirang-requirement')
    assert.equal(presetForRequirementDiscussion('detail'), 'xirang-detail')
    assert.equal(presetForRequirementDiscussion('split'), 'xirang-story')
    assert.equal(DETAIL_DISCUSSION_PRESET, 'xirang-detail')
    assert.equal(STORY_SPLIT_PRESET, 'xirang-story')
    assert.notEqual(REQUIREMENT_DISCUSSION_PRESET, DETAIL_DISCUSSION_PRESET)
  })

  it('keeps only the title and the supplement slot in the detailed-design prefill', () => {
    const prompt = buildRequirementDiscussionPrompt('detail')
    assert.equal(prompt, ['【继续讨论详细设计】', '', '我的补充：'].join('\n'))
    assert.doesNotMatch(prompt, /teamflow_/)
    assert.doesNotMatch(prompt, /概要设计/)
    assert.doesNotMatch(prompt, /不要猜文档 id/)
    assert.doesNotMatch(prompt, /req_/)
  })

  it('keeps only the title and the supplement slot in the story-splitting prefill', () => {
    const prompt = buildRequirementDiscussionPrompt('split')
    assert.equal(prompt, ['【继续讨论故事拆分】', '', '我的补充：'].join('\n'))
    assert.doesNotMatch(prompt, /teamflow_/)
    assert.doesNotMatch(prompt, /概要设计|详细设计/)
    assert.doesNotMatch(prompt, /确认/)
    assert.doesNotMatch(prompt, /req_/)
  })
})

describe('detailed-design reading', () => {
  it('returns the document metadata and Markdown body by id', () => {
    const handle = open()
    const { requirementId } = seeded(handle)
    const doc = handle.workflow.createDesignDoc({
      requirementId,
      title: '暂停状态机',
      content: '# 状态机\n\n运行 → 暂停 → 运行。',
    })
    const detail = readDesignDoc(handle.workflow, ` ${doc.id} `)
    assert.equal(detail.id, doc.id)
    assert.equal(detail.requirementId, requirementId)
    assert.equal(detail.title, '暂停状态机')
    assert.equal(detail.kind, 'flow')
    assert.equal(detail.contentPath, doc.contentPath)
    assert.match(detail.body, /运行 → 暂停 → 运行/)
  })

  it('rejects blank and unknown document ids with a contextual error', () => {
    const handle = open()
    assert.throws(() => readDesignDoc(handle.workflow, '   '), /id 不能为空/)
    assert.throws(() => readDesignDoc(handle.workflow, 'doc_missing'), /不存在/)
  })

  it('lists document ids and titles in the requirement rendering', () => {
    const handle = open()
    const { requirementId } = seeded(handle)
    const doc = handle.workflow.createDesignDoc({
      requirementId,
      title: '暂停状态机',
      content: '# 状态机',
    })
    const requirement = handle.workflow.getRequirement(requirementId)
    assert.ok(requirement !== null)
    const environment: ToolEnvironment = {
      database: handle,
      workspaces: () => [],
      resolveWorkspace: () => {
        throw new Error('unused')
      },
      touch: () => {},
    }
    const tool = getRequirementTool(environment)
    const blocks = tool.output.render({}, {
      requirementId: requirement.id,
      title: requirement.title,
      summary: requirement.summary,
      status: requirement.status,
      workspaceId: requirement.workspaceId,
      contentPath: requirement.contentPath,
      body: '# 暂停',
      stories: [],
      docs: [
        {
          id: doc.id,
          title: doc.title,
          kind: doc.kind,
          sortOrder: doc.sortOrder,
          path: doc.contentPath,
        },
      ],
    })
    const text = blocks.map((block) => ('text' in block ? block.text : '')).join('\n')
    assert.match(text, new RegExp(doc.id))
    assert.match(text, /《暂停状态机》/)
    assert.match(text, /详设文档：1 份/)
  })
})
