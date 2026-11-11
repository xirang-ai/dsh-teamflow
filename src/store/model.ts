/**
 * Domain vocabulary for the requirement → story → run pipeline.
 *
 * Statuses are code constants rather than a configurable table because they are
 * the contract of the state machine: every transition below is validated in
 * `workflow.ts`, and a new status is a product decision that ships with code.
 * The database repeats the same values in `CHECK` constraints so a hand-written
 * row cannot introduce a state the workflow cannot leave.
 *
 * @module
 */
import type { PermissionTier } from '../permission-tier.ts'

/**
 * Lifecycle of a requirement, which carries both the requirement and its
 * outline design. `draft` means it is still being collected or changed;
 * `completed` is set only by an explicit user action, never by a transition.
 */
export const REQUIREMENT_STATUSES = ['draft', 'completed', 'archived'] as const
export type RequirementStatus = (typeof REQUIREMENT_STATUSES)[number]

/**
 * Lifecycle of a deliverable story.
 * `ready` → `developing` → `self_testing` → `done` follow the development run;
 * `done` means execution finished but the story is not complete. Only the user
 * can move `done` → `completed`.
 */
export const STORY_STATUSES = [
  'ready',
  'developing',
  'self_testing',
  'done',
  'completed',
  'cancelled',
] as const
export type StoryStatus = (typeof STORY_STATUSES)[number]

/** Statuses a development run can still move out of. */
export const ACTIVE_RUN_STATUSES = ['running', 'self_testing'] as const
export type ActiveRunStatus = (typeof ACTIVE_RUN_STATUSES)[number]

/** Full lifecycle of one development or fix run. */
export const RUN_STATUSES = ['running', 'self_testing', 'succeeded', 'failed', 'cancelled'] as const
export type RunStatus = (typeof RUN_STATUSES)[number]

/** Outcome of the self-test a development run must perform before success. */
export const SELF_TEST_STATUSES = ['not_run', 'passed', 'failed'] as const
export type SelfTestStatus = (typeof SELF_TEST_STATUSES)[number]

/**
 * Lifecycle of a reported defect.
 * `reported` → `fixing` → `fixed` follow the fix run; `fixed` means execution
 * finished but the defect is not resolved. Only the user can move `fixed` →
 * `completed`, or mark it `wontfix`.
 */
export const BUG_STATUSES = ['reported', 'fixing', 'fixed', 'completed', 'wontfix'] as const
export type BugStatus = (typeof BUG_STATUSES)[number]

/** What a run is working on; exactly one of `story_id` / `bug_id` is set. */
export const RUN_KINDS = ['story_dev', 'bug_fix'] as const
export type RunKind = (typeof RUN_KINDS)[number]

/** T-shirt size used while splitting stories. */
export const STORY_SIZES = ['xs', 's', 'm', 'l', 'xl'] as const
export type StorySize = (typeof STORY_SIZES)[number]

/** Defect severity, independent from business priority. */
export const BUG_SEVERITIES = ['blocker', 'critical', 'major', 'minor', 'trivial'] as const
export type BugSeverity = (typeof BUG_SEVERITIES)[number]

/**
 * A requirement. Its body is also the outline design (概设): the requirement
 * text and the outline are one document, reviewed and approved as a whole.
 * Detailed-design documents and stories hang off it.
 */
export interface Requirement {
  readonly id: string
  /** DSH workspace this requirement belongs to; every child inherits it. */
  readonly workspaceId: string
  readonly title: string
  readonly summary: string
  /** Workspace-relative path of the requirement + outline body. */
  readonly contentPath: string
  readonly status: RequirementStatus
  readonly createdAt: string
  readonly updatedAt: string
  /** Set only when the user explicitly completes the requirement. */
  readonly completedAt: string | null
}

/**
 * A deliverable story. It hangs off a requirement, or stands alone when the
 * user described it directly without an upstream requirement.
 */
export interface Story {
  readonly id: string
  /** Inherited from the parent requirement, or chosen for a standalone story. */
  readonly workspaceId: string
  readonly requirementId: string | null
  readonly title: string
  /** Workspace-relative path of story.md: description plus acceptance criteria. */
  readonly contentPath: string
  readonly status: StoryStatus
  readonly size: StorySize
  /**
   * Explicit display order inside the parent requirement, ascending. The
   * workbench renders by this field, so a status change never reorders the
   * list; new rows get the current maximum + 1 and land at the end.
   */
  readonly sortOrder: number
  readonly createdAt: string
  readonly updatedAt: string
  /** Execution finished: the last run succeeded. Not completion. */
  readonly doneAt: string | null
  /** Completion confirmed by the user. */
  readonly completedAt: string | null
  /**
   * Session that created the story; null for rows created before the link was
   * recorded. The workbench shows it as the story's origin conversation.
   */
  readonly createSessionId: string | null
}

