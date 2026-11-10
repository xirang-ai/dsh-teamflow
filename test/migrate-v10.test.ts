/**
 * v10 collapses `designs` into `requirements`: one requirement owns the
 * outline body, its detailed designs, its stories and its sessions. This test
 * builds a real v9 database (with two designs, a doc, a story and both session
 * kinds), opens it through the normal startup path, and checks the merged rows
 * plus the relocated Markdown files.
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, it } from 'node:test'

import { openTeamflowDatabase } from '../src/store/db.ts'
import { MIGRATIONS, TARGET_SCHEMA_VERSION } from '../src/store/schema.ts'

const directories: string[] = []

function temporaryRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'teamflow-v10-'))
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
const T = '2026-01-01T00:00:00.000Z'
const DOC_ROOT = '.xirang-ai/dsh-teamflow'

function write(root: string, relative: string, body: string): void {
  const file = join(root, relative)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, body, 'utf8')
}

/** Build a v9 file with one requirement, two designs, one doc, one story and two sessions. */
function legacyV9(root: string): string {
  const file = join(root, 'teamflow.sqlite')
  const legacy = new DatabaseSync(file)
  legacy.exec('PRAGMA foreign_keys = ON')
  for (const migration of MIGRATIONS.filter((entry) => entry.version <= 9)) migration.up(legacy)
  legacy.exec('PRAGMA user_version = 9')

  legacy
    .prepare('INSERT INTO workspaces (workspace_id, path, created_at, updated_at) VALUES (?, ?, ?, ?)')
    .run('ws-a', root, T, T)
  legacy
    .prepare(
      `INSERT INTO requirements
         (id, workspace_id, title, summary, content_path, status, created_at, updated_at, confirmed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run('req_one', 'ws-a', '合并需求', '旧摘要', `${DOC_ROOT}/requirements/req_one/requirement.md`, 'confirmed', T, T, T)
  legacy
    .prepare(
      `INSERT INTO designs
         (id, workspace_id, requirement_id, title, content_path, status, created_at, updated_at, approved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run('dsn_old', 'ws-a', 'req_one', '旧概设', `${DOC_ROOT}/designs/dsn_old/design.md`, 'approved', T, T, '2026-03-01T00:00:00.000Z')
  legacy
    .prepare(
      `INSERT INTO designs
         (id, workspace_id, requirement_id, title, content_path, status, created_at, updated_at, approved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run('dsn_new', 'ws-a', 'req_one', '新概设', `${DOC_ROOT}/designs/dsn_new/design.md`, 'draft', '2026-02-01T00:00:00.000Z', T, null)
  legacy
    .prepare(
      `INSERT INTO design_docs (id, design_id, kind, title, content_path, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run('doc_one', 'dsn_old', 'flow', '旧详设', `${DOC_ROOT}/designs/dsn_old/docs/doc_one.md`, 0, T, T)
  legacy
    .prepare(
      `INSERT INTO stories
         (id, workspace_id, design_id, requirement_id, title, content_path, status, size, created_at, updated_at, done_at)
       VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, NULL)`,
    )
    .run('sty_one', 'ws-a', 'dsn_old', '旧故事', `${DOC_ROOT}/stories/sty_one/story.md`, 'backlog', 'm', T, T)
  legacy
    .prepare(
      `INSERT INTO design_sessions (design_id, session_id, prepared_at, linked_at) VALUES (?, ?, ?, ?)`,
    )
    .run('dsn_old', 'session-design', '2026-04-01T00:00:00.000Z', '2026-04-01T01:00:00.000Z')
  legacy
    .prepare('INSERT INTO requirement_sessions (requirement_id, session_id, created_at) VALUES (?, ?, ?)')
    .run('req_one', 'session-create', T)

  write(root, `${DOC_ROOT}/designs/dsn_old/design.md`, '# 旧概设正文\n')
  write(root, `${DOC_ROOT}/designs/dsn_new/design.md`, '# 新概设正文\n')
  write(root, `${DOC_ROOT}/designs/dsn_old/docs/doc_one.md`, '# 旧详设正文\n')
  write(root, `${DOC_ROOT}/stories/sty_one/story.md`, '# 旧故事正文\n')
  legacy.close()
  return file
}

describe('schema v10', () => {
  it('merges designs into requirements and keeps every child readable', () => {
    const root = temporaryRoot()
    const file = legacyV9(root)

    const handle = openTeamflowDatabase({ dataDir: root, docsRoot: root, version: '0.1.0', log: silent })
    try {
      assert.deepEqual(handle.report.appliedMigrations, [10, 11, 12, 13, 14, 15, 16])

      const requirement = handle.workflow.getRequirement('req_one')
      assert.equal(requirement?.status, 'draft')
      assert.equal(requirement?.completedAt, null)
      assert.equal(requirement?.contentPath, `${DOC_ROOT}/requirements/req_one/requirement.md`)
      assert.equal(
        readFileSync(join(root, requirement?.contentPath ?? ''), 'utf8'),
        '# 旧概设正文\n\n\n## 新概设\n\n# 新概设正文\n',
      )

      const docs = handle.workflow.listDesignDocs('req_one')
      assert.deepEqual(docs.map((doc) => doc.id), ['doc_one'])
      assert.equal(docs[0]?.contentPath, `${DOC_ROOT}/requirements/req_one/docs/doc_one.md`)
      assert.equal(readFileSync(join(root, docs[0]?.contentPath ?? ''), 'utf8'), '# 旧详设正文\n')

      const story = handle.workflow.getStory('sty_one')
      assert.equal(story?.requirementId, 'req_one')

      const sessions = handle.workflow.listRequirementSessions('req_one')
      assert.deepEqual(
        sessions.map((session) => [session.sessionId, session.kind]).sort(),
        [
          ['session-create', 'create'],
          ['session-design', 'design'],
        ],
      )

      const tables = handle.db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map((row) => String(row['name']))
      assert.ok(!tables.includes('designs'))
      assert.ok(!tables.includes('design_sessions'))
      assert.equal(Number(handle.db.prepare('PRAGMA user_version').get()?.['user_version']), TARGET_SCHEMA_VERSION)
      assert.deepEqual(handle.db.prepare('PRAGMA foreign_key_check').all(), [])
      assert.ok(file.length > 0)
    } finally {
      handle.close()
    }
  })
})
