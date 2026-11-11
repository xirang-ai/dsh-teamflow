/**
 * The requirement → story → run workflow.
 *
 * A requirement carries its outline design (概设) in the same body; detailed
 * design documents and stories hang off it.
 *
 * This module owns the state machine. SQLite constraints protect the shape of a
 * row (known status values, one active run per subject), while the rules below
 * protect the transitions: a story may start as soon as it exists, and a run
 * cannot succeed without a passed self-test. A successful run only marks the
 * subject as executed (`done` / `fixed`); completion is always an explicit user
 * action.
 *
 * Every public mutation runs in one `BEGIN IMMEDIATE` transaction. Helpers that
 * only participate in a transition are suffixed `InTx` and never open their own
 * transaction — nesting would commit the outer unit of work early.
 *
 * @module
 */
import type { DatabaseSync } from 'node:sqlite'

import { isPermissionTier, type PermissionTier } from '../permission-tier.ts'

import {
  docPath,
  dropStagedDoc,
  pruneEmptyDirectories,
  readDoc,
  restoreStagedDoc,
  stageDocDeletion,
  writeDoc,
} from './docs.ts'
import type { DocKind as DocFileKind, StagedDoc } from './docs.ts'
import { newId } from './ids.ts'
import {
  BUG_SEVERITIES,
  BUG_STATUSES,
  DELETABLE_KINDS,
  DOC_KINDS,
  REQUIREMENT_STATUSES,
  RUN_STATUSES,
  STORY_SIZES,
  STORY_STATUSES,
  WorkflowError,
  type Bug,
  type BugFilter,
  type BugSeverity,
  type BugStatus,
  type BoardRows,
  type DeletableKind,
  type DeleteChildRef,
  type DeleteDocRef,
  type DeleteOutcome,
  type DeletePreview,
  type DeletePreviewItem,
  type DeleteReport,
  type DeleteTarget,
  type DiscussionSession,
  type DiscussionSubjectType,
  type CreateBugInput,
  type CreateDesignDocInput,
  type CreateRequirementInput,
  type CreateStoryInput,
  type DesignDoc,
  type DocStoryLink,
  type FinishRunInput,
  type Requirement,
  type RequirementSession,
  type RequirementSessionKind,
  type UpdateDesignDocInput,
  type RequirementFilter,
  type RequirementStatus,
  type Run,
  type RunFilter,
  type StartRunInput,
  type Story,
  type StoryFilter,
  type StoryReadiness,
  type StorySize,
  type StoryStatus,
  type UpdateBugInput,
  type UpdateRequirementInput,
  type UpdateStoryInput,
  type WorkflowErrorCode,
} from './model.ts'
import { describeError } from '../errors.ts'
import { withTransaction } from './transaction.ts'

/**
 * Statuses that guarantee no agent is executing the record.
 *
 * This is deliberately a whitelist rather than `status !== 'in_progress'`:
 * every status the state machine can add in the future is non-deletable until
 * someone decides it means "idle". `story.developing`, `story.self_testing` and
 * `bug.fixing` are the executing states today.
 */
const DELETABLE_STATUSES: Readonly<Record<DeletableKind, readonly string[]>> = {
  story: ['ready', 'done', 'completed', 'cancelled'],
  bug: ['reported', 'fixed', 'completed', 'wontfix'],
  requirement: ['draft', 'completed', 'archived'],
}

/** Cap one batch so a single call cannot scan an unbounded id list. */
export const MAX_DELETE_TARGETS = 50

/** Whether a run still owns its subject. */
function isActiveRun(status: string): boolean {
  return status === 'running' || status === 'self_testing'
}

/**
 * Requirement states in which its stories may still enter development.
 *
 * Only `archived` blocks work: there is no confirmation gate in this product,
 * and a completed requirement can be reopened by developing another story.
 */
function isDevelopable(status: string): boolean {
  return status !== 'archived'
}

/** A row as returned by `node:sqlite`; values are narrowed field by field. */
type Row = Record<string, unknown>

/** Construction options for {@link WorkflowStore}. */
export interface WorkflowStoreOptions {
  /**
   * Absolute document root that holds `requirements/`, `stories/` and
   * `bugs/`. Every body lives here; records only store the root-relative path.
   */
  readonly docsRoot: string
  /** Resolver used before the registry; lets the Host provide the live path. */
  readonly workspaceRoot?: (workspaceId: string) => string | undefined

  /** Clock override for tests; must return an ISO-8601 UTC string. */
  readonly now?: () => string

  /** Where best-effort cleanup failures (staged file leftovers) are reported. */
  readonly warn?: (message: string) => void
}

function text(row: Row, key: string): string {
  const value = row[key]
  return typeof value === 'string' ? value : ''
}

function nullableText(row: Row, key: string): string | null {
  const value = row[key]
  return typeof value === 'string' ? value : null
}

function integer(row: Row, key: string): number {
  const value = row[key]
  return typeof value === 'number' ? value : 0
}

function toRequirement(row: Row): Requirement {
  return {
    id: text(row, 'id'),
    workspaceId: text(row, 'workspace_id'),
    title: text(row, 'title'),
    summary: text(row, 'summary'),
    contentPath: text(row, 'content_path'),
    status: text(row, 'status') as RequirementStatus,
    createdAt: text(row, 'created_at'),
    updatedAt: text(row, 'updated_at'),
    completedAt: nullableText(row, 'completed_at'),
  }
}

function toDesignDoc(row: Row): DesignDoc {
  return {
    id: text(row, 'id'),
    requirementId: text(row, 'requirement_id'),
    kind: text(row, 'kind') as DesignDoc['kind'],
    title: text(row, 'title'),
    contentPath: text(row, 'content_path'),
    sortOrder: integer(row, 'sort_order'),
    createdAt: text(row, 'created_at'),
    updatedAt: text(row, 'updated_at'),
  }
}

function toDiscussionSession(row: Row): DiscussionSession {
  return {
    subjectType: text(row, 'subject_type') as DiscussionSubjectType,
    subjectId: text(row, 'subject_id'),
    sessionId: text(row, 'session_id'),
    kind: text(row, 'kind'),
    preparedAt: nullableText(row, 'prepared_at'),
    linkedAt: nullableText(row, 'linked_at'),
    createdAt: text(row, 'created_at'),
  }
}

function toRequirementSession(row: Row): RequirementSession {
  return {
    requirementId: text(row, 'subject_id'),
    sessionId: text(row, 'session_id'),
    kind: text(row, 'kind') as RequirementSession['kind'],
    preparedAt: nullableText(row, 'prepared_at'),
    linkedAt: nullableText(row, 'linked_at'),
    createdAt: text(row, 'created_at'),
  }
}

function toStory(row: Row): Story {
  return {
    id: text(row, 'id'),
    workspaceId: text(row, 'workspace_id'),
    requirementId: nullableText(row, 'requirement_id'),
    title: text(row, 'title'),
    contentPath: text(row, 'content_path'),
    status: text(row, 'status') as StoryStatus,
    size: text(row, 'size') as StorySize,
    sortOrder: integer(row, 'sort_order'),
    createdAt: text(row, 'created_at'),
    updatedAt: text(row, 'updated_at'),
    doneAt: nullableText(row, 'done_at'),
    completedAt: nullableText(row, 'completed_at'),
    createSessionId: nullableText(row, 'create_session_id'),
  }
}

function toBug(row: Row): Bug {
  return {
    id: text(row, 'id'),
    workspaceId: text(row, 'workspace_id'),
    title: text(row, 'title'),
    contentPath: text(row, 'content_path'),
    severity: text(row, 'severity') as BugSeverity,
    status: text(row, 'status') as BugStatus,
    resolution: text(row, 'resolution'),
    createdAt: text(row, 'created_at'),
    updatedAt: text(row, 'updated_at'),
    fixedAt: nullableText(row, 'fixed_at'),
    completedAt: nullableText(row, 'completed_at'),
    createSessionId: nullableText(row, 'create_session_id'),
  }
}

function toRun(row: Row): Run {
  return {
    id: text(row, 'id'),
    workspaceId: text(row, 'workspace_id'),
    kind: text(row, 'kind') as Run['kind'],
    storyId: nullableText(row, 'story_id'),
    bugId: nullableText(row, 'bug_id'),
    status: text(row, 'status') as Run['status'],
    sessionId: nullableText(row, 'session_id'),
    permissionTier: toPermissionTier(nullableText(row, 'permission_tier')),
    agent: text(row, 'agent'),
    branch: text(row, 'branch'),
    selfTestStatus: text(row, 'self_test_status') as Run['selfTestStatus'],
    selfTestNotes: text(row, 'self_test_notes'),
    summary: text(row, 'summary'),
    startedAt: nullableText(row, 'started_at'),
    finishedAt: nullableText(row, 'finished_at'),
    createdAt: text(row, 'created_at'),
    updatedAt: text(row, 'updated_at'),
  }
}

/**
 * Read the stored tier, tolerating rows written by other builds.
 *
 * The column has a `CHECK` constraint, so an unknown value can only come from a
 * database this build did not write; treating it as "no tier recorded" keeps
 * the header from inventing a badge for it.
 */
function toPermissionTier(value: string | null): PermissionTier | null {
  return isPermissionTier(value) ? value : null
}

function requiredText(value: string | undefined, field: string): string {
  const normalized = (value ?? '').trim()
  if (normalized.length === 0) {
    throw new WorkflowError('invalid_input', `${field} must not be empty`)
  }
  return normalized
}