/** A defect reported by a user; it belongs to a workspace, not to a story. */
export interface Bug {
  readonly id: string
  readonly workspaceId: string
  readonly title: string
  /** Workspace-relative path of bug.md: description, repro, expected, actual, environment. */
  readonly contentPath: string
  readonly severity: BugSeverity
  readonly status: BugStatus
  readonly resolution: string
  readonly createdAt: string
  readonly updatedAt: string
  /** Execution finished: the last fix run succeeded. Not completion. */
  readonly fixedAt: string | null
  /** Completion confirmed by the user. */
  readonly completedAt: string | null
  /**
   * Session that created the defect; null for rows created before the link was
   * recorded. The workbench shows it as the defect's origin conversation.
   */
  readonly createSessionId: string | null
}

/** One development or fix attempt, the unit the dev role actually executes. */
export interface Run {
  readonly id: string
  /** Workspace of the story or bug being worked on. */
  readonly workspaceId: string
  readonly kind: RunKind
  readonly storyId: string | null
  readonly bugId: string | null
  readonly status: RunStatus
  /** Conversation the run happened in, so the workbench can jump back to it. */
  readonly sessionId: string | null
  /**
   * Permission tier the session was started with; null when the caller did not
   * choose one (older runs, or a Host that could not attach the session).
   */
  readonly permissionTier: PermissionTier | null
  readonly agent: string
  readonly branch: string
  readonly selfTestStatus: SelfTestStatus
  readonly selfTestNotes: string
  readonly summary: string
  readonly startedAt: string | null
  readonly finishedAt: string | null
  readonly createdAt: string
  readonly updatedAt: string
}

/** Themes a detailed design document can cover; one requirement usually owns several. */
export const DOC_KINDS = ['flow', 'data', 'interface', 'page', 'rule'] as const
export type DocKind = (typeof DOC_KINDS)[number]

/**
 * One 详细设计 document under a requirement.
 *
 * The requirement body is the outline (概设) and stays short; the documents hold
 * the parts that are too long to read on the requirement page — flow, data,
 * interface, page and rule material — and each document is read on its own
 * surface.
 */
export interface DesignDoc {
  readonly id: string
  readonly requirementId: string
  readonly kind: DocKind
  readonly title: string
  /** Workspace-relative path of the document body. */
  readonly contentPath: string
  readonly sortOrder: number
  readonly createdAt: string
  readonly updatedAt: string
}

/** One `design_doc_stories` link: which document covers which story. */
export interface DocStoryLink {
  readonly docId: string
  readonly storyId: string
}

/** Why a requirement is linked to a conversation. */
export const REQUIREMENT_SESSION_KINDS = ['create', 'design', 'detail', 'split'] as const
export type RequirementSessionKind = (typeof REQUIREMENT_SESSION_KINDS)[number]

/**
 * One conversation linked to a requirement.
 *
 * `create` is written when the conversation created the requirement. `design`,
 * `detail` and `split` are written by the browser when it opens an
 * outline-design, detailed-design or story-splitting discussion and confirmed
 * by the Agent through `linkedAt`; only confirmed discussion rows show in the
 * panel.
 */
export interface RequirementSession {
  readonly requirementId: string
  readonly sessionId: string
  readonly kind: RequirementSessionKind
  /** Set for discussion sessions the browser prepared but the Agent has not confirmed. */
  readonly preparedAt: string | null
  readonly linkedAt: string | null
  readonly createdAt: string
}

/** Which kind of record a discussion conversation belongs to. */
export const DISCUSSION_SUBJECT_TYPES = ['requirement', 'story', 'bug'] as const
export type DiscussionSubjectType = (typeof DISCUSSION_SUBJECT_TYPES)[number]

/** Discussion kind used by stories and defects; requirements keep their own kinds. */
export const GENERAL_DISCUSSION_KIND = 'discuss'

