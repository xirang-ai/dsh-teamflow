/**
 * The wire contract between the Host workbench service and the browser panel.
 *
 * Both halves import this module, so the method list and the JSON shapes are
 * written once: a field added here is a compile error on whichever side has not
 * been updated yet. The codecs are deliberately identity parsers — SQLite rows
 * are already plain JSON (strings, numbers, nulls) and every value crosses an
 * RPC boundary, so asking zod to re-validate them would only add a second
 * schema to keep in sync with `store/model.ts`.
 *
 * @module
 */
import type { PermissionTier } from '../permission-tier.ts'
import type {
  InvocationDescriptor,
  TypertCodec,
  TypertDisposer,
  TypertSchema,
} from '@deepseek-ai/dsh-typert-protocol'

/** Structural shape of one Host contribution, as the Typert registry stores it. */
export interface HostContribution {
  readonly package: string
  readonly face: 'host' | 'client'
  readonly schemas: readonly unknown[]
  readonly model: {
    readonly services: readonly unknown[]
    readonly events: readonly unknown[]
    readonly objects: readonly unknown[]
  }
  readonly invocations: readonly InvocationDescriptor[]
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRegistryContract {
    /**
     * Store one generated contribution for the calling fiber.
     *
     * The registry package that implements this augments the same interface;
     * the declaration is repeated here so this bundle stays typed without
     * depending on the provider package.
     */
    register(contribution: HostContribution): TypertDisposer
  }
}

import type {
  BugSeverity,
  BugStatus,
  DeletePreview,
  DeleteReport,
  DeleteTarget,
  DocKind,
  RequirementSessionKind,
  RequirementStatus,
  RunKind,
  RunStatus,
  StorySize,
  StoryStatus,
} from '../store/model.ts'

/** npm package that owns these Remote methods. */
export const PACKAGE_NAME = '@xirang-ai/dsh-teamflow'

/**
 * Cordis service key of the Host workbench.
 *
 * It is not `teamflow` because the Host already provides that key for the open
 * database handle; the wire namespace is separate (see {@link NAMESPACE}).
 */
export const SERVICE_KEY = 'teamflowWorkbench'

/** Wire namespace the browser mounts and the Host exports. */
export const NAMESPACE = 'teamflow'

/** One requirement plus its body (which is also the outline design). */
export interface SnapshotRequirement {
  readonly id: string
  readonly workspaceId: string
  readonly title: string
  readonly summary: string
  readonly status: RequirementStatus
  readonly updatedAt: string
  /** Workspace-relative path of requirement.md. */
  readonly path: string
  /** Markdown body: requirement text plus the outline; empty when `bodyMissing`. */
  readonly body: string
  /** True when the file does not exist; an existing empty file is `false` + `body: ''`. */
  readonly bodyMissing: boolean
  /** Time the user (or the all-stories rule) completed the requirement; null while open. */
  readonly completedAt: string | null
}

/** One story; `requirementId` is null for standalone work. */
export interface SnapshotStory {
  readonly id: string
  readonly workspaceId: string
  readonly requirementId: string | null
  readonly title: string
  readonly status: StoryStatus
  readonly size: StorySize
  /** Explicit display order under the parent requirement, ascending. */
  readonly sortOrder: number
  readonly createdAt: string
  readonly updatedAt: string
  /** Workspace-relative path of the story markdown. */
  readonly path: string
  /** Markdown body; `## 验收标准` is parsed by the browser into a list. */
  readonly body: string
  /** True when the file does not exist; an existing empty file is `false` + `body: ''`. */
  readonly bodyMissing: boolean
  /** Time the run last reported success; null before any finished run. */
  readonly doneAt: string | null
  /** Time the user completed the story; null while it still needs acceptance. */
  readonly completedAt: string | null
  /** Conversation that created the story; null when it was not recorded. */
  readonly createSessionId: string | null
}