function optionalText(value: string | undefined): string {
  return (value ?? '').trim()
}

function assertOneOf<T extends string>(value: string, allowed: readonly T[], field: string): T {
  if (!(allowed as readonly string[]).includes(value)) {
    throw new WorkflowError('invalid_input', `${field} must be one of ${allowed.join(', ')}, got "${value}"`)
  }
  return value as T
}

function sizeOf(value: StorySize | undefined): StorySize {
  const candidate = value ?? 'm'
  return assertOneOf(candidate, STORY_SIZES, 'size')
}

/**
 * Display positions are non-negative safe integers; a fractional or negative
 * value would make the order ambiguous or push a row above the first one.
 */
function sortOrderOf(value: number, field = 'sortOrder'): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new WorkflowError('invalid_input', `${field} must be a non-negative integer, got ${String(value)}`)
  }
  return value
}

function severityOf(value: BugSeverity | undefined): BugSeverity {
  const candidate = value ?? 'major'
  return assertOneOf(candidate, BUG_SEVERITIES, 'severity')
}

function notFound(kind: string, id: string): WorkflowError {
  return new WorkflowError('not_found', `${kind} ${id} does not exist`)
}

function invalidTransition(kind: string, id: string, from: string, action: string): WorkflowError {
  return new WorkflowError('invalid_transition', `cannot ${action} ${kind} ${id} while it is ${from}`)
}

/**
 * Read/write facade over the workflow tables.
 *
 * A store is cheap: it holds the host's `DatabaseSync` handle and a clock, and
 * never owns the connection (the plugin's effect disposer closes it).
 */
export class WorkflowStore {
  readonly #db: DatabaseSync
  readonly #now: () => string
  readonly #docsRoot: string
  readonly #workspaceRoot: (workspaceId: string) => string | undefined
  readonly #warn: (message: string) => void

  constructor(db: DatabaseSync, options: WorkflowStoreOptions) {
    this.#db = db
    this.#now = options.now ?? (() => new Date().toISOString())
    this.#docsRoot = options.docsRoot
    this.#workspaceRoot = options.workspaceRoot ?? (() => undefined)
    this.#warn = options.warn ?? (() => {})
  }

  /**
   * Remember where a workspace lives on disk. Document bodies no longer live
   * there, but the path is still recorded for display and for future
   * workspace-scoped features; repeated calls with the same path are no-ops.
   */
  registerWorkspace(workspaceId: string, path: string): void {
    const id = requiredText(workspaceId, 'workspaceId')
    const root = requiredText(path, 'path')
    const now = this.#now()
    this.#db
      .prepare(
        `INSERT INTO workspaces (workspace_id, path, created_at, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(workspace_id) DO UPDATE SET path = excluded.path, updated_at = excluded.updated_at`,
      )
      .run(id, root, now, now)
  }

  /** Directory a registered workspace lives in, or null when unknown. */
  workspacePath(workspaceId: string): string | null {
    const row = this.#db.prepare('SELECT path FROM workspaces WHERE workspace_id = ?').get(workspaceId)
    if (row !== undefined) return text(row, 'path')
    return this.#workspaceRoot(workspaceId) ?? null
  }

