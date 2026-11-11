/**
 * Host half of the Teamflow plugin: own the durable workbench database and
 * everything the plugin needs to survive a restart.
 *
 * The browser half lives in `./client` and only renders; all durable state is
 * created here so the Web UI never depends on where it is opened.
 *
 * @module
 */
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'

import { TYPERT_MANIFEST } from './remote/contract.ts'
import { WorkbenchService } from './remote/service.ts'
import { openTeamflowDatabase, type FlowLogger, type TeamflowDatabase } from './store/db.ts'

/** Host-side configuration; every deployment-tunable value lives here. */
export interface Config {
  /**
   * Data directory override. Empty uses `$DSH_HOME/xirang-ai/dsh-teamflow`,
   * which is the only location this plugin owns.
   */
  dataDir: string
  /**
   * Document root override. Empty uses `<dataDir>/docs`, next to the database;
   * relative paths resolve against the working directory and `~/` is expanded.
   */
  docsDir: string
  /** SQLite busy timeout in milliseconds; a second instance waits this long for the write lock. */
  busyTimeoutMs: number
}

/** Validated configuration schema; the Host rejects a bad layer before `apply` runs. */
export const Config: Schema<Config> = Schema.object({
  dataDir: Schema.string()
    .default('')
    .description('Workbench data directory. Empty uses $DSH_HOME/xirang-ai/dsh-teamflow.'),
  docsDir: Schema.string()
    .default('')
    .description(
      'Document root for requirement, design, story and bug bodies. Empty uses <dataDir>/docs; relative paths and ~/ are supported.',
    ),
  busyTimeoutMs: Schema.number()
    .min(0)
    .max(60_000)
    .default(5_000)
    .description('SQLite busy timeout in milliseconds.'),
})

/** Plugin name shown in Host diagnostics. */
export const name = 'teamflow'

/**
 * Own the database for the lifetime of the plugin fiber.
 * @param ctx - Host context; the database is provided as the `teamflow` service.
 * @param config - validated plugin configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const logger = ctx.logger('teamflow')
  const log: FlowLogger = {
    info: (message) => logger.info(message),
    warn: (message) => logger.warn(message),
    error: (message) => logger.error(message),
  }

  ctx.effect(() => {
    // Document bodies live below the plugin-owned document root, not the
    // database and not the user's workspace; the panel reads them by
    // `content_path` relative to that one root. The registry stays wired for
    // workspace display only.
    const database: TeamflowDatabase = openTeamflowDatabase({
      dataDir: config.dataDir,
      docsDir: config.docsDir,
      busyTimeoutMs: config.busyTimeoutMs,
      // Resolved lazily: the optional registry may register after this effect runs.
      workspaceRoot: (workspaceId) => ctx.get('workspaceRegistry')?.get(workspaceId)?.path,
      log,
    })
    // Unregisters with this fiber; the handle itself closes in the disposer.
    ctx.provide('teamflow', database)

    // The Typert registry only exists when the Web gateway is composed, and it
    // may activate after this plugin: headless profiles keep the database and
    // the tools and simply have no browser to answer. `ctx.inject` (rather than
    // the static `inject` array) binds to the registry whenever it appears
    // without parking the fiber when it never does.
    let workbench: WorkbenchService | undefined
    ctx.inject(['typert'], (registryCtx) => {
      const typert = registryCtx.get('typert')
      if (typert === undefined) return
      // The service is registered on the plugin's own context, not on the
      // injected one: the Gateway looks it up from its own Context, so a
      // subtree-only service would be invisible to it.
      workbench ??= new WorkbenchService(ctx, database.workflow)
      const dispose = typert.register(TYPERT_MANIFEST)
      log.info('teamflow: workbench remote namespace is mounted')
      return () => {
        dispose()
      }
    })

    return () => {
      database.close()
    }
  }, 'teamflow: workbench database')
}

export type { TeamflowDatabase, StartupReport, Role } from './store/db.ts'
export type { SchemaComment } from './store/schema.ts'
export { WorkflowStore } from './store/workflow.ts'
export { docPath, ensureDocTree, resolveDocPath } from './store/docs.ts'
export { DOCS_DIRNAME, defaultDocsDir, resolveDocsDir } from './store/paths.ts'
export type { DocKind as DocFileKind } from './store/docs.ts'
export type { WorkflowStoreOptions } from './store/workflow.ts'
export { WorkflowError } from './store/model.ts'
export { MAX_DELETE_TARGETS } from './store/workflow.ts'
export type {
  Bug,
  BugSeverity,
  BugStatus,
  DeleteDocRef,
  DeleteOutcome,
  DeletePreview,
  DeletePreviewItem,
  DeleteReport,
  DeleteTarget,
  DeletableKind,
  Requirement,
  RequirementStatus,
  Run,
  RunKind,
  RunStatus,
  SelfTestStatus,
  Story,
  StoryReadiness,
  StorySize,
  StoryStatus,
} from './store/model.ts'