/** One 详细设计 document; its body is fetched on demand by {@link readDoc}. */
export interface SnapshotDoc {
  readonly id: string
  readonly requirementId: string
  readonly kind: DocKind
  readonly title: string
  readonly sortOrder: number
  readonly createdAt: string
  readonly updatedAt: string
  /** Workspace-relative path of the document markdown. */
  readonly path: string
  readonly storyIds: readonly string[]
}

/** One defect plus its report body. */
export interface SnapshotBug {
  readonly id: string
  readonly workspaceId: string
  readonly title: string
  readonly severity: BugSeverity
  readonly status: BugStatus
  readonly resolution: string
  readonly updatedAt: string
  readonly body: string
  /** True when the file does not exist; an existing empty file is `false` + `body: ''`. */
  readonly bodyMissing: boolean
  /** Time a fix run last finished; null while the defect is still open. */
  readonly fixedAt: string | null
  /** Time the user confirmed the problem is solved; null until then. */
  readonly completedAt: string | null
  /** Conversation that created the defect; null when it was not recorded. */
  readonly createSessionId: string | null
}

/** One development or fix run; `sessionId` is the conversation it happened in. */
export interface SnapshotRun {
  readonly id: string
  readonly kind: RunKind
  readonly storyId: string | null
  readonly bugId: string | null
  readonly status: RunStatus
  readonly sessionId: string | null
  /** Permission tier the session was started with; null when none was recorded. */
  readonly permissionTier: PermissionTier | null
  readonly branch: string
  readonly summary: string
  readonly startedAt: string | null
  readonly finishedAt: string | null
}

/** One session attached to a requirement: its creator or a discussion. */
export interface SnapshotRequirementSession {
  readonly requirementId: string
  readonly sessionId: string
  readonly kind: RequirementSessionKind
  /** Browser preparation time; null for create sessions. */
  readonly preparedAt: string | null
  /** Agent confirmation time; null while a discussion is pending. */
  readonly linkedAt: string | null
  readonly createdAt: string
}

/** Everything the list, the design tree and the defect list need in one frame. */
export interface WorkbenchSnapshot {
  /** When the Host read the rows; the panel shows it next to the refresh button. */
  readonly generatedAt: string
  readonly requirements: readonly SnapshotRequirement[]
  readonly stories: readonly SnapshotStory[]
  readonly docs: readonly SnapshotDoc[]
  readonly bugs: readonly SnapshotBug[]
  readonly runs: readonly SnapshotRun[]
  readonly requirementSessions: readonly SnapshotRequirementSession[]
}

/** One document read on its own surface. */
export interface DocBody {
  readonly id: string
  readonly title: string
  readonly body: string
  /** True when the file does not exist; an existing empty file is `false` + `body: ''`. */
  readonly bodyMissing: boolean
}

/** Acknowledgement for a run the panel asked the Host to start. */
export interface StartRunReply {
  readonly runId: string
  readonly storyId: string
  /** story status after the transition; `developing` on success. */
  readonly storyStatus: StoryStatus
  /** Tier the run was recorded with; null when the caller did not pass one. */
  readonly permissionTier: PermissionTier | null
}

/** Acknowledgement for a story whose active run the panel cancelled. */
export interface CancelRunReply {
  readonly runId: string
  readonly storyId: string
  /** story status after the transition; `ready` on success. */
  readonly storyStatus: StoryStatus
}

/** Acknowledgement for a defect whose fix run the panel started or cancelled. */
export interface BugRunReply {
  readonly runId: string
  readonly bugId: string
  /** bug status after the transition; `fixing` on start, `reported` on cancel. */
  readonly bugStatus: BugStatus
  /** Tier the run was recorded with; null when the caller did not pass one. */
  readonly permissionTier: PermissionTier | null
}

/**
 * The tier a conversation was started with, as the session header needs it.
 *
 * `permissionTier` is null for a conversation the workbench never started (or
 * one started without a tier); the header renders nothing in that case rather
 * than guessing.
 */
export interface SessionTierReply {
  readonly sessionId: string
  readonly permissionTier: PermissionTier | null
}

