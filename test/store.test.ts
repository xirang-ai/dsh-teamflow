/**
 * Store-level tests: no Host context, a real SQLite file in a temporary
 * directory, so migrations, seeding, and the version decision are exercised
 * against the same code path the plugin runs at startup.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, it } from 'node:test'

import { META_KEYS, openTeamflowDatabase } from '../src/store/db.ts'
import { BUILTIN_ROLES, MIGRATIONS, SCHEMA_COMMENTS, TARGET_SCHEMA_VERSION } from '../src/store/schema.ts'
import { compareVersionStrings, parseVersion } from '../src/store/versions.ts'

const directories: string[] = []

function temporaryDataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'teamflow-store-'))
  directories.push(dir)
  return dir
}

afterEach(() => {
  while (directories.length > 0) {
    const dir = directories.pop()
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  }
})

const silent = {
  info: () => {},
  warn: () => {},
  error: () => {},
}

describe('openTeamflowDatabase', () => {
  it('creates the schema and seeds built-in roles on first start', () => {
    const dataDir = temporaryDataDir()
    const handle = openTeamflowDatabase({ dataDir, version: '0.1.0', log: silent })
    try {
      assert.equal(handle.report.outcome, 'initialized')
      assert.equal(handle.report.firstStart, true)
      assert.deepEqual(handle.report.appliedMigrations, [
        1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17,
      ])
      assert.equal(TARGET_SCHEMA_VERSION, 17)

      const roles = handle.listRoles()
      assert.deepEqual(
        roles.map((role) => role.key),
        BUILTIN_ROLES.map((role) => role.key),
      )
      assert.deepEqual(
        roles.map((role) => role.name),
        ['产品', '研发'],
      )
      assert.ok(roles.every((role) => role.builtin))

      const version = handle.db.prepare('SELECT value FROM meta WHERE key = ?').get(META_KEYS.pluginVersion)
      assert.equal(version?.['value'], '0.1.0')
    } finally {
      handle.close()
    }
  })

  it('documents every table and column in the data dictionary', () => {
    const handle = openTeamflowDatabase({ dataDir: temporaryDataDir(), version: '0.1.0', log: silent })
    try {
      const tables = handle.db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
        .all()
        .map((row) => String(row['name']))

      const documented = new Map<string, Set<string>>()
      for (const comment of handle.listSchemaComments()) {
        const columns = documented.get(comment.table) ?? new Set<string>()
        columns.add(comment.column)
        documented.set(comment.table, columns)
        assert.notEqual(comment.description.trim(), '', `${comment.table}.${comment.column} has an empty description`)
      }

      // Every real table and column is documented…
      for (const table of tables) {
        const columns = documented.get(table)
        assert.ok(columns?.has(''), `table ${table} has no table-level comment`)
        const info = handle.db.prepare(`PRAGMA table_info(${table})`).all()
        for (const column of info) {
          const name = String(column['name'])
          assert.ok(columns?.has(name), `column ${table}.${name} has no comment`)
        }
      }

      // …and the dictionary documents nothing that does not exist.
      for (const [table, columns] of documented) {
        assert.ok(tables.includes(table), `dictionary mentions unknown table ${table}`)
        const info = handle.db.prepare(`PRAGMA table_info(${table})`).all()
        const names = new Set(info.map((column) => String(column['name'])))
        for (const column of columns) {
          if (column === '') continue
          assert.ok(names.has(column), `dictionary mentions unknown column ${table}.${column}`)
        }
      }

      assert.ok(SCHEMA_COMMENTS.length >= tables.length, 'comment registry is populated')
    } finally {
      handle.close()
    }
  })

  it('keeps the inline DDL comments inside sqlite_master', () => {
    const handle = openTeamflowDatabase({ dataDir: temporaryDataDir(), version: '0.1.0', log: silent })
    try {
      const sql = String(
        handle.db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'roles'").get()?.['sql'] ?? '',
      )
      assert.match(sql, /--\s*稳定标识/, 'column comment survived into sqlite_master.sql')
      assert.match(sql, /--\s*角色表/, 'table comment survived into sqlite_master.sql')
      assert.equal(Number(handle.db.prepare('PRAGMA user_version').get()?.['user_version']), TARGET_SCHEMA_VERSION)
    } finally {
      handle.close()
    }
  })

  it('reports an unchanged version on the next start and does not duplicate roles', () => {
    const dataDir = temporaryDataDir()
    openTeamflowDatabase({ dataDir, version: '0.1.0', log: silent }).close()

    const handle = openTeamflowDatabase({ dataDir, version: '0.1.0', log: silent })
    try {
      assert.equal(handle.report.outcome, 'unchanged')
      assert.equal(handle.report.firstStart, false)
      assert.deepEqual(handle.report.appliedMigrations, [])
      assert.equal(handle.listRoles().length, BUILTIN_ROLES.length)
      assert.equal(handle.report.fromVersion, '0.1.0')
    } finally {
      handle.close()
    }
  })

  it('records a version upgrade and keeps the previous version', () => {
    const dataDir = temporaryDataDir()
    openTeamflowDatabase({ dataDir, version: '0.1.0', log: silent }).close()

    const handle = openTeamflowDatabase({ dataDir, version: '0.2.0', log: silent })
    try {
      assert.equal(handle.report.outcome, 'upgraded')
      assert.equal(handle.report.fromVersion, '0.1.0')
      assert.equal(handle.report.toVersion, '0.2.0')

      const storedVersion = handle.db.prepare('SELECT value FROM meta WHERE key = ?').get(META_KEYS.pluginVersion)
      const storedFrom = handle.db.prepare('SELECT value FROM meta WHERE key = ?').get(META_KEYS.lastUpgradeFrom)
      assert.equal(storedVersion?.['value'], '0.2.0')
      assert.equal(storedFrom?.['value'], '0.1.0')
    } finally {
      handle.close()
    }
  })

  it('does not downgrade a newer stored version', () => {
    const dataDir = temporaryDataDir()
    openTeamflowDatabase({ dataDir, version: '0.2.0', log: silent }).close()

    const handle = openTeamflowDatabase({ dataDir, version: '0.1.0', log: silent })
    try {
      assert.equal(handle.report.outcome, 'downgraded')
      assert.equal(handle.report.fromVersion, '0.2.0')
    } finally {
      handle.close()
    }

    const reopened = openTeamflowDatabase({ dataDir, version: '0.2.0', log: silent })
    try {
      assert.equal(reopened.report.outcome, 'unchanged')
    } finally {
      reopened.close()
    }
  })

  it('preserves a renamed built-in role across starts', () => {
    const dataDir = temporaryDataDir()
    const first = openTeamflowDatabase({ dataDir, version: '0.1.0', log: silent })
    first.db.prepare('UPDATE roles SET name = ? WHERE key = ?').run('Product', 'product')
    first.close()

    const second = openTeamflowDatabase({ dataDir, version: '0.1.0', log: silent })
    try {
      const product = second.listRoles().find((role) => role.key === 'product')
      assert.equal(product?.name, 'Product')
    } finally {
      second.close()
    }
  })

  it('writes the database inside the configured data directory', () => {
    const dataDir = temporaryDataDir()
    const handle = openTeamflowDatabase({ dataDir, version: '0.1.0', log: silent })
    try {
      assert.equal(handle.file, join(dataDir, 'teamflow.sqlite'))
    } finally {
      handle.close()
    }
  })

  it('upgrades a version-2 database to the workflow schema without touching roles', () => {
    const dataDir = temporaryDataDir()
    const file = join(dataDir, 'teamflow.sqlite')
    const legacy = new DatabaseSync(file)
    legacy.exec('PRAGMA foreign_keys = ON')
    for (const migration of MIGRATIONS.filter((entry) => entry.version <= 2)) {
      migration.up(legacy)
    }
    legacy.exec('PRAGMA user_version = 2')
    legacy
      .prepare('INSERT INTO roles (key, name, description, builtin, sort_order, created_at, updated_at) VALUES (?, ?, ?, 1, 9, ?, ?)')
      .run('custom', '自定义角色', '升级前已有', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')
    legacy.close()

    const handle = openTeamflowDatabase({ dataDir, version: '0.1.0', log: silent })
    try {
      assert.deepEqual(handle.report.appliedMigrations, [
        3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17,
      ])
      assert.equal(handle.report.firstStart, true)
      assert.equal(handle.listRoles().find((role) => role.key === 'custom')?.name, '自定义角色')
      const tables = handle.db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('requirements', 'stories', 'bugs', 'runs', 'design_docs', 'design_doc_stories', 'workspaces', 'discussion_sessions')",
        )
        .all()
        .map((row) => String(row['name']))
      assert.deepEqual(tables.sort(), [
        'bugs',
        'design_doc_stories',
        'design_docs',
        'discussion_sessions',
        'requirements',
        'runs',
        'stories',
        'workspaces',
      ])
    } finally {
      handle.close()
    }
  })
})

describe('version comparison', () => {
  it('parses semantic versions', () => {
    assert.deepEqual(parseVersion('1.2.3'), { major: 1, minor: 2, patch: 3, prerelease: [] })
    assert.deepEqual(parseVersion('v0.2.2-rc.1'), {
      major: 0,
      minor: 2,
      patch: 2,
      prerelease: ['rc', '1'],
    })
    assert.equal(parseVersion('not-a-version'), undefined)
  })

  it('orders releases above their prereleases', () => {
    assert.ok(compareVersionStrings('0.2.2-rc.1', '0.2.2') < 0)
    assert.ok(compareVersionStrings('0.2.2', '0.2.2-rc.2') > 0)
    assert.ok(compareVersionStrings('0.2.2-rc.2', '0.2.2-rc.10') < 0)
    assert.equal(compareVersionStrings('0.2.2+sha.abc', '0.2.2'), 0)
    assert.ok(compareVersionStrings('0.3.0', '0.2.9') > 0)
  })
})
