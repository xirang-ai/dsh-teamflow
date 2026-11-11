/**
 * v16 remembers which conversation created a story or a defect, so the session
 * tab can show the record and the record can link back to that conversation.
 * This test builds a real v15 database (no `create_session_id`), opens it
 * through the normal startup path, and checks that the upgrade adds the columns
 * without inventing an origin for rows that predate them.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, it } from 'node:test'

import { openTeamflowDatabase } from '../src/store/db.ts'
import { MIGRATIONS, TARGET_SCHEMA_VERSION } from '../src/store/schema.ts'

const directories: string[] = []

function temporaryRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'teamflow-v16-'))
  directories.push(dir)
  return dir
}

afterEach(() => {
  while (directories.length > 0) {
    const dir = directories.pop()
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  }
})

const silent = { info: () => {}, warn: () => {}, error: () => {} }
const DOC_ROOT = '.xirang-ai/dsh-teamflow'

/** Build a v15 file: one requirement with one story, plus one defect. */
function legacyV15(root: string): string {
  const file = join(root, 'teamflow.sqlite')
  const legacy = new DatabaseSync(file)
  // Rebuild migrations (v10) drop and rename their tables, which SQLite refuses
  // while foreign keys are enforced; db.ts upgrades with them off for this reason.
  legacy.exec('PRAGMA foreign_keys = OFF')
  for (const migration of MIGRATIONS.filter((entry) => entry.version <= 15)) migration.up(legacy)
  legacy.exec('PRAGMA user_version = 15')
  legacy.exec('PRAGMA foreign_keys = ON')

  legacy
    .prepare('INSERT INTO workspaces (workspace_id, path, created_at, updated_at) VALUES (?, ?, ?, ?)')
    .run('ws-a', root, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')
  legacy
    .prepare(
      `INSERT INTO requirements
         (id, workspace_id, title, summary, content_path, status, created_at, updated_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    )
    .run(
      'req_one',
      'ws-a',
      '旧需求',
      '',
      `${DOC_ROOT}/requirements/req_one/requirement.md`,
      'draft',
      '2026-01-01T00:00:00.000Z',
      '2026-01-01T00:00:00.000Z',
    )
  legacy
    .prepare(
      `INSERT INTO stories
         (id, workspace_id, requirement_id, title, content_path, status, size, sort_order,
          created_at, updated_at, done_at, completed_at)
       VALUES (?, ?, ?, ?, ?, 'ready', 's', 1, ?, ?, NULL, NULL)`,
    )
    .run(
      'sty_old',
      'ws-a',
      'req_one',
      '旧故事',
      `${DOC_ROOT}/stories/sty_old/story.md`,
      '2026-01-02T00:00:00.000Z',
      '2026-01-02T00:00:00.000Z',
    )
  legacy
    .prepare(
      `INSERT INTO bugs
         (id, workspace_id, title, content_path, severity, status, resolution,
          created_at, updated_at, fixed_at, completed_at)
       VALUES (?, ?, ?, ?, 'major', 'reported', '', ?, ?, NULL, NULL)`,
    )
    .run(
      'bug_old',
      'ws-a',
      '旧缺陷',
      `${DOC_ROOT}/bugs/bug_old/bug.md`,
      '2026-01-03T00:00:00.000Z',
      '2026-01-03T00:00:00.000Z',
    )

  legacy.close()
  return file
}

describe('schema v16', () => {
  it('adds the creation session columns and leaves legacy rows without an origin', () => {
    const root = temporaryRoot()
    assert.ok(legacyV15(root).length > 0)

    const handle = openTeamflowDatabase({ dataDir: root, version: '0.1.0', log: silent })
    try {
      assert.deepEqual(handle.report.appliedMigrations, [16, 17])
      assert.equal(Number(handle.db.prepare('PRAGMA user_version').get()?.['user_version']), TARGET_SCHEMA_VERSION)
      assert.deepEqual(handle.db.prepare('PRAGMA foreign_key_check').all(), [])

      assert.equal(handle.workflow.getStory('sty_old')?.createSessionId, null)
      assert.equal(handle.workflow.getBug('bug_old')?.createSessionId, null)

      const story = handle.workflow.createStory({
        workspaceId: 'ws-a',
        title: '新故事',
        sessionId: 'session-story',
      })
      assert.equal(story.createSessionId, 'session-story')
      const bug = handle.workflow.createBug({
        workspaceId: 'ws-a',
        title: '新缺陷',
        sessionId: 'session-bug',
      })
      assert.equal(bug.createSessionId, 'session-bug')
    } finally {
      handle.close()
    }
  })
})