  /**
   * Read a document body by its document-root-relative path.
   *
   * `null` means the file does not exist; `''` means it exists and is empty.
   * Every record resolves against the one configured document root, so a
   * legacy path simply misses instead of falling back to a workspace.
   */
  readContent(relativePath: string): string | null {
    return readDoc(this.#docsRoot, relativePath)
  }

  /** Rewrite a document body; the path comes from the row, so it is always current. */
  writeContent(relativePath: string, body: string): void {
    writeDoc(this.#docsRoot, relativePath, body)
  }

  /**
   * Write one entity's body to its canonical path and return that path.
   * Empty bodies still create the file so the address in the database resolves.
   */
  #persistDoc(
    kind: DocFileKind,
    ids: { id: string; requirementId?: string },
    body: string,
  ): string {
    const relative = docPath(kind, ids)
    writeDoc(this.#docsRoot, relative, body)
    return relative
  }

  // ---------------------------------------------------------------- queries

  getRequirement(id: string): Requirement | null {
    const row = this.#db.prepare('SELECT * FROM requirements WHERE id = ?').get(id)
    return row === undefined ? null : toRequirement(row)
  }

  listRequirements(filter: RequirementFilter = {}): Requirement[] {
    const clauses: string[] = []
    const values: string[] = []
    if (filter.workspaceId !== undefined) {
      clauses.push('workspace_id = ?')
      values.push(filter.workspaceId)
    }
    if (filter.status !== undefined) {
      clauses.push('status = ?')
      values.push(assertOneOf(filter.status, REQUIREMENT_STATUSES, 'status'))
    }
    const where = clauses.length === 0 ? '' : ` WHERE ${clauses.join(' AND ')}`
    const rows = this.#db
      .prepare(`SELECT * FROM requirements${where} ORDER BY created_at DESC, id`)
      .all(...values)
    return rows.map((row) => toRequirement(row))
  }

  /**
   * Register a browser-created session as a pending discussion for a requirement.
   *
   * Kept as a thin wrapper over {@link prepareDiscussionSession} so the
   * requirement page and its tests keep their existing shape.
   */
  prepareRequirementSession(
    requirementId: string,
    sessionId: string,
    kind: RequirementSessionKind = 'design',
  ): RequirementSession {
    const session = this.prepareDiscussionSession('requirement', requirementId, sessionId, kind)
    return {
      requirementId: session.subjectId,
      sessionId: session.sessionId,
      kind: session.kind as RequirementSessionKind,
      preparedAt: session.preparedAt,
      linkedAt: session.linkedAt,
      createdAt: session.createdAt,
    }
  }

  /**
   * Register a browser-created session as a pending discussion for a subject.
   *
   * The browser creates the session first, then calls this before the user can
   * send the first message. The row stays invisible in `listBoard` until the
   * Agent confirms it through `teamflow_link_session`; this method never writes
   * `linked_at`, so the client cannot skip Agent confirmation.
   */
  prepareDiscussionSession(
    subjectType: DiscussionSubjectType,
    subjectId: string,
    sessionId: string,
    kind: string,
  ): DiscussionSession {
    if (subjectType !== 'requirement' && subjectType !== 'story' && subjectType !== 'bug') {
      throw new WorkflowError(
        'invalid_input',
        `prepareDiscussionSession 参数非法：subjectType=${String(subjectType)}，期望 requirement|story|bug`,
      )
    }
    const subject = (subjectId ?? '').trim()
    if (subject.length === 0) {
      throw new WorkflowError('invalid_input', 'prepareDiscussionSession 参数非法：subjectId 为空')
    }
    const session = (sessionId ?? '').trim()
    if (session.length === 0) {
      throw new WorkflowError('invalid_input', 'prepareDiscussionSession 参数非法：sessionId 为空')
    }
    const discussionKind = (kind ?? '').trim()
    if (discussionKind.length === 0) {
      throw new WorkflowError('invalid_input', 'prepareDiscussionSession 参数非法：kind 为空')
    }
    if (
      subjectType === 'requirement' &&
      discussionKind !== 'design' &&
      discussionKind !== 'detail' &&
      discussionKind !== 'split'
    ) {
      throw new WorkflowError(
        'invalid_input',
        `kind must be design, detail or split, got ${String(kind)}`,
      )
    }
    return withTransaction(this.#db, () => {
      this.#requireSubject(subjectType, subject)
      const rows = this.#db
        .prepare('SELECT * FROM discussion_sessions WHERE session_id = ?')
        .all(session) as Row[]
      if (rows.length > 1) {
        throw new WorkflowError(
          'invalid_input',
          `session ${session} is already bound to ${rows.length} discussions`,
        )
      }
      const existing = rows[0]
      if (existing !== undefined) {
        const row = toDiscussionSession(existing)
        if (row.subjectType !== subjectType || row.subjectId !== subject) {
          throw new WorkflowError(
            'invalid_input',
            `session ${session} already belongs to ${row.subjectType} ${row.subjectId}`,
          )
        }
        if (row.kind === 'create') {
          throw new WorkflowError(
            'invalid_input',
            `session ${session} created its requirement, so it cannot also be a discussion`,
          )
        }
        if (row.kind !== discussionKind) {
          throw new WorkflowError(
            'invalid_input',
            `session ${session} is already prepared as a ${row.kind} discussion`,
          )
        }
        // Repeated prepares keep the original timestamp; only the first write
        // records when the browser started the conversation.
        return row
      }
      const now = this.#now()
      this.#db
        .prepare(
          `INSERT INTO discussion_sessions
             (subject_type, subject_id, session_id, kind, prepared_at, linked_at, created_at)
           VALUES (?, ?, ?, ?, ?, NULL, ?)
           ON CONFLICT (subject_type, subject_id, session_id)
           DO UPDATE SET prepared_at = excluded.prepared_at`,
        )
        .run(subjectType, subject, session, discussionKind, now, now)
      return this.#requireDiscussionSession(session, subjectType, subject)
    })
  }

  /**
   * Confirm the current session as the discussion it was prepared for.
   *
   * Called by `teamflow_link_session`; repeated calls are idempotent so a model
   * retry cannot rewrite the confirmation time.
   */
  linkDiscussionSession(sessionId: string): DiscussionSession {
    return withTransaction(this.#db, () => {
      const session = requiredText(sessionId, 'sessionId')
      const rows = this.#db
        .prepare('SELECT * FROM discussion_sessions WHERE session_id = ?')
        .all(session) as Row[]
      if (rows.length === 0) {
        throw new WorkflowError(
          'not_found',
          `teamflow_link_session 未能登记：当前会话 ${session} 没有与任何需求、故事或缺陷绑定`,
        )
      }
      if (rows.length > 1) {
        throw new WorkflowError(
          'invalid_input',
          `teamflow_link_session 未能登记：数据异常：当前会话 ${session} 绑定到 ${rows.length} 个对象`,
        )
      }
      const current = toDiscussionSession(rows[0] as Row)
      if (current.kind === 'create') {
        throw new WorkflowError(
          'invalid_input',
          `session ${session} created a requirement and is not a discussion`,
        )
      }
      if (current.linkedAt !== null) return current
      this.#db
        .prepare(
          `UPDATE discussion_sessions SET linked_at = ?
            WHERE subject_type = ? AND subject_id = ? AND session_id = ?`,
        )
        .run(this.#now(), current.subjectType, current.subjectId, session)
      return this.#requireDiscussionSession(session, current.subjectType, current.subjectId)
    })
  }

  /**
   * Confirm the current session as a requirement discussion.
   *
   * Kept for `teamflow_link_requirement_session`; new callers use
   * {@link linkDiscussionSession}.
   */
  linkRequirementSession(sessionId: string): RequirementSession {
    return withTransaction(this.#db, () => {
      const session = requiredText(sessionId, 'sessionId')
      const current = this.#requireRequirementSession(session)
      if (current.kind === 'create') {
        throw new WorkflowError(
          'invalid_input',
          `session ${session} created a requirement and is not a discussion`,
        )
      }
      if (current.linkedAt !== null) return current
      this.#db
        .prepare(
          "UPDATE discussion_sessions SET linked_at = ? WHERE subject_type = 'requirement' AND session_id = ? AND kind IN ('design','detail','split')",
        )
        .run(this.#now(), session)
      return this.#requireRequirementSession(session)
    })
  }

  /** Pending or linked requirement conversation prepared for one session, or null. */
  getRequirementSession(sessionId: string): RequirementSession | null {
    const row = this.#db
      .prepare("SELECT * FROM discussion_sessions WHERE subject_type = 'requirement' AND session_id = ?")
      .get(sessionId)
    return row === undefined ? null : toRequirementSession(row)
  }

  /** The requirement linked to a session, whichever kind of link it is. */
  getRequirementBySession(sessionId: string): Requirement | null {
    const row = this.#db
      .prepare("SELECT subject_id FROM discussion_sessions WHERE subject_type = 'requirement' AND session_id = ?")
      .get(sessionId)
    return row === undefined ? null : this.getRequirement(text(row, 'subject_id'))
  }

  /** The discussion row bound to one session, or null when none exists. */
  getDiscussionSession(sessionId: string): DiscussionSession | null {
    const rows = this.#db
      .prepare('SELECT * FROM discussion_sessions WHERE session_id = ?')
      .all(sessionId) as Row[]
    return rows.length === 1 ? toDiscussionSession(rows[0] as Row) : null
  }

  /**
   * Discussions under one subject, newest linked first.
   *
   * Pending rows are excluded by default so the workbench never shows a session
   * the Agent has not started; tests and diagnostics can opt in.
   */
  listDiscussionSessions(
    subjectType: DiscussionSubjectType,
    subjectId: string,
    options: { readonly includeUnlinked?: boolean; readonly kinds?: readonly string[] } = {},
  ): DiscussionSession[] {
    const values: string[] = [subjectType, subjectId]
    let kindsClause = ''
    if (options.kinds !== undefined && options.kinds.length > 0) {
      kindsClause = ` AND kind IN (${options.kinds.map(() => '?').join(',')})`
      values.push(...options.kinds)
    }
    const rows = this.#db
      .prepare(
        `SELECT * FROM discussion_sessions
          WHERE subject_type = ? AND subject_id = ?
            AND (linked_at IS NOT NULL OR ? = 1)${kindsClause}
          ORDER BY COALESCE(linked_at, prepared_at, created_at) DESC, session_id`,
      )
      .all(...values.slice(0, 2), options.includeUnlinked === true ? 1 : 0, ...values.slice(2)) as Row[]
    return rows.map(toDiscussionSession)
  }

  /**
   * Requirement conversations under one requirement, newest linked first.
   *
   * The `create` row is always included: it explains where the requirement came
   * from even though the Agent never confirms it.
   */
  listRequirementSessions(
    requirementId: string,
    options: { readonly includePending?: boolean } = {},
  ): RequirementSession[] {
    this.#requireRequirement(requirementId)
    const rows = this.#db
      .prepare(
        `SELECT * FROM discussion_sessions
          WHERE subject_type = 'requirement' AND subject_id = ?
            AND (kind = 'create' OR linked_at IS NOT NULL OR ? = 1)
          ORDER BY kind, COALESCE(linked_at, prepared_at, created_at) DESC, session_id`,
      )
      .all(requirementId, options.includePending === true ? 1 : 0) as Row[]
    return rows.map(toRequirementSession)
  }

  getStory(id: string): Story | null {
    const row = this.#db.prepare('SELECT * FROM stories WHERE id = ?').get(id)
    return row === undefined ? null : toStory(row)
  }

  listStories(filter: StoryFilter = {}): Story[] {
    const clauses: string[] = []
    const values: string[] = []
    if (filter.workspaceId !== undefined) {
      clauses.push('workspace_id = ?')
      values.push(filter.workspaceId)
    }
    if (filter.status !== undefined) {
      clauses.push('status = ?')
      values.push(assertOneOf(filter.status, STORY_STATUSES, 'status'))
    }
    if (filter.requirementId !== undefined) {
      clauses.push('requirement_id = ?')
      values.push(filter.requirementId)
    }
    const where = clauses.length === 0 ? '' : ` WHERE ${clauses.join(' AND ')}`
    // Inside one requirement the explicit display order wins so the Agent reads
    // stories in the same order as the requirement page; a workspace-wide
    // listing keeps newest-first, where a position under a parent means nothing.
    const orderBy =
      filter.requirementId === undefined ? 'created_at DESC, id' : 'sort_order, created_at, id'
    const rows = this.#db
      .prepare(`SELECT * FROM stories${where} ORDER BY ${orderBy}`)
      .all(...values)
    return rows.map((row) => toStory(row))
  }

  getBug(id: string): Bug | null {
    const row = this.#db.prepare('SELECT * FROM bugs WHERE id = ?').get(id)
    return row === undefined ? null : toBug(row)
  }

  listBugs(filter: BugFilter = {}): Bug[] {
    const clauses: string[] = []
    const values: string[] = []
    if (filter.workspaceId !== undefined) {
      clauses.push('workspace_id = ?')
      values.push(filter.workspaceId)
    }
    if (filter.status !== undefined) {
      clauses.push('status = ?')
      values.push(assertOneOf(filter.status, BUG_STATUSES, 'status'))
    }
    const where = clauses.length === 0 ? '' : ` WHERE ${clauses.join(' AND ')}`
    const rows = this.#db
      .prepare(`SELECT * FROM bugs${where} ORDER BY created_at DESC, id`)
      .all(...values)
    return rows.map((row) => toBug(row))
  }

  getRun(id: string): Run | null {
    const row = this.#db.prepare('SELECT * FROM runs WHERE id = ?').get(id)
    return row === undefined ? null : toRun(row)
  }

  /**
   * Read the permission tier a conversation was started with.
   *
   * The run row is the workbench's own record, so this answers for every
   * session the execution entries created — and only for those: a conversation
   * that never went through them has no row and therefore no tier, which is
   * what keeps old sessions from being labelled "普通" by accident.
   * @param sessionId - conversation id the header is showing.
   * @returns the newest recorded tier, or null when none was recorded.
   */
  permissionTierOfSession(sessionId: string): PermissionTier | null {
    if (sessionId.trim().length === 0) return null
    const row = this.#db
      .prepare(
        `SELECT permission_tier FROM runs
          WHERE session_id = ? AND permission_tier IS NOT NULL
          ORDER BY created_at DESC, id DESC
          LIMIT 1`,
      )
      .get(sessionId)
    return row === undefined ? null : toPermissionTier(nullableText(row, 'permission_tier'))
  }

  listRuns(filter: RunFilter = {}): Run[] {
    const clauses: string[] = []
    const values: string[] = []
    if (filter.storyId !== undefined) {
      clauses.push('story_id = ?')
      values.push(filter.storyId)
    }
    if (filter.bugId !== undefined) {
      clauses.push('bug_id = ?')
      values.push(filter.bugId)
    }
    if (filter.status !== undefined) {
      clauses.push('status = ?')
      values.push(assertOneOf(filter.status, RUN_STATUSES, 'status'))
    }
    const where = clauses.length === 0 ? '' : ` WHERE ${clauses.join(' AND ')}`
    const rows = this.#db
      .prepare(`SELECT * FROM runs${where} ORDER BY created_at DESC, id`)
      .all(...values)
    return rows.map((row) => toRun(row))
  }

  /** Whether one story's requirement allows development. */
  getStoryReadiness(storyId: string): StoryReadiness {
    this.#requireStory(storyId)
    return this.#computeReadiness(storyId)
  }

  /**
   * Read every row the workbench panel shows, in panel order.
   *
   * Ordering is part of this method's contract rather than a view concern:
   * running work is pinned above queued work, and within a group the most
   * recently touched row comes first. Doing it in SQL means both clients see
   * one order and the browser never sorts a view it cannot see all of.
   */
  listBoard(): BoardRows {
    const requirements = this.#db
      .prepare(
        `SELECT r.* FROM requirements AS r
         ORDER BY
           EXISTS (
             SELECT 1 FROM stories AS s
             WHERE s.requirement_id = r.id AND s.status IN ('developing', 'self_testing')
           ) DESC,
           r.updated_at DESC,
           r.id`,
      )
      .all() as Row[]
    const stories = this.#db
      .prepare(
        `SELECT * FROM stories
         ORDER BY (status IN ('developing', 'self_testing')) DESC, updated_at DESC, id`,
      )
      .all() as Row[]
    const bugs = this.#db
      .prepare("SELECT * FROM bugs ORDER BY (status = 'fixing') DESC, updated_at DESC, id")
      .all() as Row[]
    const runs = this.#db.prepare('SELECT * FROM runs ORDER BY created_at DESC, id').all() as Row[]
    const docs = this.#db
      .prepare('SELECT * FROM design_docs ORDER BY sort_order, created_at, rowid')
      .all() as Row[]
    const docStories = this.#db
      .prepare('SELECT doc_id, story_id FROM design_doc_stories ORDER BY doc_id, created_at, story_id')
      .all() as Row[]
    const requirementSessions = this.#db
      .prepare(
        `SELECT * FROM discussion_sessions
          WHERE subject_type = 'requirement' AND (kind = 'create' OR linked_at IS NOT NULL)
          ORDER BY COALESCE(linked_at, created_at) DESC, session_id`,
      )
      .all() as Row[]
    const discussionSessions = this.#db
      .prepare(
        `SELECT * FROM discussion_sessions
          WHERE subject_type IN ('story', 'bug') AND linked_at IS NOT NULL
          ORDER BY COALESCE(linked_at, prepared_at, created_at) DESC, session_id`,
      )
      .all() as Row[]

    return {
      requirements: requirements.map(toRequirement),
      stories: stories.map(toStory),
      bugs: bugs.map(toBug),
      runs: runs.map(toRun),
      docs: docs.map(toDesignDoc),
      docStories: docStories.map(
        (row): DocStoryLink => ({ docId: text(row, 'doc_id'), storyId: text(row, 'story_id') }),
      ),
      requirementSessions: requirementSessions.map(toRequirementSession),
      discussionSessions: discussionSessions.map(toDiscussionSession),
    }
  }

  /** One detailed-design document by id, or null when it does not exist. */
  getDesignDoc(id: string): DesignDoc | null {
    const row = this.#db.prepare('SELECT * FROM design_docs WHERE id = ?').get(id)
    return row === undefined ? null : toDesignDoc(row)
  }

  // ----------------------------------------------------------- requirements

  createRequirement(input: CreateRequirementInput): Requirement {
    return withTransaction(this.#db, () => {
      const now = this.#now()
      const id = newId('requirement')
      const workspaceId = requiredText(input.workspaceId, 'workspaceId')
      const contentPath = this.#persistDoc('requirement', { id }, optionalText(input.content))
      const requirement: Requirement = {
        id,
        workspaceId,
        title: requiredText(input.title, 'title'),
        summary: optionalText(input.summary),
        contentPath,
        status: 'draft',
        createdAt: now,
        updatedAt: now,
        completedAt: null,
      }
      this.#db
        .prepare(
          `INSERT INTO requirements
             (id, workspace_id, title, summary, content_path, status,
              created_at, updated_at, completed_at)
           VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, NULL)`,
        )
        .run(
          requirement.id,
          requirement.workspaceId,
          requirement.title,
          requirement.summary,
          requirement.contentPath,
          requirement.createdAt,
          requirement.updatedAt,
        )
      const sessionId = optionalText(input.sessionId)
      if (sessionId.length > 0) this.#bindRequirementSessionInTx(requirement.id, sessionId, now)
      return requirement
    })
  }

