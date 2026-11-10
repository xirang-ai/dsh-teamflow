/**
 * Host half of the workbench data channel.
 *
 * The service reads the same `WorkflowStore` the tools use and answers with
 * plain JSON; it never caches, so a refresh always reflects the database. It is
 * a `TypertRemoteService`, which is what lets the Host gateway resolve it from
 * the descriptor table in `./contract.ts` — no decorators, no code generation.
 *
 * @module
 */
import type { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import { setSandboxMode } from '@deepseek-ai/dsh-sandbox-policy'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { setApprovalPolicy } from '@deepseek-ai/dsh-user-approval'

import { translate } from '../i18n.ts'
import {
  PERMISSION_TIER_LIST,
  permissionTierDefinition,
  readPermissionTierInput,
  type PermissionTier,
} from '../permission-tier.ts'
import { WorkflowError } from '../store/model.ts'
import type { DeletePreview, DeleteReport, DeleteTarget, RequirementSessionKind } from '../store/model.ts'
import type { WorkflowStore } from '../store/workflow.ts'
import { NAMESPACE, SERVICE_KEY } from './contract.ts'
import type {
  AttachmentPolicy,
  BugRunReply,
  BugStatusReply,
  CancelRunReply,
  DocBody,
  RequirementSessionReply,
  RequirementStatusReply,
  SessionTierReply,
  StartRunReply,
  StoryStatusReply,
  WorkbenchSnapshot,
} from './contract.ts'

/**
 * Read one document body and keep "missing" distinct from "empty".
 *
 * `WorkflowStore.readContent` returns `null` for a missing file, `''` for an
 * empty one, and throws for any other I/O failure.
 */
function readBody(
  workflow: WorkflowStore,
  workspaceId: string,
  path: string,
): { readonly body: string; readonly bodyMissing: boolean } {
  const body = workflow.readContent(workspaceId, path)
  return body === null ? { body: '', bodyMissing: true } : { body, bodyMissing: false }
}

/**
 * Rebuild a failure in the caller's language.
 *
 * Store errors carry a stable `WorkflowError.code`; the browser only needs the
 * message, so the code selects a dictionary entry and the English diagnostic
 * stays available in logs/tests through the store layer.
 */
function localizedFailure(error: unknown, locale: string | undefined): Error {
  if (error instanceof WorkflowError) {
    return new WorkflowError(error.code, translate(locale, `remote.workflow.${error.code}`))
  }
  // Unexpected I/O failures have no stable code; answer with the shared
  // file-error text and keep the original error as `cause` for diagnostics.
  const failure = new WorkflowError('file_error', translate(locale, 'remote.workflow.file_error'))
  failure.cause = error
  return failure
}

/**
 * Remote face of the workbench.
 *
 * Method names and parameter order are the wire contract; changing either
 * needs the matching edit in `./contract.ts` and a client rebuild.
 */
export class WorkbenchService extends TypertRemoteService {
  // A plain property, not `#workflow`: the Gateway invokes this method on a
  // Context-derived proxy, and a private field is not reachable through it.
  private readonly workflow: WorkflowStore
  // Host context, kept for the session lookups the tier application needs.
  private readonly host: Context

  /**
   * Register the service under {@link SERVICE_KEY}.
   * @param ctx - owning Host context.
   * @param workflow - store that already owns the open database handle.
   */
  constructor(ctx: Context, workflow: WorkflowStore) {
    super(ctx, SERVICE_KEY, { namespace: NAMESPACE })
    this.workflow = workflow
    this.host = ctx
  }

  /**
   * Read one frame of the whole workbench.
   *
   * Bodies are read here rather than lazily per row: a requirement's outline
   * and its stories' bodies are small markdown files, and one round trip keeps
   * the tree consistent with the list it came from.
   * @returns rows in panel order plus their document bodies.
   */
  snapshot(locale?: string): WorkbenchSnapshot {
    try {
      const rows = this.workflow.listBoard()
      const storyIdsByDoc = new Map<string, string[]>()
      for (const link of rows.docStories) {
        const list = storyIdsByDoc.get(link.docId)
        if (list === undefined) storyIdsByDoc.set(link.docId, [link.storyId])
        else list.push(link.storyId)
      }

      return {
        generatedAt: new Date().toISOString(),
        requirements: rows.requirements.map((requirement) => ({
          id: requirement.id,
          workspaceId: requirement.workspaceId,
          title: requirement.title,
          summary: requirement.summary,
          status: requirement.status,
          updatedAt: requirement.updatedAt,
          path: requirement.contentPath,
          ...readBody(this.workflow, requirement.workspaceId, requirement.contentPath),
          completedAt: requirement.completedAt,
        })),
        stories: rows.stories.map((story) => ({
          id: story.id,
          workspaceId: story.workspaceId,
          requirementId: story.requirementId,
          title: story.title,
          status: story.status,
          size: story.size,
          sortOrder: story.sortOrder,
          createdAt: story.createdAt,
          updatedAt: story.updatedAt,
          path: story.contentPath,
          ...readBody(this.workflow, story.workspaceId, story.contentPath),
          doneAt: story.doneAt,
          completedAt: story.completedAt,
          createSessionId: story.createSessionId,
        })),
        docs: rows.docs.map((doc) => ({
          id: doc.id,
          requirementId: doc.requirementId,
          kind: doc.kind,
          title: doc.title,
          sortOrder: doc.sortOrder,
          createdAt: doc.createdAt,
          updatedAt: doc.updatedAt,
          path: doc.contentPath,
          storyIds: storyIdsByDoc.get(doc.id) ?? [],
        })),
        bugs: rows.bugs.map((bug) => ({
          id: bug.id,
          workspaceId: bug.workspaceId,
          title: bug.title,
          severity: bug.severity,
          status: bug.status,
          resolution: bug.resolution,
          updatedAt: bug.updatedAt,
          ...readBody(this.workflow, bug.workspaceId, bug.contentPath),
          fixedAt: bug.fixedAt,
          completedAt: bug.completedAt,
          createSessionId: bug.createSessionId,
        })),
        runs: rows.runs.map((run) => ({
          id: run.id,
          kind: run.kind,
          storyId: run.storyId,
          bugId: run.bugId,
          status: run.status,
          sessionId: run.sessionId,
          permissionTier: run.permissionTier,
          branch: run.branch,
          summary: run.summary,
          startedAt: run.startedAt,
          finishedAt: run.finishedAt,
        })),
        requirementSessions: rows.requirementSessions.map((session) => ({
          requirementId: session.requirementId,
          sessionId: session.sessionId,
          kind: session.kind,
          preparedAt: session.preparedAt,
          linkedAt: session.linkedAt,
          createdAt: session.createdAt,
        })),
      }
    } catch (error) {
      throw localizedFailure(error, locale)
    }
  }

  /**
   * Record the start of a story run.
   *
   * Starting is a state-machine transition rather than a plain insert: the
   * store rejects a story whose parent requirement is archived and a second
   * active run, so the panel can surface the exact reason instead of showing
   * "执行中" for work that never started.
   * The optional `permissionTier` is applied to the conversation before the
   * prompt goes out (see {@link WorkbenchService.applyPermissionTier}); an
   * invalid value is refused here, outside the workflow call, so no run row and
   * no session permission are created for a request the user has to fix first.
   * @param storyId - ready story the user clicked.
   * @param sessionId - conversation the Agent runs in, or null when unknown.
   * @param locale - caller UI locale for failure messages.
   * @param permissionTier - tier id the user picked in the run menu.
   * @returns the new run and the story status after the transition.
   */
  startStoryRun(
    storyId: string,
    sessionId: string | null,
    locale?: string,
    permissionTier?: string | null,
  ): StartRunReply {
    const id = storyId.trim()
    if (id.length === 0) throw new WorkflowError('invalid_input', translate(locale, 'remote.storyId.empty'))
    const tier = this.readTier(permissionTier, locale)
    const trimmedSession = sessionId === null ? '' : sessionId.trim()
    // Applied before the transition, and outside the workflow catch: a refused
    // tier must not be re-localized into the store's generic `invalid_input`
    // text, and no run row may exist for permissions the session never got.
    const applied = this.applyPermissionTier(trimmedSession, tier, locale)
    try {
      const run = this.workflow.startStoryRun(id, {
        ...(trimmedSession.length === 0 ? {} : { sessionId: trimmedSession }),
        ...(applied === null ? {} : { permissionTier: applied }),
      })
      const story = this.workflow.getStory(id)
      return {
        runId: run.id,
        storyId: id,
        storyStatus: story?.status ?? 'developing',
        permissionTier: applied,
      }
    } catch (error) {
      throw localizedFailure(error, locale)
    }
  }

  /**
   * Cancel the story's active run and release it back to the queue.
   *
   * The Agent normally calls `teamflow_cancel_run`; this method covers the
   * case where the session is gone and nobody can run the tool any more.
   * @param storyId - story currently in `developing` or `self_testing`.
   * @returns the cancelled run and the story status after the transition.
   */
  cancelStoryRun(storyId: string, locale?: string): CancelRunReply {
    const id = storyId.trim()
    if (id.length === 0) throw new WorkflowError('invalid_input', translate(locale, 'remote.storyId.empty'))
    try {
      const run = this.workflow.cancelStoryRun(id)
      const story = this.workflow.getStory(id)
      return { runId: run.id, storyId: id, storyStatus: story?.status ?? 'ready' }
    } catch (error) {
      throw localizedFailure(error, locale)
    }
  }

  /**
   * Record the start of a defect fix run.
   * @param bugId - defect the user clicked.
   * @param sessionId - conversation the Agent runs in, or null when unknown.
   * @param locale - caller UI locale for failure messages.
   * @param permissionTier - tier id the user picked in the run menu.
   * @returns the new run and the defect status after the transition.
   */
  startBugFixRun(
    bugId: string,
    sessionId: string | null,
    locale?: string,
    permissionTier?: string | null,
  ): BugRunReply {
    const id = bugId.trim()
    if (id.length === 0) throw new WorkflowError('invalid_input', translate(locale, 'remote.bugId.empty'))
    const tier = this.readTier(permissionTier, locale)
    const trimmedSession = sessionId === null ? '' : sessionId.trim()
    // See startStoryRun: the tier is applied before the transition and outside
    // the workflow catch so its failure keeps its own message.
    const applied = this.applyPermissionTier(trimmedSession, tier, locale)
    try {
      const run = this.workflow.startBugFixRun(id, {
        ...(trimmedSession.length === 0 ? {} : { sessionId: trimmedSession }),
        ...(applied === null ? {} : { permissionTier: applied }),
      })
      const bug = this.workflow.getBug(id)
      return { runId: run.id, bugId: id, bugStatus: bug?.status ?? 'fixing', permissionTier: applied }
    } catch (error) {
      throw localizedFailure(error, locale)
    }
  }

  /**
   * Read the attachment limits the conversation composer enforces.
   *
   * The Create page has no session yet, so the `imageLimits` projection the
   * composer reads is not available to it. This answers from the store the
   * projection is derived from, which keeps one policy for both surfaces.
   * @returns the deployment's image policy, or null when no store is composed.
   */
  attachmentPolicy(_locale?: string): AttachmentPolicy | null {
    const limits = this.host.get('attachments')?.imageLimits
    if (limits === undefined) return null
    return {
      mediaTypes: [...limits.mediaTypes],
      maxImageBytes: limits.maxImageBytes,
      maxImagesPerMessage: limits.maxImagesPerMessage,
      maxMessageImageBytes: limits.maxMessageImageBytes,
    }
  }

  /**
   * Read the tier a conversation started with, for the session header badge.
   *
   * The answer is the workbench's own record: a conversation started from the
   * run menu has one, everything else (old sessions, sessions started from
   * elsewhere) has none and the header shows no badge at all.
   * @param sessionId - conversation the header is showing.
   * @returns the recorded tier, or null.
   */
  sessionPermissionTier(sessionId: string, _locale?: string): SessionTierReply {
    const id = sessionId.trim()
    if (id.length === 0) return { sessionId: '', permissionTier: null }
    return { sessionId: id, permissionTier: this.workflow.permissionTierOfSession(id) }
  }

  /**
   * Cancel the defect's active fix run and release it back to the queue.
   * @param bugId - defect currently in `fixing`.
   * @returns the cancelled run and the defect status after the transition.
   */
  cancelBugRun(bugId: string, locale?: string): BugRunReply {
    const id = bugId.trim()
    if (id.length === 0) throw new WorkflowError('invalid_input', translate(locale, 'remote.bugId.empty'))
    try {
      const run = this.workflow.cancelBugRun(id)
      const bug = this.workflow.getBug(id)
      return { runId: run.id, bugId: id, bugStatus: bug?.status ?? 'reported', permissionTier: run.permissionTier }
    } catch (error) {
      throw localizedFailure(error, locale)
    }
  }

  /**
   * Complete a requirement the user decided is finished (`draft → completed`).
   * @param requirementId - requirement shown on the detail page.
   * @returns the requirement status after the transition.
   */
  completeRequirement(requirementId: string, locale?: string): RequirementStatusReply {
    const id = requirementId.trim()
    if (id.length === 0) throw new WorkflowError('invalid_input', translate(locale, 'remote.requirementId.empty'))
    try {
      const requirement = this.workflow.completeRequirement(id)
      return { requirementId: id, requirementStatus: requirement.status }
    } catch (error) {
      throw localizedFailure(error, locale)
    }
  }

  /**
   * Complete a story whose run finished (`done → completed`).
   * @param storyId - story in `done`.
   * @returns the story status after the transition.
   */
  completeStory(storyId: string, locale?: string): StoryStatusReply {
    const id = storyId.trim()
    if (id.length === 0) throw new WorkflowError('invalid_input', translate(locale, 'remote.storyId.empty'))
    try {
      const story = this.workflow.completeStory(id)
      return { storyId: id, storyStatus: story.status }
    } catch (error) {
      throw localizedFailure(error, locale)
    }
  }

  /**
   * Confirm a defect's problem is solved (`fixed → completed`).
   * @param bugId - defect in `fixed`.
   * @returns the defect status after the transition.
   */
  completeBug(bugId: string, locale?: string): BugStatusReply {
    const id = bugId.trim()
    if (id.length === 0) throw new WorkflowError('invalid_input', translate(locale, 'remote.bugId.empty'))
    try {
      const bug = this.workflow.completeBug(id)
      return { bugId: id, bugStatus: bug.status }
    } catch (error) {
      throw localizedFailure(error, locale)
    }
  }

  /**
   * Cancel a story that has not started (`ready` → `cancelled`).
   * @param storyId - idle story the user no longer wants.
   * @returns the story status after the transition.
   */
  cancelStory(storyId: string, locale?: string): StoryStatusReply {
    const id = storyId.trim()
    if (id.length === 0) throw new WorkflowError('invalid_input', translate(locale, 'remote.storyId.empty'))
    try {
      const story = this.workflow.cancelStory(id)
      return { storyId: id, storyStatus: story.status }
    } catch (error) {
      throw localizedFailure(error, locale)
    }
  }

  /**
   * Register a newly created conversation as a pending requirement discussion.
   *
   * The Agent confirms it later with `teamflow_link_requirement_session`; until
   * then the row is intentionally absent from {@link snapshot}.
   * @param requirementId - requirement the user started from.
   * @param sessionId - session created by the browser for this discussion.
   * @param kind - `design` for the outline design, `detail` for the detailed
   * design, `split` for story splitting.
   * @returns the stored pending row.
   */
  prepareRequirementSession(
    requirementId: string,
    sessionId: string,
    kind: RequirementSessionKind = 'design',
    locale?: string,
  ): RequirementSessionReply {
    const requirement = requirementId.trim()
    const session = sessionId.trim()
    if (requirement.length === 0) throw new WorkflowError('invalid_input', translate(locale, 'remote.requirementId.empty'))
    if (session.length === 0) throw new WorkflowError('invalid_input', translate(locale, 'remote.sessionId.empty'))
    try {
      const row = this.workflow.prepareRequirementSession(requirement, session, kind)
      return {
        requirementId: row.requirementId,
        sessionId: row.sessionId,
        kind: row.kind,
        preparedAt: row.preparedAt,
        linkedAt: row.linkedAt,
      }
    } catch (error) {
      throw localizedFailure(error, locale)
    }
  }

  /**
   * Compute deletion impact without writing anything.
   * @param targets - records the user selected in the panel.
   * @returns per-record impact, cascaded detailed-design documents and skip reasons.
   */
  previewDelete(targets: readonly DeleteTarget[], locale?: string): DeletePreview {
    try {
      return this.workflow.previewDeletions(targets)
    } catch (error) {
      throw localizedFailure(error, locale)
    }
  }

  /**
   * Physically delete the selected records.
   * @param targets - records the user confirmed in the dialog.
   * @returns success/failure for every record; never all-or-nothing.
   */
  deleteRecords(targets: readonly DeleteTarget[], locale?: string): DeleteReport {
    try {
      const report = this.workflow.deleteRecords(targets)
      return {
        ...report,
        results: report.results.map((result) =>
          result.ok
            ? result
            : {
                ...result,
                error: {
                  code: result.error?.code ?? 'file_error',
                  message: translate(locale, `remote.workflow.${result.error?.code ?? 'file_error'}`),
                },
              },
        ),
      }
    } catch (error) {
      throw localizedFailure(error, locale)
    }
  }

  /**
   * Read one detailed-design document body.
   * @param docId - document id shown in the requirement's document tree.
   * @returns the document, or a `not_found` failure when the id is unknown.
   */
  readDoc(docId: string, locale?: string): DocBody {
    const id = docId.trim()
    if (id.length === 0) throw new WorkflowError('invalid_input', translate(locale, 'remote.docId.empty'))
    const doc = this.workflow.getDesignDoc(id)
    if (doc === null) {
      throw new WorkflowError('not_found', translate(locale, 'remote.doc.notFound', { id }))
    }
    const requirement = this.workflow.getRequirement(doc.requirementId)
    if (requirement === null) {
      throw new WorkflowError(
        'not_found',
        translate(locale, 'remote.doc.requirementMissing', { id, requirementId: doc.requirementId }),
      )
    }
    try {
      return {
        id: doc.id,
        title: doc.title,
        ...readBody(this.workflow, requirement.workspaceId, doc.contentPath),
      }
    } catch (error) {
      throw localizedFailure(error, locale)
    }
  }

  /**
   * Validate the optional tier parameter, answering in the caller's language.
   *
   * Missing, null and empty all mean "not passed"; anything that is not one of
   * the three tier ids is refused with the legal values spelled out. The
   * message is built here rather than through `localizedFailure`, because the
   * store's generic `invalid_input` text would drop the detail the user needs.
   * @param raw - what the caller sent.
   * @param locale - caller UI locale.
   * @returns the tier, or null when the caller did not choose one.
   */
  private readTier(raw: string | null | undefined, locale: string | undefined): PermissionTier | null {
    const parsed = readPermissionTierInput(raw)
    if (!parsed.ok) {
      throw new WorkflowError(
        'invalid_input',
        translate(locale, 'remote.permissionTier.invalid', { value: parsed.value, tiers: PERMISSION_TIER_LIST }),
      )
    }
    return parsed.tier
  }

  /**
   * Apply a tier to the conversation before its first prompt.
   *
   * Both entry points call this one helper, so the main button and the menu
   * cannot drift apart. The two knobs come from the Host itself —
   * `setSandboxMode`/`setApprovalPolicy` are their documented write paths — and
   * the tier is only recorded once both writes succeeded, which keeps the
   * header badge tied to the permissions the session actually got.
   *
   * A null tier leaves the session untouched (the pre-existing default). A
   * session id the Host cannot resolve (the fallback navigation path, or a
   * session that vanished) also yields null: the run is still recorded, but no
   * tier is claimed for it.
   * @param sessionId - conversation id, empty when the caller has none.
   * @param tier - validated tier, or null for "not passed".
   * @returns the tier that is now recorded, or null.
   */
  private applyPermissionTier(
    sessionId: string,
    tier: PermissionTier | null,
    locale?: string,
  ): PermissionTier | null {
    if (tier === null || sessionId.length === 0) return null
    // `get` rather than `ctx.sessions`: the session store is an optional
    // dependency of this plugin (headless profiles and unit tests run without
    // it), and an undeclared property read is a hard error in Cordis.
    const sessions = this.host.get('sessions')
    if (sessions === undefined) return null
    const session = sessions.get(SessionId(sessionId))
    if (session === undefined) return null
    const definition = permissionTierDefinition(tier)
    try {
      setSandboxMode(session, definition.sandbox)
      setApprovalPolicy(session, definition.approval)
    } catch (error) {
      // The knobs are Host write paths; a refusal (a session that is no longer
      // live in this store, for instance) must reach the user as a failed
      // start rather than a run recorded with permissions the session never got.
      this.host.logger('teamflow').warn(
        `permission tier "${tier}" was not applied to session "${sessionId}": ${String(error)}`,
      )
      throw new WorkflowError(
        'invalid_input',
        translate(locale, 'remote.permissionTier.applyFailed', { tier, message: String(error) }),
      )
    }
    return tier
  }
}