/** Acknowledgement for a story the user completed after its run finished. */
export interface StoryStatusReply {
  readonly storyId: string
  readonly storyStatus: StoryStatus
}

/** Acknowledgement for a requirement the user completed. */
export interface RequirementStatusReply {
  readonly requirementId: string
  readonly requirementStatus: RequirementStatus
}

/** Acknowledgement for a defect the user confirmed as solved. */
export interface BugStatusReply {
  readonly bugId: string
  readonly bugStatus: BugStatus
}

/** One discussion row as stored; `linkedAt` is null until the Agent confirms. */
export interface RequirementSessionReply {
  readonly requirementId: string
  readonly sessionId: string
  readonly kind: RequirementSessionKind
  readonly preparedAt: string | null
  readonly linkedAt: string | null
}

/** Success or failure envelope the browser mounts produce. */
export type RemoteResult<Value> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

/**
 * The Host's own attachment admission limits, as the conversation composer
 * applies them.
 *
 * The Create page has no session yet, so it cannot read the `imageLimits`
 * projection the composer uses; it asks the Host for the same deployment
 * policy instead. Copying the numbers into the plugin would be a second
 * whitelist that drifts on the next DSH upgrade.
 *
 * Plain files are not covered: the Host stores them verbatim, with no type,
 * size or count limit, so neither does the page.
 */
export interface AttachmentPolicy {
  /** Image media types the Host accepts for prompts. */
  readonly mediaTypes: readonly string[]
  /** Largest single image, in bytes. */
  readonly maxImageBytes: number
  /** Most images one message may carry. */
  readonly maxImagesPerMessage: number
  /** Largest total image payload one message may carry, in bytes. */
  readonly maxMessageImageBytes: number
}

/** The namespace object the browser resolves as `remote.teamflow`. */
export interface WorkbenchRemote {
  snapshot(locale?: string): Promise<RemoteResult<WorkbenchSnapshot>>
  readDoc(docId: string, locale?: string): Promise<RemoteResult<DocBody>>
  /**
   * Record the start of a story run and move the story to `developing`.
   *
   * The browser calls this after `sessions.create` has produced an id and
   * before it sends the prompt, so the run exists by the time the Agent's
   * first tool call arrives. A null session id is accepted for the fallback
   * navigation path, which does not expose an id; the run is still recorded,
   * only the "open session" link stays empty.
   */
  startStoryRun(
    storyId: string,
    sessionId: string | null,
    locale?: string,
    permissionTier?: string | null,
  ): Promise<RemoteResult<StartRunReply>>
  /**
   * Cancel the story's active run and put the story back in the queue.
   *
   * The run tools live inside the development session. When that session is
   * closed, crashed, or never finishes, this is the only way to release a
   * story stuck in `developing` / `self_testing`; it does not abort the host
   * session, so the user may still need to stop the Agent.
   */
  cancelStoryRun(storyId: string, locale?: string): Promise<RemoteResult<CancelRunReply>>
  /**
   * Record the start of a defect fix run and move the defect to `fixing`.
   *
   * A defect is a document plus a fix run, exactly like a story plus a
   * development run: the browser creates the conversation, records the run
   * first, then sends the prompt so `teamflow_begin_self_test` has a run to
   * attach to.
   */
  startBugFixRun(
    bugId: string,
    sessionId: string | null,
    locale?: string,
    permissionTier?: string | null,
  ): Promise<RemoteResult<BugRunReply>>
  /**
   * Cancel the defect's active fix run and release it back to `reported`.
   *
   * Mirrors `cancelStoryRun`: used when the development session is gone and the
   * Agent can no longer call `teamflow_cancel_run`.
   */
  cancelBugRun(bugId: string, locale?: string): Promise<RemoteResult<BugRunReply>>
  /**
   * Complete a requirement (`draft → completed`).
   *
   * Completion is a user decision, never automatic: the panel offers it on the
   * requirement detail page, including when every story is already completed.
   */
  completeRequirement(requirementId: string, locale?: string): Promise<RemoteResult<RequirementStatusReply>>
  /** Complete a story whose run finished (`done → completed`). */
  completeStory(storyId: string, locale?: string): Promise<RemoteResult<StoryStatusReply>>
  /**
   * Cancel a story that never started (`ready` → `cancelled`).
   *
   * This is a terminal state and keeps the record; use `deleteRecords` when the
   * row should disappear instead.
   */
  cancelStory(storyId: string, locale?: string): Promise<RemoteResult<StoryStatusReply>>
  /** Complete a defect whose fix finished (`fixed → completed`). */
  completeBug(bugId: string, locale?: string): Promise<RemoteResult<BugStatusReply>>
  /**
   * Register a newly created session as waiting for the Agent to confirm it.
   *
   * The panel calls this immediately after `sessions.create`; the row stays out
   * of the snapshot until `teamflow_link_requirement_session` writes `linkedAt`.
   */
  prepareRequirementSession(
    requirementId: string,
    sessionId: string,
    kind: RequirementSessionKind,
    locale?: string,
  ): Promise<RemoteResult<RequirementSessionReply>>
  /**
   * Read the tier a conversation was started with, for the session header.
   *
   * The answer comes from the workbench's own run records, never from the
   * browser's idea of the current settings, so a reloaded session shows what it
   * actually started with — and a session without a record shows nothing.
   */
  sessionPermissionTier(sessionId: string, locale?: string): Promise<RemoteResult<SessionTierReply>>
  /** Impact of deleting the targets, computed without writing. */
  previewDelete(targets: readonly DeleteTarget[], locale?: string): Promise<RemoteResult<DeletePreview>>
  /** Physically delete the targets; per-record failures are part of the result. */
  deleteRecords(targets: readonly DeleteTarget[], locale?: string): Promise<RemoteResult<DeleteReport>>
  /**
   * Read the attachment limits the conversation composer enforces.
   *
   * Null means the Host composes no attachment store, which is also the state
   * in which the composer accepts every file unvalidated; the Create page then
   * mirrors that and stops rejecting anything.
   */
  attachmentPolicy(locale?: string): Promise<RemoteResult<AttachmentPolicy | null>>
}