  /**
   * Record the session that created a requirement.
   *
   * The create tool passes its own session id so the requirement and its
   * conversation are written in one transaction. A session can only create one
   * requirement; binding it to a second row is rejected instead of silently
   * overwriting the first link.
   */
  bindRequirementSession(requirementId: string, sessionId: string): RequirementSession {
    return withTransaction(this.#db, () => {
      const requirement = this.#requireRequirement(requirementId)
      return this.#bindRequirementSessionInTx(
        requirement.id,
        requiredText(sessionId, 'sessionId'),
        this.#now(),
      )
    })
  }

  updateRequirement(id: string, input: UpdateRequirementInput): Requirement {
    return withTransaction(this.#db, () => {
      const current = this.#requireRequirement(id)
      if (current.status === 'archived') {
        throw invalidTransition('requirement', id, current.status, 'update')
      }
      return this.#patchRequirement(current, input)
    })
  }

  /**
   * Mark the requirement complete. This is a user decision from the detail
   * page, never an automatic transition: changing a requirement afterwards
   * stays possible and does not reopen or re-complete it by itself.
   */
  completeRequirement(id: string): Requirement {
    return withTransaction(this.#db, () => {
      const requirement = this.#requireRequirement(id)
      if (requirement.status === 'archived') {
        throw invalidTransition('requirement', id, requirement.status, 'complete')
      }
      if (requirement.status === 'completed') return requirement
      const now = this.#now()
      this.#db
        .prepare(
          "UPDATE requirements SET status = 'completed', completed_at = ?, updated_at = ? WHERE id = ?",
        )
        .run(now, now, id)
      return this.#requireRequirement(id)
    })
  }

  archiveRequirement(id: string): Requirement {
    return withTransaction(this.#db, () => {
      const requirement = this.#requireRequirement(id)
      if (requirement.status === 'archived') {
        throw invalidTransition('requirement', id, requirement.status, 'archive')
      }
      const now = this.#now()
      this.#db
        .prepare("UPDATE requirements SET status = 'archived', updated_at = ? WHERE id = ?")
        .run(now, id)
      return this.#requireRequirement(id)
    })
  }

  // --------------------------------------------------------- design documents

  /**
   * Documents of one requirement, ordered for reading.
   *
   * The requirement body is the outline and stays short; its documents hold the
   * long parts. This is where the workbench gets its 详细设计 rows.
   */
  listDesignDocs(requirementId: string): DesignDoc[] {
    this.#requireRequirement(requirementId)
    const rows = this.#db
      .prepare(
        'SELECT * FROM design_docs WHERE requirement_id = ? ORDER BY sort_order, created_at, rowid',
      )
      .all(requirementId) as Row[]
    return rows.map(toDesignDoc)
  }

  /** Create one document under a requirement; archived requirements accept no new docs. */
  createDesignDoc(input: CreateDesignDocInput): DesignDoc {
    return withTransaction(this.#db, () => {
      const requirement = this.#requireRequirement(input.requirementId)
      if (requirement.status === 'archived') {
        throw invalidTransition('requirement', requirement.id, requirement.status, 'add a document to')
      }
      const now = this.#now()
      const id = newId('designDoc')
      const contentPath = this.#persistDoc(
        'designDoc',
        { id, requirementId: requirement.id },
        optionalText(input.content),
      )
      const doc: DesignDoc = {
        id,
        requirementId: requirement.id,
        kind: assertOneOf(input.kind ?? 'flow', DOC_KINDS, 'kind'),
        title: requiredText(input.title, 'title'),
        contentPath,
        sortOrder:
          input.sortOrder === undefined
            ? this.#nextSortOrder('design_docs', requirement.id)
            : sortOrderOf(input.sortOrder),
        createdAt: now,
        updatedAt: now,
      }
      this.#db
        .prepare(
          `INSERT INTO design_docs (id, requirement_id, kind, title, content_path, sort_order, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          doc.id,
          doc.requirementId,
          doc.kind,
          doc.title,
          doc.contentPath,
          doc.sortOrder,
          doc.createdAt,
          doc.updatedAt,
        )

      for (const storyId of input.storyIds ?? []) {
        this.#linkDocStoryInTx(doc.id, requirement.id, storyId, now)
      }
      return doc
    })
  }

  /** Update a document's title, kind, body or order. */
  updateDesignDoc(id: string, input: UpdateDesignDocInput): DesignDoc {
    return withTransaction(this.#db, () => {
      const current = this.#requireDesignDoc(id)
      if (input.content !== undefined) {
        writeDoc(this.#docsRoot, current.contentPath, optionalText(input.content))
      }
      const next: DesignDoc = {
        ...current,
        kind: input.kind === undefined ? current.kind : assertOneOf(input.kind, DOC_KINDS, 'kind'),
        title: input.title === undefined ? current.title : requiredText(input.title, 'title'),
        sortOrder: input.sortOrder === undefined ? current.sortOrder : sortOrderOf(input.sortOrder),
        updatedAt: this.#now(),
      }
      this.#db
        .prepare('UPDATE design_docs SET kind = ?, title = ?, sort_order = ?, updated_at = ? WHERE id = ?')
        .run(next.kind, next.title, next.sortOrder, next.updatedAt, id)
      return next
    })
  }

  /** stories a document covers, in story order. */
  listDocStoryIds(docId: string): string[] {
    this.#requireDesignDoc(docId)
    const rows = this.#db
      .prepare(
        `SELECT s.id AS id FROM design_doc_stories l
           JOIN stories s ON s.id = l.story_id
          WHERE l.doc_id = ?
          ORDER BY s.created_at, s.id`,
      )
      .all(docId) as Row[]
    return rows.map((row) => text(row, 'id'))
  }

  /** Documents that explicitly cover one story, in document order. */
  listStoryDesignDocs(storyId: string): DesignDoc[] {
    this.#requireStory(storyId)
    const rows = this.#db
      .prepare(
        `SELECT d.* FROM design_doc_stories l
           JOIN design_docs d ON d.id = l.doc_id
          WHERE l.story_id = ?
          ORDER BY d.sort_order, d.created_at, d.rowid`,
      )
      .all(storyId) as Row[]
    return rows.map(toDesignDoc)
  }

  /** Link a document to a story of the same requirement; linking twice is a no-op. */
  linkDocStory(docId: string, storyId: string): void {
    withTransaction(this.#db, () => {
      const doc = this.#requireDesignDoc(docId)
      this.#linkDocStoryInTx(docId, doc.requirementId, storyId, this.#now())
    })
  }

  #linkDocStoryInTx(docId: string, requirementId: string, storyId: string, now: string): void {
    const story = this.#requireStory(storyId)
    if (story.requirementId !== requirementId) {
      throw new WorkflowError(
        'invalid_input',
        `story ${storyId} does not belong to requirement ${requirementId}, so it cannot be covered by that requirement's document`,
      )
    }
    this.#db
      .prepare(
        `INSERT INTO design_doc_stories (doc_id, story_id, created_at) VALUES (?, ?, ?)
         ON CONFLICT(doc_id, story_id) DO NOTHING`,
      )
      .run(docId, storyId, now)
  }

  /**
   * Next display position under one parent: the current maximum + 1, so a new
   * row lands at the end and existing rows keep their place. Standalone stories
   * share the parent-less group (`requirement_id IS NULL`).
   */
  #nextSortOrder(table: 'stories' | 'design_docs', requirementId: string | null): number {
    const row =
      requirementId === null
        ? this.#db
            .prepare(`SELECT MAX(sort_order) AS max FROM ${table} WHERE requirement_id IS NULL`)
            .get()
        : this.#db
            .prepare(`SELECT MAX(sort_order) AS max FROM ${table} WHERE requirement_id = ?`)
            .get(requirementId)
    const max = row?.['max']
    return typeof max === 'number' && Number.isSafeInteger(max) && max >= 0 ? max + 1 : 1
  }

  #requireDesignDoc(id: string): DesignDoc {
    const row = this.#db.prepare('SELECT * FROM design_docs WHERE id = ?').get(id) as Row | undefined
    if (row === undefined) {
      throw new WorkflowError('not_found', `design document ${id} does not exist`)
    }
    return toDesignDoc(row)
  }

  // ----------------------------------------------------------------- stories

  /**
   * Create a story. A story is developable as soon as it exists: the parent
   * only contributes its workspace and must not be archived.
   */
  createStory(input: CreateStoryInput): Story {
    return withTransaction(this.#db, () => {
      let workspaceId: string | null = null
      let requirementId: string | null = null

      if (input.requirementId !== undefined) {
        const requirement = this.#requireRequirement(input.requirementId)
        if (requirement.status === 'archived') {
          throw invalidTransition('requirement', requirement.id, requirement.status, 'create a story under')
        }
        requirementId = requirement.id
        workspaceId = requirement.workspaceId
      }

      const storyWorkspaceId =
        workspaceId === null
          ? requiredText(input.workspaceId, 'workspaceId')
          : this.#inheritWorkspace(input.workspaceId, workspaceId, 'story')

      const now = this.#now()
      const id = newId('story')
      const contentPath = this.#persistDoc('story', { id }, optionalText(input.content))
      const sessionId = optionalText(input.sessionId)
      const story: Story = {
        id,
        workspaceId: storyWorkspaceId,
        requirementId,
        title: requiredText(input.title, 'title'),
        contentPath,
        status: 'ready',
        size: sizeOf(input.size),
        sortOrder:
          input.sortOrder === undefined
            ? this.#nextSortOrder('stories', requirementId)
            : sortOrderOf(input.sortOrder),
        createdAt: now,
        updatedAt: now,
        doneAt: null,
        completedAt: null,
        createSessionId: sessionId.length === 0 ? null : sessionId,
      }
      this.#db
        .prepare(
          `INSERT INTO stories
             (id, workspace_id, requirement_id, title, content_path,
              status, size, sort_order, created_at, updated_at, done_at, completed_at,
              create_session_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)`,
        )
        .run(
          story.id,
          story.workspaceId,
          story.requirementId,
          story.title,
          story.contentPath,
          story.status,
          story.size,
          story.sortOrder,
          story.createdAt,
          story.updatedAt,
          story.createSessionId,
        )
      return story
    })
  }

  updateStory(id: string, input: UpdateStoryInput): Story {
    return withTransaction(this.#db, () => {
      const current = this.#requireStory(id)
      if (current.status === 'developing' || current.status === 'self_testing') {
        throw invalidTransition('story', id, current.status, 'update')
      }
      const now = this.#now()
      const title = input.title === undefined ? current.title : requiredText(input.title, 'title')
      const size = input.size === undefined ? current.size : sizeOf(input.size)
      const sortOrder = input.sortOrder === undefined ? current.sortOrder : sortOrderOf(input.sortOrder)
      if (input.content !== undefined) {
        writeDoc(this.#docsRoot, current.contentPath, optionalText(input.content))
      }
      this.#db
        .prepare('UPDATE stories SET title = ?, size = ?, sort_order = ?, updated_at = ? WHERE id = ?')
        .run(title, size, sortOrder, now, id)
      return this.#requireStory(id)
    })
  }

  /**
   * Confirm that a story is complete. Only the user does this, after a run has
   * finished (`done`); a successful run never completes the story itself.
   */
  completeStory(id: string): Story {
    return withTransaction(this.#db, () => {
      const story = this.#requireStory(id)
      if (story.status !== 'done') {
        throw invalidTransition('story', id, story.status, 'complete')
      }
      const now = this.#now()
      this.#db
        .prepare("UPDATE stories SET status = 'completed', completed_at = ?, updated_at = ? WHERE id = ?")
        .run(now, now, id)
      // Completing the last story is a user action that also finishes the
      // requirement; it is the only automatic requirement transition, and it
      // never happens on a successful run.
      if (story.requirementId !== null) this.#completeRequirementIfAllStoriesDone(story.requirementId, now)
      return this.#requireStory(id)
    })
  }

  /** Drop a story that has not entered development. */
  cancelStory(id: string): Story {
    return withTransaction(this.#db, () => {
      const story = this.#requireStory(id)
      if (story.status !== 'ready') {
        throw invalidTransition('story', id, story.status, 'cancel')
      }
      const now = this.#now()
      this.#db.prepare("UPDATE stories SET status = 'cancelled', updated_at = ? WHERE id = ?").run(now, id)
      return this.#requireStory(id)
    })
  }

  // ------------------------------------------------------------- development

  /** Start development for a ready story, or reject with the blocking reason. */
  startStoryRun(storyId: string, input: StartRunInput = {}): Run {
    return withTransaction(this.#db, () => {
      const story = this.#requireStory(storyId)
      // A concurrent attempt is the more actionable error, so check it before
      // the status (which is `developing` precisely because that run exists).
      this.#assertNoActiveRun('story', storyId)
      if (story.status !== 'ready' && story.status !== 'done' && story.status !== 'completed') {
        throw invalidTransition('story', storyId, story.status, 'start development on')
      }
      if (!this.#computeReadiness(storyId).ready) {
        throw new WorkflowError(
          'invalid_transition',
          `story ${storyId} cannot start because its requirement is archived`,
        )
      }
      const now = this.#now()
      const run: Run = {
        id: newId('run'),
        workspaceId: story.workspaceId,
        kind: 'story_dev',
        storyId,
        bugId: null,
        status: 'running',
        sessionId: input.sessionId === undefined ? null : requiredText(input.sessionId, 'sessionId'),
        permissionTier: input.permissionTier ?? null,
        agent: optionalText(input.agent),
        branch: optionalText(input.branch),
        selfTestStatus: 'not_run',
        selfTestNotes: '',
        summary: '',
        startedAt: now,
        finishedAt: null,
        createdAt: now,
        updatedAt: now,
      }
      this.#db
        .prepare(
          `INSERT INTO runs
             (id, workspace_id, kind, story_id, bug_id, status, session_id, permission_tier,
              agent, branch, self_test_status, self_test_notes, summary, started_at, finished_at,
              created_at, updated_at)
           VALUES (?, ?, 'story_dev', ?, NULL, 'running', ?, ?, ?, ?, 'not_run', '', '', ?, NULL, ?, ?)`,
        )
        .run(
          run.id,
          run.workspaceId,
          storyId,
          run.sessionId,
          run.permissionTier,
          run.agent,
          run.branch,
          run.startedAt,
          run.createdAt,
          run.updatedAt,
        )
      this.#db
        .prepare(
          "UPDATE stories SET status = 'developing', done_at = NULL, completed_at = NULL, updated_at = ? WHERE id = ?",
        )
        .run(now, storyId)
      return run
    })
  }

  /** Start a fix attempt; a finished or completed defect can be fixed again. */
  startBugFixRun(bugId: string, input: StartRunInput = {}): Run {
    return withTransaction(this.#db, () => {
      const bug = this.#requireBug(bugId)
      if (bug.status !== 'reported' && bug.status !== 'fixed' && bug.status !== 'completed') {
        throw invalidTransition('bug', bugId, bug.status, 'start a fix for')
      }
      this.#assertNoActiveRun('bug', bugId)
      const now = this.#now()
      const run: Run = {
        id: newId('run'),
        workspaceId: bug.workspaceId,
        kind: 'bug_fix',
        storyId: null,
        bugId,
        status: 'running',
        sessionId: input.sessionId === undefined ? null : requiredText(input.sessionId, 'sessionId'),
        permissionTier: input.permissionTier ?? null,
        agent: optionalText(input.agent),
        branch: optionalText(input.branch),
        selfTestStatus: 'not_run',
        selfTestNotes: '',
        summary: '',
        startedAt: now,
        finishedAt: null,
        createdAt: now,
        updatedAt: now,
      }
      this.#db
        .prepare(
          `INSERT INTO runs
             (id, workspace_id, kind, story_id, bug_id, status, session_id, permission_tier,
              agent, branch, self_test_status, self_test_notes, summary, started_at, finished_at,
              created_at, updated_at)
           VALUES (?, ?, 'bug_fix', NULL, ?, 'running', ?, ?, ?, ?, 'not_run', '', '', ?, NULL, ?, ?)`,
        )
        .run(
          run.id,
          run.workspaceId,
          bugId,
          run.sessionId,
          run.permissionTier,
          run.agent,
          run.branch,
          run.startedAt,
          run.createdAt,
          run.updatedAt,
        )
      this.#db
        .prepare(
          "UPDATE bugs SET status = 'fixing', fixed_at = NULL, completed_at = NULL, updated_at = ? WHERE id = ?",
        )
        .run(now, bugId)
      return run
    })
  }

  /** Record that the executor has finished coding and is now self-testing. */
  beginSelfTest(runId: string): Run {
    return withTransaction(this.#db, () => {
      const run = this.#requireRun(runId)
      if (run.status !== 'running') {
        throw invalidTransition('run', runId, run.status, 'begin self-test on')
      }
      const now = this.#now()
      this.#db.prepare("UPDATE runs SET status = 'self_testing', updated_at = ? WHERE id = ?").run(now, runId)
      if (run.storyId !== null) {
        this.#db
          .prepare("UPDATE stories SET status = 'self_testing', updated_at = ? WHERE id = ?")
          .run(now, run.storyId)
      }
      return this.#requireRun(runId)
    })
  }

  /**
   * Record the self-test verdict and close the run.
   * story: passed → done, failed → back to ready for another attempt.
   * bug: passed → fixed, failed → reported so it can be attempted again.
   */
  finishRun(input: FinishRunInput): Run {
    return withTransaction(this.#db, () => {
      const run = this.#requireRun(input.runId)
      if (run.status !== 'self_testing') {
        throw invalidTransition('run', input.runId, run.status, 'finish')
      }
      const passed = input.selfTestStatus === 'passed'
      if (!passed && input.selfTestStatus !== 'failed') {
        throw new WorkflowError('invalid_input', 'selfTestStatus must be passed or failed')
      }
      const now = this.#now()
      const summary = input.summary === undefined ? run.summary : optionalText(input.summary)
      const notes = input.selfTestNotes === undefined ? run.selfTestNotes : optionalText(input.selfTestNotes)
      this.#db
        .prepare(
          `UPDATE runs
              SET status = ?, self_test_status = ?, self_test_notes = ?, summary = ?,
                  finished_at = ?, updated_at = ?
            WHERE id = ?`,
        )
        .run(passed ? 'succeeded' : 'failed', input.selfTestStatus, notes, summary, now, now, run.id)

      if (run.storyId !== null) {
        if (passed) {
          this.#db
            .prepare("UPDATE stories SET status = 'done', done_at = ?, updated_at = ? WHERE id = ?")
            .run(now, now, run.storyId)
        } else {
          this.#db
            .prepare("UPDATE stories SET status = 'ready', updated_at = ? WHERE id = ?")
            .run(now, run.storyId)
        }
      } else if (run.bugId !== null) {
        if (passed) {
          this.#db
            .prepare(
              `UPDATE bugs
                  SET status = 'fixed', resolution = CASE WHEN ? <> '' THEN ? ELSE resolution END,
                      fixed_at = ?, updated_at = ?
                WHERE id = ?`,
            )
            .run(summary, summary, now, now, run.bugId)
        } else {
          this.#db
            .prepare("UPDATE bugs SET status = 'reported', updated_at = ? WHERE id = ?")
            .run(now, run.bugId)
        }
      }
      return this.#requireRun(run.id)
    })
  }

  /** Abandon an active run without a verdict; the subject returns to its prior stage. */
  cancelRun(runId: string): Run {
    return withTransaction(this.#db, () => {
      const run = this.#requireRun(runId)
      if (run.status !== 'running' && run.status !== 'self_testing') {
        throw invalidTransition('run', runId, run.status, 'cancel')
      }
      const now = this.#now()
      this.#db
        .prepare("UPDATE runs SET status = 'cancelled', finished_at = ?, updated_at = ? WHERE id = ?")
        .run(now, now, runId)
      if (run.storyId !== null) {
        this.#db
          .prepare("UPDATE stories SET status = 'ready', updated_at = ? WHERE id = ?")
          .run(now, run.storyId)
      } else if (run.bugId !== null) {
        this.#db
          .prepare("UPDATE bugs SET status = 'reported', updated_at = ? WHERE id = ?")
          .run(now, run.bugId)
      }
      return this.#requireRun(runId)
    })
  }

  /**
   * Cancel whatever run is currently executing one story.
   *
   * The run tools can only be called from inside the development session. If
   * that session is gone, this is the only host-side release path; otherwise
   * the story would stay `developing` and could not be deleted or restarted.
   * The session itself is not aborted here — the caller decides that.
   */
  cancelStoryRun(storyId: string): Run {
    const id = requiredText(storyId, 'storyId')
    const active = this.listRuns({ storyId: id }).find(
      (run) => run.status === 'running' || run.status === 'self_testing',
    )
    if (active === undefined) {
      throw new WorkflowError('not_found', `story ${id} has no active run to cancel`)
    }
    return this.cancelRun(active.id)
  }

  /** Cancel whatever fix run is currently executing one defect. */
  cancelBugRun(bugId: string): Run {
    const id = requiredText(bugId, 'bugId')
    const active = this.listRuns({ bugId: id }).find(
      (run) => run.status === 'running' || run.status === 'self_testing',
    )
    if (active === undefined) {
      throw new WorkflowError('not_found', `bug ${id} has no active run to cancel`)
    }
    return this.cancelRun(active.id)
  }

  // -------------------------------------------------------------------- bugs

  createBug(input: CreateBugInput): Bug {
    return withTransaction(this.#db, () => {
      const bugWorkspaceId = requiredText(input.workspaceId, 'workspaceId')
      const now = this.#now()
      const id = newId('bug')
      const contentPath = this.#persistDoc('bug', { id }, optionalText(input.content))
      const sessionId = optionalText(input.sessionId)
      const bug: Bug = {
        id,
        workspaceId: bugWorkspaceId,
        title: requiredText(input.title, 'title'),
        contentPath,
        severity: severityOf(input.severity),
        status: 'reported',
        resolution: '',
        createdAt: now,
        updatedAt: now,
        fixedAt: null,
        completedAt: null,
        createSessionId: sessionId.length === 0 ? null : sessionId,
      }
      this.#db
        .prepare(
          `INSERT INTO bugs
             (id, workspace_id, title, content_path, severity, status, resolution,
              created_at, updated_at, fixed_at, completed_at, create_session_id)
           VALUES (?, ?, ?, ?, ?, 'reported', '', ?, ?, NULL, NULL, ?)`,
        )
        .run(
          bug.id,
          bug.workspaceId,
          bug.title,
          bug.contentPath,
          bug.severity,
          bug.createdAt,
          bug.updatedAt,
          bug.createSessionId,
        )
      return bug
    })
  }

  updateBug(id: string, input: UpdateBugInput): Bug {
    return withTransaction(this.#db, () => {
      const current = this.#requireBug(id)
      if (current.status === 'fixing') {
        throw invalidTransition('bug', id, current.status, 'update')
      }
      const now = this.#now()
      const title = input.title === undefined ? current.title : requiredText(input.title, 'title')
      const severity = input.severity === undefined ? current.severity : severityOf(input.severity)
      if (input.content !== undefined) {
        writeDoc(this.#docsRoot, current.contentPath, optionalText(input.content))
      }
      this.#db
        .prepare('UPDATE bugs SET title = ?, severity = ?, updated_at = ? WHERE id = ?')
        .run(title, severity, now, id)
      return this.#requireBug(id)
    })
  }

  /**
   * Confirm that the reported problem is solved. This is the user's decision
   * after the fix run ended (`fixed`); a successful run never does it itself.
   */
  completeBug(id: string): Bug {
    return withTransaction(this.#db, () => {
      const bug = this.#requireBug(id)
      if (bug.status !== 'fixed') {
        throw invalidTransition('bug', id, bug.status, 'complete')
      }
      const now = this.#now()
      this.#db
        .prepare("UPDATE bugs SET status = 'completed', completed_at = ?, updated_at = ? WHERE id = ?")
        .run(now, now, id)
      return this.#requireBug(id)
    })
  }

  /** Close without a fix; a reason is mandatory so the decision is auditable. */
  wontfixBug(id: string, resolution: string): Bug {
    return withTransaction(this.#db, () => {
      const bug = this.#requireBug(id)
      if (bug.status !== 'reported' && bug.status !== 'fixed') {
        throw invalidTransition('bug', id, bug.status, 'mark as wontfix')
      }
      const reason = requiredText(resolution, 'resolution')
      const now = this.#now()
      this.#db
        .prepare("UPDATE bugs SET status = 'wontfix', resolution = ?, updated_at = ? WHERE id = ?")
        .run(reason, now, id)
      return this.#requireBug(id)
    })
  }

  // ---------------------------------------------------------------- deletion

  /**
   * Compute the impact of deleting one or more records, without writing.
   *
   * The panel calls this before showing its confirmation dialog, so the user
   * sees record ids, statuses, cascaded detailed designs and the entries that
   * will be skipped before anything is touched.
   */
  previewDeletions(targets: readonly DeleteTarget[]): DeletePreview {
    const normalized = this.#normalizeTargets(targets)
    const items = normalized.map((target) => this.#previewOne(target))
    this.#assertSingleWorkspace(items)
    return this.#summary(items)
  }

  /**
   * Physically delete records and their markdown files.
   *
   * Each target is its own transaction: AC 27 requires a failed entry to stay
   * in place with its reason while the others still complete. Per-target
   * failures are returned, not thrown; only a malformed target list throws.
   */
  deleteRecords(targets: readonly DeleteTarget[]): DeleteReport {
    const normalized = this.#normalizeTargets(targets)
    const previews = normalized.map((target) => this.#previewOne(target))
    this.#assertSingleWorkspace(previews)
    const results = normalized.map((target, index) => {
      const preview = previews[index]
      if (preview === undefined) throw new WorkflowError('invalid_input', 'delete target disappeared')
      return this.#deleteOne(target, preview)
    })
    return {
      results,
      succeeded: results.filter((result) => result.ok).length,
      failed: results.filter((result) => !result.ok).length,
    }
  }

  #deleteOne(target: DeleteTarget, preview: DeletePreviewItem): DeleteOutcome {
    const staged: { readonly root: string; readonly doc: StagedDoc }[] = []
    let committed = false
    try {
      const outcome = withTransaction(this.#db, () => {
        // Re-check inside the write transaction: a run may have started between
        // the preview and the user's confirmation.
        const current = this.#previewOne(target)
        if (!current.found) {
          throw new WorkflowError('not_found', `${target.kind} ${target.id} does not exist`)
        }
        if (!current.deletable) {
          throw new WorkflowError(
            current.reasonCode ?? 'invalid_transition',
            current.reason ?? `${target.kind} ${target.id} cannot be deleted`,
          )
        }

        for (const relative of this.#filesToDelete(target)) {
          try {
            const doc = stageDocDeletion(this.#docsRoot, relative)
            if (doc !== null) staged.push({ root: this.#docsRoot, doc })
          } catch (error) {
            throw new WorkflowError(
              'file_error',
              `could not stage ${relative} for deletion: ${describeError(error)}`,
            )
          }
        }

        if (target.kind === 'story') {
          this.#db.prepare('DELETE FROM runs WHERE story_id = ?').run(target.id)
        } else if (target.kind === 'bug') {
          this.#db.prepare('DELETE FROM runs WHERE bug_id = ?').run(target.id)
        } else {
          // `design_doc_stories` is ON DELETE CASCADE from this table, and
          // `requirement_sessions` cascades from `requirements`.
          this.#db.prepare('DELETE FROM design_docs WHERE requirement_id = ?').run(target.id)
        }
        const table =
          target.kind === 'story' ? 'stories' : target.kind === 'bug' ? 'bugs' : 'requirements'
        const changes = Number(this.#db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(target.id).changes)
        if (changes === 0) {
          throw new WorkflowError('not_found', `${target.kind} ${target.id} does not exist`)
        }

        return {
          kind: target.kind,
          id: target.id,
          title: current.title,
          ok: true,
          removedDocs: current.docs.length,
          removedRuns: current.runCount,
          error: null,
        } satisfies DeleteOutcome
      })
      committed = true
      return outcome
    } catch (error) {
      // The database rolled back; move every staged file back before reporting.
      for (const entry of [...staged].reverse()) {
        try {
          restoreStagedDoc(entry.root, entry.doc)
        } catch (restoreError) {
          this.#warn(
            `teamflow: could not restore ${entry.doc.relative} after a failed delete: ${describeError(restoreError)}`,
          )
        }
      }
      return {
        kind: target.kind,
        id: target.id,
        title: preview.title,
        ok: false,
        removedDocs: 0,
        removedRuns: 0,
        error: {
          code: error instanceof WorkflowError ? error.code : 'delete_failed',
          message: describeError(error),
        },
      }
    } finally {
      if (committed) {
        for (const entry of staged) {
          if (!dropStagedDoc(entry.doc)) {
            this.#warn(`teamflow: staged file ${entry.doc.staged} could not be removed`)
          }
          pruneEmptyDirectories(entry.root, entry.doc.relative)
        }
      }
    }
  }

  #summary(items: readonly DeletePreviewItem[]): DeletePreview {
    const counts: Record<DeletableKind, number> = { bug: 0, story: 0, requirement: 0 }
    for (const item of items) counts[item.kind] += 1
    return {
      items,
      counts,
      deletableCount: items.filter((item) => item.deletable).length,
      skippedCount: items.filter((item) => !item.deletable).length,
      // Only requirements that will actually be deleted contribute to the
      // cascade count; one blocked by child stories keeps its documents.
      docCount: items
        .filter((item) => item.deletable)
        .reduce((total, item) => total + item.docs.length, 0),
      runCount: items
        .filter((item) => item.deletable)
        .reduce((total, item) => total + item.runCount, 0),
    }
  }

  #previewOne(target: DeleteTarget): DeletePreviewItem {
    if (target.kind === 'requirement') {
      const requirement = this.getRequirement(target.id)
      if (requirement === null) return this.#missingPreview(target)
      const stories = this.listStories({ requirementId: requirement.id }).map(
        (story): DeleteChildRef => ({ id: story.id, title: story.title, status: story.status }),
      )
      const docs = this.listDesignDocs(requirement.id).map(
        (doc): DeleteDocRef => ({ id: doc.id, title: doc.title, kind: doc.kind }),
      )
      const activeRun = this.#activeRunForStories(stories.map((story) => story.id))
      const statusAllowed = DELETABLE_STATUSES.requirement.includes(requirement.status)
      const blocked = this.#deletionBlock({
        kind: 'requirement',
        id: requirement.id,
        status: requirement.status,
        statusAllowed,
        activeRunId: activeRun,
        childCount: stories.length,
      })
      return {
        kind: 'requirement',
        id: requirement.id,
        found: true,
        title: requirement.title,
        status: requirement.status,
        workspaceId: requirement.workspaceId,
        deletable: blocked === null,
        reasonCode: blocked?.code ?? null,
        reason: blocked?.message ?? null,
        activeRunId: activeRun,
        docs,
        stories,
        runCount: 0,
      }
    }

    if (target.kind === 'story') {
      const story = this.getStory(target.id)
      if (story === null) return this.#missingPreview(target)
      const runs = this.listRuns({ storyId: story.id })
      const activeRun = runs.find((run) => isActiveRun(run.status))?.id ?? null
      const statusAllowed = DELETABLE_STATUSES.story.includes(story.status)
      const blocked = this.#deletionBlock({
        kind: 'story',
        id: story.id,
        status: story.status,
        statusAllowed,
        activeRunId: activeRun,
        childCount: 0,
      })
      return {
        kind: 'story',
        id: story.id,
        found: true,
        title: story.title,
        status: story.status,
        workspaceId: story.workspaceId,
        deletable: blocked === null,
        reasonCode: blocked?.code ?? null,
        reason: blocked?.message ?? null,
        activeRunId: activeRun,
        docs: [],
        stories: [],
        runCount: runs.length,
      }
    }

    const bug = this.getBug(target.id)
    if (bug === null) return this.#missingPreview(target)
    const runs = this.listRuns({ bugId: bug.id })
    const activeRun = runs.find((run) => isActiveRun(run.status))?.id ?? null
    const statusAllowed = DELETABLE_STATUSES.bug.includes(bug.status)
    const blocked = this.#deletionBlock({
      kind: 'bug',
      id: bug.id,
      status: bug.status,
      statusAllowed,
      activeRunId: activeRun,
      childCount: 0,
    })
    return {
      kind: 'bug',
      id: bug.id,
      found: true,
      title: bug.title,
      status: bug.status,
      workspaceId: bug.workspaceId,
      deletable: blocked === null,
      reasonCode: blocked?.code ?? null,
      reason: blocked?.message ?? null,
      activeRunId: activeRun,
      docs: [],
      stories: [],
      runCount: runs.length,
    }
  }

  #deletionBlock(input: {
    readonly kind: DeletableKind
    readonly id: string
    readonly status: string
    readonly statusAllowed: boolean
    readonly activeRunId: string | null
    readonly childCount: number
  }): { readonly code: WorkflowErrorCode; readonly message: string } | null {
    if (!input.statusAllowed) {
      return {
        code: 'invalid_transition',
        message: `${input.kind} ${input.id} is ${input.status}, which means an agent may be executing it; only idle statuses can be deleted`,
      }
    }
    if (input.activeRunId !== null) {
      return {
        code: 'has_active_run',
        message: `${input.kind} ${input.id} is ${input.status} but run ${input.activeRunId} is still running; cancel the run before deleting`,
      }
    }
    if (input.childCount > 0) {
      return {
        code: 'has_children',
        message: `${input.kind} ${input.id} still owns ${input.childCount} stor${input.childCount === 1 ? 'y' : 'ies'}; delete those stories first`,
      }
    }
    return null
  }

  #missingPreview(target: DeleteTarget): DeletePreviewItem {
    return {
      kind: target.kind,
      id: target.id,
      found: false,
      title: '',
      status: '',
      workspaceId: '',
      deletable: false,
      reasonCode: 'not_found',
      reason: `${target.kind} ${target.id} does not exist`,
      activeRunId: null,
      docs: [],
      stories: [],
      runCount: 0,
    }
  }

  /** Document-root-relative paths that a successful delete must remove. */
  #filesToDelete(target: DeleteTarget): string[] {
    if (target.kind === 'story') return [this.#requireStory(target.id).contentPath]
    if (target.kind === 'bug') return [this.#requireBug(target.id).contentPath]
    const requirement = this.#requireRequirement(target.id)
    return [
      requirement.contentPath,
      ...this.listDesignDocs(requirement.id).map((doc) => doc.contentPath),
    ]
  }

  #normalizeTargets(targets: readonly DeleteTarget[]): DeleteTarget[] {
    if (!Array.isArray(targets) || targets.length === 0) {
      throw new WorkflowError('invalid_input', 'at least one delete target is required')
    }
    if (targets.length > MAX_DELETE_TARGETS) {
      throw new WorkflowError(
        'invalid_input',
        `at most ${MAX_DELETE_TARGETS} records can be deleted in one batch, got ${targets.length}`,
      )
    }
    const seen = new Set<string>()
    const normalized: DeleteTarget[] = []
    for (const target of targets) {
      if (target === null || typeof target !== 'object' || !DELETABLE_KINDS.includes(target.kind)) {
        throw new WorkflowError('invalid_input', `unknown delete target kind ${JSON.stringify(target.kind)}`)
      }
      const id = requiredText(target.id, `${target.kind} id`)
      const key = `${target.kind}:${id}`
      if (seen.has(key)) continue
      seen.add(key)
      normalized.push({ kind: target.kind, id })
    }
    return normalized
  }

  /** AC 7: one batch never spans workspaces. */
  #assertSingleWorkspace(items: readonly DeletePreviewItem[]): void {
    const workspaces = new Set(items.filter((item) => item.workspaceId.length > 0).map((item) => item.workspaceId))
    if (workspaces.size > 1) {
      throw new WorkflowError(
        'invalid_input',
        `a delete batch must stay inside one workspace; got ${[...workspaces].join(', ')}`,
      )
    }
  }

  #activeRunForStories(storyIds: readonly string[]): string | null {
    for (const storyId of storyIds) {
      const row = this.#db
        .prepare(
          `SELECT id FROM runs
            WHERE story_id = ? AND status IN ('running', 'self_testing') LIMIT 1`,
        )
        .get(storyId)
      if (row !== undefined) return text(row, 'id')
    }
    return null
  }

  // ------------------------------------------------------------------ internals

  /**
   * Resolve the workspace a child entity must carry.
   *
   * A child never chooses its own workspace: the parent's workspace wins, and
   * an explicit but different value is an input error rather than a silent
   * reassignment — moving work between workspaces has to be an explicit
   * operation that this store does not offer yet.
   */
  #inheritWorkspace(requested: string | undefined, parent: string, kind: string): string {
    const explicit = optionalText(requested)
    if (explicit.length === 0) {
      return parent
    }
    if (explicit !== parent) {
      throw new WorkflowError(
        'invalid_input',
        `${kind} workspace "${explicit}" does not match its parent workspace "${parent}"`,
      )
    }
    return parent
  }

  #requireRequirement(id: string): Requirement {
    const row = this.#db.prepare('SELECT * FROM requirements WHERE id = ?').get(id)
    if (row === undefined) throw notFound('requirement', id)
    return toRequirement(row)
  }

  #requireSubject(subjectType: DiscussionSubjectType, subjectId: string): void {
    const table =
      subjectType === 'requirement' ? 'requirements' : subjectType === 'story' ? 'stories' : 'bugs'
    const row = this.#db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(subjectId)
    if (row === undefined) throw notFound(subjectType, subjectId)
  }

  #bindRequirementSessionInTx(
    requirementId: string,
    sessionId: string,
    createdAt: string,
  ): RequirementSession {
    const existing = this.#db
      .prepare("SELECT * FROM discussion_sessions WHERE subject_type = 'requirement' AND session_id = ?")
      .get(sessionId)
    if (existing !== undefined) {
      const row = toRequirementSession(existing)
      if (row.requirementId !== requirementId) {
        throw new WorkflowError(
          'invalid_input',
          `session ${sessionId} already created requirement ${row.requirementId}`,
        )
      }
      return row
    }
    this.#db
      .prepare(
        `INSERT INTO discussion_sessions
           (subject_type, subject_id, session_id, kind, prepared_at, linked_at, created_at)
         VALUES ('requirement', ?, ?, 'create', NULL, NULL, ?)`,
      )
      .run(requirementId, sessionId, createdAt)
    return {
      requirementId,
      sessionId,
      kind: 'create',
      preparedAt: null,
      linkedAt: null,
      createdAt,
    }
  }

  #requireRequirementSession(sessionId: string): RequirementSession {
    const row = this.#db
      .prepare("SELECT * FROM discussion_sessions WHERE subject_type = 'requirement' AND session_id = ?")
      .get(sessionId)
    if (row === undefined) {
      throw new WorkflowError(
        'not_found',
        `session ${sessionId} is not prepared for a requirement discussion; start again from the requirement page`,
      )
    }
    return toRequirementSession(row)
  }

  #requireDiscussionSession(
    sessionId: string,
    subjectType: DiscussionSubjectType,
    subjectId: string,
  ): DiscussionSession {
    const row = this.#db
      .prepare(
        `SELECT * FROM discussion_sessions
          WHERE subject_type = ? AND subject_id = ? AND session_id = ?`,
      )
      .get(subjectType, subjectId, sessionId)
    if (row === undefined) {
      throw new WorkflowError(
        'not_found',
        `session ${sessionId} is not prepared for a ${subjectType} discussion`,
      )
    }
    return toDiscussionSession(row)
  }

  #requireStory(id: string): Story {
    const row = this.#db.prepare('SELECT * FROM stories WHERE id = ?').get(id)
    if (row === undefined) throw notFound('story', id)
    return toStory(row)
  }

  #requireBug(id: string): Bug {
    const row = this.#db.prepare('SELECT * FROM bugs WHERE id = ?').get(id)
    if (row === undefined) throw notFound('bug', id)
    return toBug(row)
  }

  #requireRun(id: string): Run {
    const row = this.#db.prepare('SELECT * FROM runs WHERE id = ?').get(id)
    if (row === undefined) throw notFound('run', id)
    return toRun(row)
  }

  #patchRequirement(current: Requirement, input: UpdateRequirementInput): Requirement {
    const now = this.#now()
    const title = input.title === undefined ? current.title : requiredText(input.title, 'title')
    const summary = input.summary === undefined ? current.summary : optionalText(input.summary)
    if (input.content !== undefined) {
      writeDoc(this.#docsRoot, current.contentPath, optionalText(input.content))
    }
    this.#db
      .prepare('UPDATE requirements SET title = ?, summary = ?, updated_at = ? WHERE id = ?')
      .run(title, summary, now, current.id)
    return this.#requireRequirement(current.id)
  }

  #assertNoActiveRun(kind: 'story' | 'bug', id: string): void {
    const column = kind === 'story' ? 'story_id' : 'bug_id'
    const row = this.#db
      .prepare(
        `SELECT id FROM runs WHERE ${column} = ? AND status IN ('running', 'self_testing') LIMIT 1`,
      )
      .get(id)
    if (row !== undefined) {
      throw new WorkflowError(
        'duplicate_active_run',
        `${kind} ${id} already has an active run ${text(row, 'id')}`,
      )
    }
  }

  /**
   * Complete a requirement once every one of its stories is completed.
   *
   * An empty story list never counts as finished: a requirement with no stories
   * is completed only by the user clicking complete on the detail page.
   */
  #completeRequirementIfAllStoriesDone(requirementId: string, now: string): void {
    const counts = this.#db
      .prepare(
        "SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS done FROM stories WHERE requirement_id = ?",
      )
      .get(requirementId) as { total: number; done: number | null } | undefined
    if (counts === undefined || counts.total === 0 || (counts.done ?? 0) !== counts.total) return
    const requirement = this.getRequirement(requirementId)
    if (requirement === null || requirement.status !== 'draft') return
    this.#db
      .prepare("UPDATE requirements SET status = 'completed', completed_at = ?, updated_at = ? WHERE id = ?")
      .run(now, now, requirementId)
  }

  #computeReadiness(storyId: string): StoryReadiness {
    const story = this.#requireStory(storyId)
    let parentReady = true
    if (story.requirementId !== null) {
      const row = this.#db
        .prepare('SELECT status FROM requirements WHERE id = ?')
        .get(story.requirementId)
      parentReady = row !== undefined && isDevelopable(text(row, 'status'))
    }

    return { ready: parentReady, parentReady }
  }

}
