/**
 * v15 gives stories the same explicit display position design documents already
 * had, and turns both into a 1..n sequence inside each requirement. This test
 * builds a real v14 database (no `sort_order` on stories, all documents at 0),
 * opens it through the normal startup path, and checks that the upgrade keeps
 * the previous display order, backfills creation-time ties deterministically,
 * and appends new rows after the current last position.
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
  const dir = mkdtempSync(join(tmpdir(), 'teamflow-v15-'))
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

/** Build a v14 file: one requirement with three stories, three documents and one standalone story. */
function legacyV14(root: string): string {
  const file = join(root, 'teamflow.sqlite')
  const legacy = new DatabaseSync(file)
  // Rebuild migrations (v10) drop and rename their tables, which SQLite refuses
  // while foreign keys are enforced; db.ts upgrades with them off for this reason.
  legacy.exec('PRAGMA foreign_keys = OFF')
  for (const migration of MIGRATIONS.filter((entry) => entry.version <= 14)) migration.up(legacy)
  legacy.exec('PRAGMA user_version = 14')
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
      '顺序需求',
      '',
      `${DOC_ROOT}/requirements/req_one/requirement.md`,
      'draft',
      '2026-01-01T00:00:00.000Z',
      '2026-01-01T00:00:00.000Z',
    )

  const insertStory = legacy.prepare(
    `INSERT INTO stories
       (id, workspace_id, requirement_id, title, content_path, status, size, created_at, updated_at, done_at, completed_at)
     VALUES (?, ?, ?, ?, ?, 'ready', 's', ?, ?, NULL, NULL)`,
  )
  // Insertion order is deliberately not creation order.
  insertStory.run('sty_b', 'ws-a', 'req_one', '第二条', `${DOC_ROOT}/stories/sty_b/story.md`, '2026-01-02T00:00:00.000Z', '2026-01-02T00:00:00.000Z')
  insertStory.run('sty_c', 'ws-a', 'req_one', '同刻第二', `${DOC_ROOT}/stories/sty_c/story.md`, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')
  insertStory.run('sty_a', 'ws-a', 'req_one', '第一条', `${DOC_ROOT}/stories/sty_a/story.md`, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')
  insertStory.run('sty_solo', 'ws-a', null, '独立故事', `${DOC_ROOT}/stories/sty_solo/story.md`, '2025-12-01T00:00:00.000Z', '2025-12-01T00:00:00.000Z')

  const insertDoc = legacy.prepare(
    `INSERT INTO design_docs (id, requirement_id, kind, title, content_path, sort_order, created_at, updated_at)
     VALUES (?, 'req_one', 'flow', ?, ?, 0, ?, ?)`,
  )
  insertDoc.run('doc_late', '后写的', `${DOC_ROOT}/requirements/req_one/docs/doc_late.md`, '2026-02-03T00:00:00.000Z', '2026-02-03T00:00:00.000Z')
  insertDoc.run('doc_early', '先写的', `${DOC_ROOT}/requirements/req_one/docs/doc_early.md`, '2026-02-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z')
  insertDoc.run('doc_mid', '中间写的', `${DOC_ROOT}/requirements/req_one/docs/doc_mid.md`, '2026-02-02T00:00:00.000Z', '2026-02-02T00:00:00.000Z')

  legacy.close()
  return file
}

describe('schema v15', () => {
  it('backfills display positions by creation time and appends new rows at the end', () => {
    const root = temporaryRoot()
    assert.ok(legacyV14(root).length > 0)

    const handle = openTeamflowDatabase({ dataDir: root, version: '0.1.0', log: silent })
    try {
      assert.deepEqual(handle.report.appliedMigrations, [15, 16])
      assert.equal(Number(handle.db.prepare('PRAGMA user_version').get()?.['user_version']), TARGET_SCHEMA_VERSION)
      assert.deepEqual(handle.db.prepare('PRAGMA foreign_key_check').all(), [])

      // Creation time decides, and equal timestamps fall back to the id.
      assert.deepEqual(
        handle.workflow.listStories({ requirementId: 'req_one' }).map((story) => [story.id, story.sortOrder]),
        [
          ['sty_a', 1],
          ['sty_c', 2],
          ['sty_b', 3],
        ],
      )
      assert.deepEqual(
        handle.workflow.listDesignDocs('req_one').map((doc) => [doc.id, doc.sortOrder]),
        [
          ['doc_early', 1],
          ['doc_mid', 2],
          ['doc_late', 3],
        ],
      )
      // A standalone story is its own ordering group.
      assert.equal(handle.workflow.getStory('sty_solo')?.sortOrder, 1)

      const story = handle.workflow.createStory({ requirementId: 'req_one', title: '新故事' })
      assert.equal(story.sortOrder, 4)
      assert.deepEqual(
        handle.workflow.listStories({ requirementId: 'req_one' }).map((row) => row.id),
        ['sty_a', 'sty_c', 'sty_b', story.id],
      )

      const doc = handle.workflow.createDesignDoc({ requirementId: 'req_one', title: '新详设' })
      assert.equal(doc.sortOrder, 4)
      assert.deepEqual(
        handle.workflow.listDesignDocs('req_one').map((row) => row.id),
        ['doc_early', 'doc_mid', 'doc_late', doc.id],
      )
    } finally {
      handle.close()
    }
  })
})