/**
 * One conversation registered against a requirement, story or defect.
 *
 * Rows start unconfirmed (`linkedAt` null) when the browser prepares a
 * discussion and become visible once the Agent confirms with `linkedAt`.
 */
export interface DiscussionSession {
  readonly subjectType: DiscussionSubjectType
  readonly subjectId: string
  readonly sessionId: string
  /** `create` / `design` / `detail` / `split` for requirements, `discuss` otherwise. */
  readonly kind: string
  readonly preparedAt: string | null
  readonly linkedAt: string | null
  readonly createdAt: string
}

/**
 * One consistent read of every table the workbench renders.
 *
 * The store returns rows already in panel order so the browser never sorts a
 * partial view: running work is pinned first, then the most recently touched
 * row of its group.
 */
export interface BoardRows {
  readonly requirements: readonly Requirement[]
  readonly stories: readonly Story[]
  readonly bugs: readonly Bug[]
  readonly runs: readonly Run[]
  readonly docs: readonly DesignDoc[]
  readonly docStories: readonly DocStoryLink[]
  /** Requirement conversations, newest first; design rows may still be unconfirmed. */
  readonly requirementSessions: readonly RequirementSession[]
  /** Confirmed story and defect discussions, newest first. */
  readonly discussionSessions: readonly DiscussionSession[]
}

/** Input for {@link WorkflowStore.createDesignDoc}. */
export interface CreateDesignDocInput {
  readonly requirementId: string
  readonly title: string
  readonly kind?: DocKind
  readonly content?: string
  readonly sortOrder?: number
  /** stories this document covers; they must belong to the same requirement. */
  readonly storyIds?: readonly string[]
}

/** Editable fields of a design document. */
export interface UpdateDesignDocInput {
  readonly title?: string
  readonly kind?: DocKind
  readonly content?: string
  readonly sortOrder?: number
}

/**
 * Whether a story can enter development. A story is ready as soon as it exists;
 * `parentReady` only reports that a linked requirement has not been archived.
 */
export interface StoryReadiness {
  readonly ready: boolean
  /** False only when the parent requirement is archived. */
  readonly parentReady: boolean
}

/** Why a workflow call was rejected. */
export type WorkflowErrorCode =
  | 'not_found'
  | 'invalid_input'
  | 'invalid_transition'
  | 'duplicate_active_run'
  | 'has_active_run'
  | 'has_children'
  | 'file_error'

/** A rejected domain operation, separate from SQLite or Host failures. */
export class WorkflowError extends Error {
  /** Machine-readable reason for tools and the Web UI. */
  readonly code: WorkflowErrorCode

  /**
   * @param code - reason category.
   * @param message - operation, target, and expected state.
   */
  constructor(code: WorkflowErrorCode, message: string) {
    super(`teamflow: ${message}`)
    this.name = 'WorkflowError'
    this.code = code
  }
}

/** Input for {@link WorkflowStore.createRequirement}. */
export interface CreateRequirementInput {
  /** Target DSH workspace; required because everything else inherits it. */
  readonly workspaceId: string
  readonly title: string
  readonly summary?: string
  /** Body written to the requirement document; omitted leaves it empty. */
  readonly content?: string
  /** Session that created this requirement; recorded atomically with the row. */
  readonly sessionId?: string
}

/** Editable fields of a requirement. */
export interface UpdateRequirementInput {
  readonly title?: string
  readonly summary?: string
  readonly content?: string
}

/** Input for {@link WorkflowStore.createStory}. */
export interface CreateStoryInput {
  /** Optional for child stories (inherited); required when standalone. */
  readonly workspaceId?: string
  readonly requirementId?: string
  readonly title: string
  /** story.md body; write the description and acceptance criteria as sections. */
  readonly content?: string
  readonly size?: StorySize
  /** Display order; omitted appends after the current last row. */
  readonly sortOrder?: number
  /** Session that created this story; recorded atomically with the row. */
  readonly sessionId?: string
}

/** Editable fields of a story. */
export interface UpdateStoryInput {
  readonly title?: string
  readonly content?: string
  readonly size?: StorySize
  readonly sortOrder?: number
}

/** Input for {@link WorkflowStore.createBug}. */
export interface CreateBugInput {
  readonly workspaceId: string
  readonly title: string
  /** bug.md body: description, repro steps, expected, actual, environment. */
  readonly content?: string
  readonly severity?: BugSeverity
  /** Session that created this defect; recorded atomically with the row. */
  readonly sessionId?: string
}

