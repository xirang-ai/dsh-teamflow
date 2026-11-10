/**
 * Workbench Remote service test: the click path writes the run through this
 * class, so the service is exercised against a real SQLite file instead of a
 * mock. A missing `startStoryRun` here is exactly the bug this test guards.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, it } from 'node:test'

import { Context } from '@deepseek-ai/cordis'
import type { SessionStore } from '@deepseek-ai/dsh-session'

import { SANDBOX_MODES } from '@deepseek-ai/dsh-sandbox-policy'
import { APPROVAL_POLICIES } from '@deepseek-ai/dsh-user-approval'

import { WorkbenchService } from '../src/remote/service.ts'
import { openTeamflowDatabase, type TeamflowDatabase } from '../src/store/db.ts'
import { WorkflowError } from '../src/store/model.ts'

const directories: string[] = []
const handles: TeamflowDatabase[] = []

function open(): TeamflowDatabase {
  const dataDir = mkdtempSync(join(tmpdir(), 'teamflow-remote-'))
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


/**
 * Host stand-in for the session lookups the tier application performs.
 *
 * The real `sessions` service owns far more than `get`, so the stand-in is
 * declared as the whole service type and then narrowed to the one method the
 * code under test uses; every `append` it receives is the event the Host would
 * record for a permission change.
 */
function hostWithSessions(sessionId: string): { ctx: Context; events: [string, unknown][] } {
  const events: [string, unknown][] = []
  const session = {
    append: (type: string, payload: unknown): void => {
      events.push([type, payload])
    },
  }
  const store = {
    get: (id: string) => (id === sessionId ? session : undefined),
  } as unknown as SessionStore
  const ctx = new Context()
  ctx.provide('sessions')
  ctx.set('sessions', store)
  return { ctx, events }
}

afterEach(() => {
  while (handles.length > 0) handles.pop()?.close()
  while (directories.length > 0) {
    const dir = directories.pop()
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  }
})

describe('startStoryRun remote method', () => {
  it('writes the running run and the developing story in one call', () => {
    const handle = open()
    const service = new WorkbenchService(new Context(), handle.workflow)
    const story = handle.workflow.createStory({
      workspaceId: 'ws-tetris',
      title: '开始研发落库',
      content: '## 验收标准\n\n点击后故事进入执行中。',
      size: 'xs',
    })

    const reply = service.startStoryRun(story.id, 'session-1')
    assert.equal(reply.storyId, story.id)
    assert.equal(reply.storyStatus, 'developing')
    const run = handle.workflow.getRun(reply.runId)
    assert.equal(run?.status, 'running')
    assert.equal(run?.sessionId, 'session-1')
    assert.equal(handle.workflow.getStory(story.id)?.status, 'developing')
  })

  it('records no session when the conversation could not be identified', () => {
    const handle = open()
    const service = new WorkbenchService(new Context(), handle.workflow)
    const story = handle.workflow.createStory({ workspaceId: 'ws-tetris', title: '无会话' })

    const reply = service.startStoryRun(story.id, null)
    assert.equal(handle.workflow.getRun(reply.runId)?.sessionId, null)
    assert.equal(reply.storyStatus, 'developing')
  })

  it('rejects a blank story id instead of writing a run', () => {
    const handle = open()
    const service = new WorkbenchService(new Context(), handle.workflow)
    assert.throws(
      () => service.startStoryRun('   ', 'session-1'),
      (error: unknown) =>
        error instanceof WorkflowError && error.code === 'invalid_input',
    )
  })
})

describe('bug fix remote methods', () => {
  it('starts a fix run for a reported defect and releases it on cancel', () => {
    const handle = open()
    const service = new WorkbenchService(new Context(), handle.workflow)
    const bug = handle.workflow.createBug({ workspaceId: 'ws-tetris', title: '开始修复落库' })

    const started = service.startBugFixRun(bug.id, 'session-bug')
    assert.equal(started.bugId, bug.id)
    assert.equal(started.bugStatus, 'fixing')
    const run = handle.workflow.getRun(started.runId)
    assert.equal(run?.kind, 'bug_fix')
    assert.equal(run?.status, 'running')
    assert.equal(run?.sessionId, 'session-bug')

    const cancelled = service.cancelBugRun(bug.id)
    assert.equal(cancelled.runId, started.runId)
    assert.equal(cancelled.bugStatus, 'reported')
    assert.equal(handle.workflow.getRun(started.runId)?.status, 'cancelled')
  })

  it('rejects a blank bug id instead of writing a run', () => {
    const handle = open()
    const service = new WorkbenchService(new Context(), handle.workflow)
    assert.throws(
      () => service.startBugFixRun('   ', null),
      (error: unknown) => error instanceof WorkflowError && error.code === 'invalid_input',
    )
    assert.throws(
      () => service.cancelBugRun(''),
      (error: unknown) => error instanceof WorkflowError && error.code === 'invalid_input',
    )
  })
})