/** Method names, used by both descriptor tables and diagnostics. */
export const METHODS = {
  snapshot: 'snapshot',
  readDoc: 'readDoc',
  startStoryRun: 'startStoryRun',
  cancelStoryRun: 'cancelStoryRun',
  startBugFixRun: 'startBugFixRun',
  cancelBugRun: 'cancelBugRun',
  completeRequirement: 'completeRequirement',
  completeStory: 'completeStory',
  cancelStory: 'cancelStory',
  completeBug: 'completeBug',
  prepareRequirementSession: 'prepareRequirementSession',
  sessionPermissionTier: 'sessionPermissionTier',
  previewDelete: 'previewDelete',
  deleteRecords: 'deleteRecords',
  attachmentPolicy: 'attachmentPolicy',
} as const

const JSON_SCHEMA: TypertSchema = { parse: (value: unknown) => value }

/**
 * Identity codec, marked `strict` so the client mounts it and the Host decodes
 * with the same parser. `typeSymbol` only has to be stable and unique; no
 * generated schema registry entry is involved.
 */
const JSON_CODEC: TypertCodec = Object.freeze({
  mode: 'strict',
  typeSymbol: `${PACKAGE_NAME}/types#Json`,
  schema: JSON_SCHEMA,
  create: () => JSON_SCHEMA,
})

function parameter(name: string, description: string): InvocationDescriptor['parameters'][number] {
  return Object.freeze({ name, wire: name, source: 'json', codec: JSON_CODEC, description })
}

/** Every method accepts the caller's UI locale so failures can answer in it. */
const LOCALE_PARAMETER = parameter('locale', 'Caller UI locale (BCP 47), used to localize failure messages')

/**
 * Host-side invocation table. Every method answers with a JSON snapshot, so
 * `result` is the same identity codec; the browser validates nothing and the
 * Host refuses anything that is not JSON-safe.
 */