/** Editable fields of a bug. */
export interface UpdateBugInput {
  readonly title?: string
  readonly content?: string
  readonly severity?: BugSeverity
}

/** Optional executor metadata recorded on a run. */
export interface StartRunInput {
  readonly agent?: string
  readonly branch?: string
  /** Conversation the executor is running in; the workbench uses it to jump back. */
  readonly sessionId?: string
  /** Permission tier the session was started with; omitted keeps the default run. */
  readonly permissionTier?: PermissionTier
}

/** Result the executor reports when a run ends. */
export interface FinishRunInput {
  readonly runId: string
  readonly selfTestStatus: Exclude<SelfTestStatus, 'not_run'>
  readonly summary?: string
  readonly selfTestNotes?: string
}

/** Filter for {@link WorkflowStore.listRequirements}. */
export interface RequirementFilter {
  readonly workspaceId?: string
  readonly status?: RequirementStatus
}

/** Filter for {@link WorkflowStore.listStories}. */
export interface StoryFilter {
  readonly workspaceId?: string
  readonly status?: StoryStatus
  readonly requirementId?: string
}

/** Filter for {@link WorkflowStore.listBugs}. */
export interface BugFilter {
  readonly workspaceId?: string
  readonly status?: BugStatus
}

/** Filter for {@link WorkflowStore.listRuns}. */
export interface RunFilter {
  readonly storyId?: string
  readonly bugId?: string
  readonly status?: RunStatus
}

// ------------------------------------------------------------------ deletion

/**
 * Record types the workbench can physically delete.
 *
 * Detailed-design documents (`design_docs`) are not a target of their own: they
 * are records *of* a requirement and are removed with it, because a document
 * has no meaning once the requirement that explains it is gone.
 */
export const DELETABLE_KINDS = ['bug', 'story', 'requirement'] as const
export type DeletableKind = (typeof DELETABLE_KINDS)[number]

/** One record the user asked to delete. */
export interface DeleteTarget {
  readonly kind: DeletableKind
  readonly id: string
}

/** A detailed-design document that will be deleted together with its requirement. */
export interface DeleteDocRef {
  readonly id: string
  readonly title: string
  readonly kind: DocKind
}

/** A child story that blocks deleting its requirement. */
export interface DeleteChildRef {
  readonly id: string
  readonly title: string
  readonly status: string
}

/**
 * What deleting one record would do, computed without writing anything.
 *
 * `deletable` is the single answer the UI needs; `reason` carries the whole
 * sentence (record id + current status + blocker) so a refusal never has to be
 * reconstructed in the browser.
 */
export interface DeletePreviewItem {
  readonly kind: DeletableKind
  readonly id: string
  readonly found: boolean
  readonly title: string
  readonly status: string
  readonly workspaceId: string
  readonly deletable: boolean
  readonly reasonCode: WorkflowErrorCode | null
  readonly reason: string | null
  /** Active run that blocks deletion; null when none was found. */
  readonly activeRunId: string | null
  /** Detailed designs that will be removed with a requirement; empty for stories/bugs. */
  readonly docs: readonly DeleteDocRef[]
  /** stories under a requirement; while any exist the requirement cannot be deleted. */
  readonly stories: readonly DeleteChildRef[]
  /** Run rows that will be removed with the record (history, never an active run). */
  readonly runCount: number
}

/** Aggregate preview for one or more targets, in the order they were requested. */
export interface DeletePreview {
  readonly items: readonly DeletePreviewItem[]
  /** Requested rows by type, including records that were not found. */
  readonly counts: Readonly<Record<DeletableKind, number>>
  readonly deletableCount: number
  readonly skippedCount: number
  /** Total detailed-design documents that will be removed. */
  readonly docCount: number
  /** Total run-history rows that will be removed with the deletable records. */
  readonly runCount: number
}

/** Per-record result of an actual delete. */
export interface DeleteOutcome {
  readonly kind: DeletableKind
  readonly id: string
  readonly title: string
  readonly ok: boolean
  readonly removedDocs: number
  readonly removedRuns: number
  readonly error: { readonly code: string; readonly message: string } | null
}

/** Whole batch result; one failed record never hides the others. */
export interface DeleteReport {
  readonly results: readonly DeleteOutcome[]
  readonly succeeded: number
  readonly failed: number
}