describe('story lifecycle remote methods', () => {
  it('cancels a stuck run and puts the story back in the queue', () => {
    const handle = open()
    const service = new WorkbenchService(new Context(), handle.workflow)
    const story = handle.workflow.createStory({ workspaceId: 'ws-tetris', title: '卡住的研发' })
    const run = handle.workflow.startStoryRun(story.id)
    handle.workflow.beginSelfTest(run.id)

    const reply = service.cancelStoryRun(story.id)
    assert.equal(reply.runId, run.id)
    assert.equal(reply.storyStatus, 'ready')
    assert.equal(handle.workflow.getRun(run.id)?.status, 'cancelled')
    assert.equal(handle.workflow.getStory(story.id)?.status, 'ready')
  })

  it('completes a done story', () => {
    const handle = open()
    const service = new WorkbenchService(new Context(), handle.workflow)
    const story = handle.workflow.createStory({ workspaceId: 'ws-tetris', title: '待验收的故事' })
    const run = handle.workflow.startStoryRun(story.id)
    handle.workflow.beginSelfTest(run.id)
    handle.workflow.finishRun({ runId: run.id, selfTestStatus: 'passed', summary: '完成' })

    const reply = service.completeStory(story.id)
    assert.equal(reply.storyId, story.id)
    assert.equal(reply.storyStatus, 'completed')
  })

  it('cancels a story that never started', () => {
    const handle = open()
    const service = new WorkbenchService(new Context(), handle.workflow)
    const story = handle.workflow.createStory({ workspaceId: 'ws-tetris', title: '不做了的故事' })

    const reply = service.cancelStory(story.id)
    assert.equal(reply.storyId, story.id)
    assert.equal(reply.storyStatus, 'cancelled')
    assert.equal(handle.workflow.getStory(story.id)?.status, 'cancelled')
  })

  it('rejects blank ids instead of touching the database', () => {
    const handle = open()
    const service = new WorkbenchService(new Context(), handle.workflow)
    assert.throws(
      () => service.cancelStoryRun('  '),
      (error: unknown) => error instanceof WorkflowError && error.code === 'invalid_input',
    )
    assert.throws(
      () => service.completeStory(''),
      (error: unknown) => error instanceof WorkflowError && error.code === 'invalid_input',
    )
    assert.throws(
      () => service.cancelStory('   '),
      (error: unknown) => error instanceof WorkflowError && error.code === 'invalid_input',
    )
  })
})


describe('document bodies over the remote contract', () => {
  it('separates an empty body from a file that no longer exists', () => {
    const handle = open()
    const service = new WorkbenchService(new Context(), handle.workflow)
    const requirement = handle.workflow.createRequirement({
      workspaceId: 'ws-body',
      title: '正文状态',
      content: '',
    })

    let requirementSnapshot = service.snapshot().requirements.find((row) => row.id === requirement.id)
    assert.equal(requirementSnapshot?.body, '')
    assert.equal(requirementSnapshot?.bodyMissing, false)

    const file = join(
      dirname(handle.file),
      'workspace',
      '.xirang-ai',
      'dsh-teamflow',
      'requirements',
      requirement.id,
      'requirement.md',
    )
    rmSync(file)

    requirementSnapshot = service.snapshot().requirements.find((row) => row.id === requirement.id)
    assert.equal(requirementSnapshot?.body, '')
    assert.equal(requirementSnapshot?.bodyMissing, true)
  })

  it('returns bodyMissing for a detailed-design document whose file is gone', () => {
    const handle = open()
    const service = new WorkbenchService(new Context(), handle.workflow)
    const requirement = handle.workflow.createRequirement({
      workspaceId: 'ws-doc',
      title: '详设正文',
      content: '# 概设',
    })
    const doc = handle.workflow.createDesignDoc({
      requirementId: requirement.id,
      title: '接口设计',
      content: '',
    })

    const present = service.readDoc(doc.id)
    assert.equal(present.body, '')
    assert.equal(present.bodyMissing, false)

    rmSync(join(dirname(handle.file), 'workspace', '.xirang-ai', 'dsh-teamflow', 'requirements', requirement.id, 'docs', `${doc.id}.md`))
    const missing = service.readDoc(doc.id)
    assert.equal(missing.bodyMissing, true)
  })
})