export const DESCRIPTORS: readonly InvocationDescriptor[] = Object.freeze([
  Object.freeze({
    id: `${PACKAGE_NAME}#${METHODS.snapshot}`,
    service: SERVICE_KEY,
    namespace: NAMESPACE,
    method: METHODS.snapshot,
    invocation: { kind: 'direct' as const },
    parameters: Object.freeze([LOCALE_PARAMETER]),
    result: JSON_CODEC,
  }),
  Object.freeze({
    id: `${PACKAGE_NAME}#${METHODS.readDoc}`,
    service: SERVICE_KEY,
    namespace: NAMESPACE,
    method: METHODS.readDoc,
    invocation: { kind: 'direct' as const },
    parameters: Object.freeze([parameter('docId', 'Detailed-design document id'), LOCALE_PARAMETER]),
    result: JSON_CODEC,
  }),
  Object.freeze({
    id: `${PACKAGE_NAME}#${METHODS.startStoryRun}`,
    service: SERVICE_KEY,
    namespace: NAMESPACE,
    method: METHODS.startStoryRun,
    invocation: { kind: 'direct' as const },
    parameters: Object.freeze([
      parameter('storyId', 'story id whose development should start'),
      parameter('sessionId', 'Conversation the Agent is running in, or null'),
      LOCALE_PARAMETER,
      parameter('permissionTier', 'Permission tier id (normal, readonly, full); omitted keeps the default'),
    ]),
    result: JSON_CODEC,
  }),
  Object.freeze({
    id: `${PACKAGE_NAME}#${METHODS.cancelStoryRun}`,
    service: SERVICE_KEY,
    namespace: NAMESPACE,
    method: METHODS.cancelStoryRun,
    invocation: { kind: 'direct' as const },
    parameters: Object.freeze([
      parameter('storyId', 'story whose active run should be cancelled'),
      LOCALE_PARAMETER,
    ]),
    result: JSON_CODEC,
  }),
  Object.freeze({
    id: `${PACKAGE_NAME}#${METHODS.startBugFixRun}`,
    service: SERVICE_KEY,
    namespace: NAMESPACE,
    method: METHODS.startBugFixRun,
    invocation: { kind: 'direct' as const },
    parameters: Object.freeze([
      parameter('bugId', 'defect id whose fix should start'),
      parameter('sessionId', 'Conversation the Agent is running in, or null'),
      LOCALE_PARAMETER,
      parameter('permissionTier', 'Permission tier id (normal, readonly, full); omitted keeps the default'),
    ]),
    result: JSON_CODEC,
  }),
  Object.freeze({
    id: `${PACKAGE_NAME}#${METHODS.cancelBugRun}`,
    service: SERVICE_KEY,
    namespace: NAMESPACE,
    method: METHODS.cancelBugRun,
    invocation: { kind: 'direct' as const },
    parameters: Object.freeze([
      parameter('bugId', 'defect whose active fix run should be cancelled'),
      LOCALE_PARAMETER,
    ]),
    result: JSON_CODEC,
  }),
  Object.freeze({
    id: `${PACKAGE_NAME}#${METHODS.completeRequirement}`,
    service: SERVICE_KEY,
    namespace: NAMESPACE,
    method: METHODS.completeRequirement,
    invocation: { kind: 'direct' as const },
    parameters: Object.freeze([parameter('requirementId', 'Requirement the user completed'), LOCALE_PARAMETER]),
    result: JSON_CODEC,
  }),
  Object.freeze({
    id: `${PACKAGE_NAME}#${METHODS.completeStory}`,
    service: SERVICE_KEY,
    namespace: NAMESPACE,
    method: METHODS.completeStory,
    invocation: { kind: 'direct' as const },
    parameters: Object.freeze([parameter('storyId', 'Done story the user completed'), LOCALE_PARAMETER]),
    result: JSON_CODEC,
  }),
  Object.freeze({
    id: `${PACKAGE_NAME}#${METHODS.cancelStory}`,
    service: SERVICE_KEY,
    namespace: NAMESPACE,
    method: METHODS.cancelStory,
    invocation: { kind: 'direct' as const },
    parameters: Object.freeze([parameter('storyId', 'Idle story the user no longer wants'), LOCALE_PARAMETER]),
    result: JSON_CODEC,
  }),
  Object.freeze({
    id: `${PACKAGE_NAME}#${METHODS.completeBug}`,
    service: SERVICE_KEY,
    namespace: NAMESPACE,
    method: METHODS.completeBug,
    invocation: { kind: 'direct' as const },
    parameters: Object.freeze([parameter('bugId', 'Fixed defect the user confirmed as solved'), LOCALE_PARAMETER]),
    result: JSON_CODEC,
  }),
  Object.freeze({
    id: `${PACKAGE_NAME}#${METHODS.prepareRequirementSession}`,
    service: SERVICE_KEY,
    namespace: NAMESPACE,
    method: METHODS.prepareRequirementSession,
    invocation: { kind: 'direct' as const },
    parameters: Object.freeze([
      parameter('requirementId', 'Requirement the discussion belongs to'),
      parameter('sessionId', 'Newly created conversation to link'),
      parameter('kind', 'Discussion kind: design (outline), detail (detailed design) or split (story splitting)'),
      LOCALE_PARAMETER,
    ]),
    result: JSON_CODEC,
  }),
  Object.freeze({
    id: `${PACKAGE_NAME}#${METHODS.sessionPermissionTier}`,
    service: SERVICE_KEY,
    namespace: NAMESPACE,
    method: METHODS.sessionPermissionTier,
    invocation: { kind: 'direct' as const },
    parameters: Object.freeze([
      parameter('sessionId', 'Conversation whose recorded permission tier should be read'),
      LOCALE_PARAMETER,
    ]),
    result: JSON_CODEC,
  }),
  Object.freeze({
    id: `${PACKAGE_NAME}#${METHODS.previewDelete}`,
    service: SERVICE_KEY,
    namespace: NAMESPACE,
    method: METHODS.previewDelete,
    invocation: { kind: 'direct' as const },
    parameters: Object.freeze([
      parameter('targets', 'Records to preview: {kind: Bug|story|requirement, id}'),
      LOCALE_PARAMETER,
    ]),
    result: JSON_CODEC,
  }),
  Object.freeze({
    id: `${PACKAGE_NAME}#${METHODS.deleteRecords}`,
    service: SERVICE_KEY,
    namespace: NAMESPACE,
    method: METHODS.deleteRecords,
    invocation: { kind: 'direct' as const },
    parameters: Object.freeze([
      parameter('targets', 'Records to delete: {kind: Bug|story|requirement, id}'),
      LOCALE_PARAMETER,
    ]),
    result: JSON_CODEC,
  }),
  Object.freeze({
    id: `${PACKAGE_NAME}#${METHODS.attachmentPolicy}`,
    service: SERVICE_KEY,
    namespace: NAMESPACE,
    method: METHODS.attachmentPolicy,
    invocation: { kind: 'direct' as const },
    parameters: Object.freeze([LOCALE_PARAMETER]),
    result: JSON_CODEC,
  }),
])

/** Consumer contribution the browser mounts; the package identity must match npm. */
export const REMOTE_CONTRIBUTION = Object.freeze({
  package: PACKAGE_NAME,
  descriptors: DESCRIPTORS,
})

/**
 * Host contribution registered into the Typert registry.
 *
 * `model` is intentionally empty: the workbench exports Remote methods only, no
 * reflection metadata, so the registry stores the invocations and nothing else.
 */
export const TYPERT_MANIFEST: HostContribution = Object.freeze({
  package: PACKAGE_NAME,
  face: 'host' as const,
  schemas: Object.freeze([]),
  model: Object.freeze({
    services: Object.freeze([]),
    events: Object.freeze([]),
    objects: Object.freeze([]),
  }),
  invocations: DESCRIPTORS,
})
