/**
 * Durable workbench database: opening, configuring, migrating, seeding roles,
 * and reconciling the stored plugin version with the running one.
 *
 * Everything here is synchronous on purpose — SQLite's synchronous API is
 * fast enough for startup-sized work, and a synchronous startup keeps the
 * version decision deterministic before any tool can read the database.
 *
 * @module
 */
import { DatabaseSync } from 'node:sqlite'

import { contextualError, describeError } from '../errors.ts'
import { readPluginVersion } from '../version.ts'
import {
  DATABASE_FILENAME,
  databaseFile,
  ensureDataDir,
  resolveDataDir,
  toDisplayPath,
} from './paths.ts'
import {
  BUILTIN_ROLES,
  MIGRATIONS,
  TARGET_SCHEMA_VERSION,
  syncSchemaComments,
  type Migration,
  type SchemaComment,
} from './schema.ts'
import { withTransaction } from './transaction.ts'
import { runUpgrades, type AppliedUpgrade } from './upgrades.ts'
import { compareVersionStrings, parseVersion } from './versions.ts'
import { WorkflowStore } from './workflow.ts'

/** Minimal logger surface the store needs; `ctx.logger(name)` satisfies it. */
export interface FlowLogger {
  info(message: string): void
  warn(message: string): void
  error(message: string): void
}

/** A logger that drops everything, for tests and for a store without a Host context. */
export const SILENT_LOGGER: FlowLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
}

/** Keys the store keeps in the `meta` table. */
export const META_KEYS = {
  /** Plugin version recorded at the previous start. */
  pluginVersion: 'plugin_version',
  /** When that version was recorded. */
  pluginVersionUpdatedAt: 'plugin_version_updated_at',
  /** Version the last upgrade came from. */
  lastUpgradeFrom: 'last_upgrade_from',
  /** When the last upgrade ran. */
  lastUpgradeAt: 'last_upgrade_at',
  /** Schema version, mirrored from `PRAGMA user_version` for inspection. */
  schemaVersion: 'schema_version',
} as const

/** How the stored plugin version related to the running one. */
export type VersionOutcome = 'initialized' | 'unchanged' | 'upgraded' | 'downgraded'

/** What the last successful start decided about versions and schema. */
export interface StartupReport {
  /** Absolute database file. */
  readonly file: string
  /** Database file rendered for logs (`$DSH_HOME/...`). */
  readonly displayFile: string
  /** Version stored before this start, `null` on the first start. */
  readonly fromVersion: string | null
  /** Version now running. */
  readonly toVersion: string
  /** Version decision taken by this start. */
  readonly outcome: VersionOutcome
  /** Whether this start created the schema. */
  readonly firstStart: boolean
  /** Schema versions applied by this start. */
  readonly appliedMigrations: readonly number[]
  /** Plugin-version upgrade steps applied by this start. */
  readonly appliedUpgrades: readonly AppliedUpgrade[]
}

/** One role row. */
export interface Role {
  readonly id: number
  readonly key: string
  readonly name: string
  readonly description: string
  readonly builtin: boolean
  readonly sortOrder: number
  readonly createdAt: string
  readonly updatedAt: string
}

/** Open database plus the decisions this start made. */
export interface TeamflowDatabase {
  /** Absolute database file. */
  readonly file: string
  /** The live handle; callers must not close it directly. */
  readonly db: DatabaseSync
  /** Version and schema decisions taken at startup. */
  readonly report: StartupReport
  /** Domain workflow over the same connection. */
  readonly workflow: WorkflowStore
  /** Roles ordered by `sort_order`, then id. */
  listRoles(): readonly Role[]
  /** Table/column documentation from the `schema_comments` data dictionary. */
  listSchemaComments(): readonly SchemaComment[]
  /** Release the handle; safe to call more than once. */
  close(): void
}

/** Options for {@link openTeamflowDatabase}. */
export interface OpenDatabaseOptions {
  /** `Config.dataDir` override; empty uses the plugin home below `$DSH_HOME`. */
  readonly dataDir?: string
  /**
   * Where documents are written when a workspace directory is unknown yet.
   * Production passes the workspace path via `registerWorkspace` instead.
   */
  readonly docsRoot?: string
  /** Resolver consulted before the registry, for the Host's live workspace list. */
  readonly workspaceRoot?: (workspaceId: string) => string | undefined
  /** SQLite busy timeout in milliseconds. */
  readonly busyTimeoutMs?: number
  /** Version to record; defaults to the running package version. */
  readonly version?: string
  /** Where startup progress goes. */
  readonly log?: FlowLogger
}