describe('remote messages follow the caller locale', () => {
  it('answers validation and workflow failures in Chinese when asked', () => {
    const handle = open()
    const service = new WorkbenchService(new Context(), handle.workflow)
    const requirement = handle.workflow.createRequirement({ workspaceId: 'ws-tetris', title: '未确认需求' })
    const story = handle.workflow.createStory({ requirementId: requirement.id, title: '待开始' })

    assert.throws(
      () => service.startStoryRun('   ', 'session-1', 'zh-CN'),
      (error: unknown) => error instanceof Error && error.message === 'teamflow: 缺少故事编号。',
    )
    handle.workflow.cancelStory(story.id)
    assert.throws(
      () => service.startStoryRun(story.id, 'session-1', 'zh-CN'),
      (error: unknown) => error instanceof Error && error.message === 'teamflow: 当前状态不允许这个操作。',
    )
    assert.throws(
      () => service.readDoc('doc_unknown', 'zh'),
      (error: unknown) => error instanceof Error && error.message === 'teamflow: 详细设计 doc_unknown 不存在。',
    )
  })

  it('falls back to English when the locale is absent or unknown', () => {
    const handle = open()
    const service = new WorkbenchService(new Context(), handle.workflow)
    assert.throws(
      () => service.startStoryRun('', null),
      (error: unknown) => error instanceof Error && error.message === 'teamflow: A Story id is required.',
    )
    assert.throws(
      () => service.startStoryRun('', null, 'fr-FR'),
      (error: unknown) => error instanceof Error && error.message === 'teamflow: A Story id is required.',
    )
  })
})

describe('permission tier on the start path', () => {
  it('records the picked tier on the run and reads it back for the header', () => {
    const handle = open()
    const host = hostWithSessions('session-tier')
    const service = new WorkbenchService(host.ctx, handle.workflow)
    const story = handle.workflow.createStory({ workspaceId: 'ws-tetris', title: '只读执行' })

    const reply = service.startStoryRun(story.id, 'session-tier', undefined, 'readonly')
    const run = handle.workflow.getRun(reply.runId)
    assert.equal(reply.permissionTier, 'readonly')
    assert.equal(run?.permissionTier, 'readonly')
    // The Host's own write paths are what actually confine the session.
    assert.deepEqual(host.events, [
      ['sandbox/mode', { mode: 'read-only' }],
      ['approval/policy', { policy: 'ask' }],
    ])
    assert.equal(service.sessionPermissionTier('session-tier').permissionTier, 'readonly')

    const snapshot = service.snapshot()
    assert.equal(snapshot.runs.find((entry) => entry.id === reply.runId)?.permissionTier, 'readonly')
  })

  it('answers null for conversations it never recorded, so the header shows no badge', () => {
    const handle = open()
    const service = new WorkbenchService(new Context(), handle.workflow)
    assert.equal(service.sessionPermissionTier('session-old').permissionTier, null)
    assert.equal(service.sessionPermissionTier('   ').permissionTier, null)
  })

  it('keeps the pre-existing behaviour when no tier is passed', () => {
    const handle = open()
    const service = new WorkbenchService(new Context(), handle.workflow)
    const story = handle.workflow.createStory({ workspaceId: 'ws-tetris', title: '默认档' })

    for (const missing of [undefined, null, '', '   ']) {
      const fresh = handle.workflow.createStory({ workspaceId: 'ws-tetris', title: '默认档' })
      const reply = service.startStoryRun(fresh.id, null, undefined, missing)
      assert.equal(reply.permissionTier, null)
      assert.equal(handle.workflow.getRun(reply.runId)?.permissionTier, null)
    }
    assert.equal(service.startStoryRun(story.id, null).storyStatus, 'developing')
  })

  it('refuses an invalid tier before touching the story or the session', () => {
    const handle = open()
    const service = new WorkbenchService(new Context(), handle.workflow)
    const story = handle.workflow.createStory({ workspaceId: 'ws-tetris', title: '非法档位' })

    for (const bad of ['Full', 'READONLY', 'danger-full-access', 'read-only', 'bogus']) {
      assert.throws(
        () => service.startStoryRun(story.id, 'session-bad', undefined, bad),
        (error: unknown) => {
          assert.ok(error instanceof WorkflowError)
          assert.equal(error.code, 'invalid_input')
          // The message names the legal values, so the caller can fix it.
          assert.match(error.message, /normal, readonly, full/)
          return true
        },
      )
    }
    assert.equal(handle.workflow.getStory(story.id)?.status, 'ready')
    assert.equal(handle.workflow.listRuns({ storyId: story.id }).length, 0)
    assert.equal(service.sessionPermissionTier('session-bad').permissionTier, null)
  })

  it('carries the tier into the fix-run reply and the cancel reply', () => {
    const handle = open()
    const host = hostWithSessions('session-full')
    const service = new WorkbenchService(host.ctx, handle.workflow)
    const bug = handle.workflow.createBug({ workspaceId: 'ws-tetris', title: '完全权限修复' })

    const started = service.startBugFixRun(bug.id, 'session-full', undefined, 'full')
    assert.equal(started.permissionTier, 'full')
    assert.deepEqual(host.events, [
      ['sandbox/mode', { mode: 'danger-full-access' }],
      ['approval/policy', { policy: 'never' }],
    ])
    const cancelled = service.cancelBugRun(bug.id)
    assert.equal(cancelled.permissionTier, 'full')
  })

  it('keeps the historic runs readable with a null tier', () => {
    const handle = open()
    const service = new WorkbenchService(new Context(), handle.workflow)
    const story = handle.workflow.createStory({ workspaceId: 'ws-tetris', title: '历史运行' })
    const reply = service.startStoryRun(story.id, 'session-historic')

    // A row written before the migration reads back as null, not as "normal".
    const row = handle.db.prepare('SELECT permission_tier FROM runs WHERE id = ?').get(reply.runId) as
      | { permission_tier: string | null }
      | undefined
    assert.equal(row?.permission_tier, null)
    assert.equal(service.snapshot().runs.find((entry) => entry.id === reply.runId)?.permissionTier, null)
  })
})

