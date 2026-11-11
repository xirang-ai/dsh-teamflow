/**
 * Generic discussion sessions: requirements, stories and defects share one
 * registration table, one prepare contract and one link call. Story and defect
 * rows reuse the requirement lifecycle (prepared → linked) and stay out of the
 * board until the Agent confirms them.
 *
 * @module
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, it } from 'node:test'

import { Context } from '@deepseek-ai/cordis'

import { WorkbenchService } from '../src/remote/service.ts'
import { openTeamflowDatabase, type TeamflowDatabase } from '../src/store/db.ts'
import { MIGRATIONS } from '../src/store/schema.ts'

const directories: string[] = []
const handles: TeamflowDatabase[] = []

function open(): TeamflowDatabase {
  const dataDir = mkdtempSync(join(tmpdir(), 'teamflow-discussion-session-'))
  directories.push(dataDir)
  const handle = openTeamflowDatabase({
    dataDir,
    docsDir: join(dataDir, 'workspace'),
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

describe('generic discussion sessions', () => {
  it('keeps a story discussion out of the snapshot until it is linked', () => {
    const handle = open()
    const story = handle.workflow.createStory({ workspaceId: 'ws-discuss', title: '讨论故事' })

    const prepared = handle.workflow.prepareDiscussionSession('story', story.id, 'session-story', 'discuss')
    assert.equal(prepared.subjectType, 'story')
    assert.equal(prepared.subjectId, story.id)
    assert.equal(prepared.linkedAt, null)
    assert.equal(handle.workflow.getDiscussionSession('session-story')?.kind, 'discuss')
    assert.deepEqual(handle.workflow.listBoard().discussionSessions, [])

    const linked = handle.workflow.linkDiscussionSession('session-story')
    assert.notEqual(linked.linkedAt, null)
    assert.deepEqual(
      handle.workflow.listBoard().discussionSessions.map((session) => [session.subjectType, session.sessionId]),
      [['story', 'session-story']],
    )
    assert.equal(handle.workflow.linkDiscussionSession('session-story').linkedAt, linked.linkedAt)

    const service = new WorkbenchService(new Context(), handle.workflow)
    assert.deepEqual(
      service.snapshot().stories[0]?.sessions.map((session) => [session.sessionId, session.kind]),
      [['session-story', 'discuss']],
    )
  })

  it('links a defect discussion through the same table and keeps the idempotent reply', () => {
    const handle = open()
    const bug = handle.workflow.createBug({ workspaceId: 'ws-discuss', title: '缺陷讨论' })
    handle.workflow.prepareDiscussionSession('bug', bug.id, 'session-bug', 'discuss')
    const linked = handle.workflow.linkDiscussionSession('session-bug')
    assert.equal(linked.subjectType, 'bug')
    assert.notEqual(linked.linkedAt, null)
    assert.equal(handle.workflow.getDiscussionSession('session-bug')?.subjectId, bug.id)
  })

  it('copies requirement_sessions rows into discussion_sessions during migration 17', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'teamflow-migration-17-'))
    directories.push(dataDir)
    const file = join(dataDir, 'teamflow.sqlite')
    const legacy = new DatabaseSync(file)
    // The runner turns foreign keys off while rebuilding tables; migrations
    // that rebuild requirements must see the same setting here.
    legacy.exec('PRAGMA foreign_keys = OFF')
    for (const migration of MIGRATIONS.filter((entry) => entry.version <= 16)) {
      migration.up(legacy)
    }
    legacy.exec('PRAGMA user_version = 16')
    legacy
      .prepare(
        "INSERT INTO requirements (id, workspace_id, title, summary, content_path, status, created_at, updated_at) VALUES ('req_old', 'ws-old', '旧需求', '', 'requirements/req_old/requirement.md', 'draft', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')",
      )
      .run()
    legacy
      .prepare(
        "INSERT INTO requirement_sessions (requirement_id, session_id, kind, prepared_at, linked_at, created_at) VALUES ('req_old', 'session-old', 'detail', '2026-01-01T00:00:00.000Z', '2026-01-01T01:00:00.000Z', '2026-01-01T00:00:00.000Z')",
      )
      .run()
    legacy.close()

    const handle = openTeamflowDatabase({
      dataDir,
      docsDir: join(dataDir, 'workspace'),
      version: '0.1.0',
      log: { info: () => {}, warn: () => {}, error: () => {} },
    })
    handles.push(handle)
    const sessions = handle.workflow.listRequirementSessions('req_old')
    assert.deepEqual(
      sessions.map((session) => [session.sessionId, session.kind, session.linkedAt]),
      [['session-old', 'detail', '2026-01-01T01:00:00.000Z']],
    )
    const tables = handle.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => String(row['name']))
    assert.ok(tables.includes('discussion_sessions'))
    assert.ok(!tables.includes('requirement_sessions'))
  })
})