interface Reconciliation {
  readonly fromVersion: string | null
  readonly outcome: VersionOutcome
  readonly appliedUpgrades: readonly AppliedUpgrade[]
}

function configure(db: DatabaseSync, busyTimeoutMs: number): void {
  const timeout = Number.isFinite(busyTimeoutMs) ? Math.max(0, Math.trunc(busyTimeoutMs)) : 0
  // WAL keeps readers unblocked while a writer holds the lock; NORMAL is the
  // conventional durability/latency trade-off for WAL.
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA synchronous = NORMAL')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec(`PRAGMA busy_timeout = ${timeout}`)
}

function readUserVersion(db: DatabaseSync): number {
  const row = db.prepare('PRAGMA user_version').get()
  const value = row?.['user_version']
  return typeof value === 'number' ? value : 0
}

function readMeta(db: DatabaseSync, key: string): string | null {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key)
  const value = row?.['value']
  return typeof value === 'string' ? value : null
}

function writeMeta(db: DatabaseSync, key: string, value: string, now: string): void {
  db.prepare(
    `INSERT INTO meta (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(key, value, now)
}

function migrate(db: DatabaseSync, log: FlowLogger): readonly number[] {
  const current = readUserVersion(db)
  if (current > TARGET_SCHEMA_VERSION) {
    throw new Error(
      `database schema version ${current} is newer than this build supports (${TARGET_SCHEMA_VERSION}); ` +
        'install the matching newer plugin release instead of downgrading',
    )
  }

  const pending = MIGRATIONS.filter((migration) => migration.version > current).sort(
    byVersion,
  )
  const applied: number[] = []
  for (const migration of pending) {
    const now = new Date().toISOString()
    const apply = (): void => {
      withTransaction(db, () => {
        migration.up(db)
        // A rebuilt table can leave dangling rows if a copy step was wrong.
        // Checking before COMMIT keeps the failure atomic with the migration.
        if (migration.rebuild === true) assertForeignKeys(db, migration.version)
        // PRAGMA takes a literal; the value is our own integer constant.
        db.exec(`PRAGMA user_version = ${migration.version}`)
        writeMeta(db, META_KEYS.schemaVersion, String(migration.version), now)
      })
    }
    if (migration.rebuild === true) {
      // SQLite cannot toggle foreign-key enforcement inside a transaction, so
      // the switch happens around it. The check inside `apply` is the guard.
      db.exec('PRAGMA foreign_keys = OFF')
      try {
        apply()
      } finally {
        db.exec('PRAGMA foreign_keys = ON')
      }
    } else {
      apply()
    }
    log.info(`schema migration ${migration.version}: ${migration.description}`)
    applied.push(migration.version)
  }
  return applied
}

/** Throw when a migration left rows pointing at records that no longer exist. */
function assertForeignKeys(db: DatabaseSync, version: number): void {
  const violations = db.prepare('PRAGMA foreign_key_check').all()
  if (violations.length === 0) return
  const first = violations[0] ?? {}
  throw new Error(
    `schema migration ${version} left ${violations.length} foreign-key violation(s) ` +
      `(table ${String(first['table'] ?? '?')}, rowid ${String(first['rowid'] ?? '?')}); refusing to commit`,
  )
}

function byVersion(left: Migration, right: Migration): number {
  return left.version - right.version
}

function seedBuiltinRoles(db: DatabaseSync): void {
  const now = new Date().toISOString()
  const insert = db.prepare(
    `INSERT INTO roles (key, name, description, builtin, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, 1, ?, ?, ?)
     ON CONFLICT(key) DO NOTHING`,
  )
  withTransaction(db, () => {
    for (const role of BUILTIN_ROLES) {
      insert.run(role.key, role.name, role.description, role.sortOrder, now, now)
    }
  })
}

function reconcileVersion(
  db: DatabaseSync,
  version: string,
  log: FlowLogger,
): Reconciliation {
  const stored = readMeta(db, META_KEYS.pluginVersion)
  const now = new Date().toISOString()

  if (stored === null) {
    writeMeta(db, META_KEYS.pluginVersion, version, now)
    writeMeta(db, META_KEYS.pluginVersionUpdatedAt, now, now)
    return { fromVersion: null, outcome: 'initialized', appliedUpgrades: [] }
  }

  if (stored === version) {
    return { fromVersion: stored, outcome: 'unchanged', appliedUpgrades: [] }
  }

  // A rollback must not run forward upgrades against a newer database.
  if (compareVersionStrings(stored, version) > 0) {
    log.warn(
      `stored plugin version ${stored} is newer than the running ${version}; ` +
        'skipping upgrades and leaving the stored version untouched',
    )
    return { fromVersion: stored, outcome: 'downgraded', appliedUpgrades: [] }
  }

  if (parseVersion(stored) === undefined) {
    log.warn(`stored plugin version "${stored}" is unreadable; running every upgrade up to ${version}`)
  }

  const appliedUpgrades = withTransaction(db, () => {
    const applied = runUpgrades({ db, from: stored, to: version, log: (message) => log.info(message) })
    writeMeta(db, META_KEYS.pluginVersion, version, now)
    writeMeta(db, META_KEYS.pluginVersionUpdatedAt, now, now)
    writeMeta(db, META_KEYS.lastUpgradeFrom, stored, now)
    writeMeta(db, META_KEYS.lastUpgradeAt, now, now)
    return applied
  })

  return { fromVersion: stored, outcome: 'upgraded', appliedUpgrades }
}

function toRole(row: Record<string, unknown>): Role {
  return {
    id: Number(row['id'] ?? 0),
    key: String(row['key'] ?? ''),
    name: String(row['name'] ?? ''),
    description: String(row['description'] ?? ''),
    builtin: Number(row['builtin'] ?? 0) === 1,
    sortOrder: Number(row['sort_order'] ?? 0),
    createdAt: String(row['created_at'] ?? ''),
    updatedAt: String(row['updated_at'] ?? ''),
  }
}

/**
 * Open (creating if needed) the workbench database and bring it up to date.
 * @param options - data directory, busy timeout, version, and logger overrides.
 * @returns the open database with a startup report.
 * @throws when the file cannot be opened, is newer than this build, or a migration or upgrade fails.
 */
export function openTeamflowDatabase(options: OpenDatabaseOptions = {}): TeamflowDatabase {
  const log = options.log ?? SILENT_LOGGER
  const version = options.version ?? readPluginVersion()
  const dataDir = resolveDataDir(options.dataDir)
  const file = databaseFile(dataDir)

  try {
    ensureDataDir(dataDir)
  } catch (error) {
    throw contextualError(`cannot create data directory ${toDisplayPath(dataDir)}`, error)
  }

  let db: DatabaseSync
  try {
    db = new DatabaseSync(file)
  } catch (error) {
    throw contextualError(`cannot open database ${toDisplayPath(file)}`, error)
  }

  try {
    configure(db, options.busyTimeoutMs ?? 5_000)
    const appliedMigrations = migrate(db, log)
    syncSchemaComments(db)
    seedBuiltinRoles(db)
    const reconciliation = reconcileVersion(db, version, log)

    const report: StartupReport = {
      file,
      displayFile: toDisplayPath(file),
      fromVersion: reconciliation.fromVersion,
      toVersion: version,
      outcome: reconciliation.outcome,
      firstStart: reconciliation.fromVersion === null,
      appliedMigrations,
      appliedUpgrades: reconciliation.appliedUpgrades,
    }

    switch (report.outcome) {
      case 'initialized':
        log.info(`initialized ${report.displayFile} at version ${version}`)
        break
      case 'unchanged':
        log.info(`ready at version ${version}`)
        break
      case 'upgraded':
        log.info(
          `upgraded ${report.displayFile} from ${report.fromVersion ?? 'unknown'} to ${version} ` +
            `(${report.appliedUpgrades.length} step(s))`,
        )
        break
      case 'downgraded':
        break
    }

    let closed = false
    return {
      file,
      db,
      report,
      workflow: new WorkflowStore(db, {
        docsRoot: options.docsRoot,
        workspaceRoot: options.workspaceRoot,
        warn: (message) => log.warn(message),
      }),
      listRoles() {
        const rows = db.prepare('SELECT * FROM roles ORDER BY sort_order, id').all()
        return rows.map((row) => toRole(row))
      },
      listSchemaComments() {
        const rows = db
          .prepare('SELECT table_name, column_name, description FROM schema_comments ORDER BY table_name, column_name')
          .all()
        return rows.map((row) => ({
          table: String(row['table_name'] ?? ''),
          column: String(row['column_name'] ?? ''),
          description: String(row['description'] ?? ''),
        }))
      },
      close() {
        if (closed) return
        closed = true
        db.close()
      },
    }
  } catch (error) {
    try {
      db.close()
    } catch (closeError) {
      throw new AggregateError(
        [error, closeError],
        `teamflow: startup failed and the database handle could not be closed: ${describeError(error)}`,
      )
    }
    if (error instanceof Error && error.message.startsWith('teamflow:')) throw error
    throw contextualError(`startup failed for ${toDisplayPath(file)}`, error)
  }
}

export { DATABASE_FILENAME, TARGET_SCHEMA_VERSION, withTransaction }