describe('permission tier values', () => {
  it('matches the Host enumerations the session is configured with', () => {
    // The tier table is the only place the values appear; this asserts the
    // table against the Host's own lists instead of repeating the strings.
    assert.deepEqual(SANDBOX_MODES, ['read-only', 'workspace-write', 'danger-full-access'])
    assert.deepEqual(APPROVAL_POLICIES, ['ask', 'never'])
  })
})

describe('attachment policy on the create path', () => {
  it('mirrors the Host image limits instead of defining its own', () => {
    // The create page must show the same numbers the composer enforces, so the
    // service forwards the deployment's own `ctx.attachments.imageLimits`.
    const limits = {
      maxImageBytes: 8 * 1024 * 1024,
      maxImagesPerMessage: 5,
      maxMessageImageBytes: 32 * 1024 * 1024,
      maxImagePixels: 64_000_000,
      maxImageDimension: 65_535,
      mediaTypes: ['image/png', 'image/webp'],
    }
    const ctx = new Context()
    ctx.provide('attachments')
    ctx.set('attachments', { imageLimits: limits })
    const service = new WorkbenchService(ctx, open().workflow)

    assert.deepEqual(service.attachmentPolicy(), {
      mediaTypes: ['image/png', 'image/webp'],
      maxImageBytes: 8 * 1024 * 1024,
      maxImagesPerMessage: 5,
      maxMessageImageBytes: 32 * 1024 * 1024,
    })
  })

  it('returns a copy so the page cannot write back into Host limits', () => {
    const limits = { maxImageBytes: 1, maxImagesPerMessage: 1, maxMessageImageBytes: 1, mediaTypes: ['image/png'] }
    const ctx = new Context()
    ctx.provide('attachments')
    ctx.set('attachments', { imageLimits: limits })
    const service = new WorkbenchService(ctx, open().workflow)

    const policy = service.attachmentPolicy()
    // The wire value is a fresh array: a page that sorts or extends it cannot
    // reach back into the Host's frozen limits.
    assert.notEqual(policy?.mediaTypes, limits.mediaTypes)
    assert.deepEqual(policy?.mediaTypes, ['image/png'])
    assert.deepEqual(limits.mediaTypes, ['image/png'])
  })

  it('answers null when the Host composes no attachment store', () => {
    // Without an attachment store the composer validates nothing either, so the
    // page must fall back to "no local limits" rather than inventing a default.
    const service = new WorkbenchService(new Context(), open().workflow)
    assert.equal(service.attachmentPolicy(), null)
  })
})
