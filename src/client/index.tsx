/**
 * Browser half of the Teamflow plugin.
 *
 * It contributes exactly two things: the sidebar entry and the panel page that
 * entry opens. Both are declared against Host slots, so the Web shell owns
 * layout, focus, and unload; nothing here talks to the Host beyond the
 * services it declares in `inject`.
 *
 * @module
 */
import en from '../../locale/en.json' with { type: 'json' }
import zh from '../../locale/zh.json' with { type: 'json' }
import {
  NAMESPACE as REMOTE_NAMESPACE,
  REMOTE_CONTRIBUTION,
  type AttachmentPolicy,
  type BugRunReply,
  type BugStatusReply,
  type CancelRunReply,
  type DocBody,
  type RequirementSessionReply,
  type RemoteResult,
  type RequirementStatusReply,
  type SessionTierReply,
  type StartRunReply,
  type StoryStatusReply,
  type WorkbenchRemote,
  type WorkbenchSnapshot,
} from '../remote/contract.ts'
import type { DeletePreview, DeleteReport, DeleteTarget } from '../store/model.ts'
import type {
  AgentPresetRemote,
  ClientContext,
  ConversationLike,
  ConversationOutcome,
  FileUploadLike,
  FileUploadProgress,
  LayoutLike,
  OpenConversationOptions,
  RemoteMountDisposer,
  RemoteService,
  SessionPromptPart,
  SessionsLike,
  TranslateFn,
  UiWorkspaceLike,
  UploadFailureReason,
  WorkspaceOption,
  WorkspacesLike,
} from './context.ts'
import { ComposerKindPicker } from './composer.tsx'
import { rememberComposerKind } from './composer-kind.ts'
import { isImageFile, uploadFailureReason } from './create-attachment.ts'
import { WorkbenchIcon } from './icon.tsx'
import { WorkbenchPage, type WorkbenchData } from './page.tsx'
import { createRequestedViewStore } from './requested-view.ts'
import { SessionTierBadge } from './session-tier.tsx'
import { SessionWorkbench } from './session.tsx'
import type { DetailTarget } from './session-link.ts'

/** Services this plugin needs before `apply` runs. */
export const inject = ['slots', 'locale'] as const

/** Stable identity shared by the sidebar entry and the panel page. */
export const PANEL_ID = 'teamflow.workbench'

/** Conversation View id of the read-only workbench tab. */
export const SESSION_VIEW_ID = 'teamflow.workbench.session'

/** Locale namespace owned by this plugin. */
const NAMESPACE = 'teamflow.workbench'

/** Read the Host's workspace list as plain options for the panel. */
function readWorkspaces(ctx: ClientContext): WorkspaceOption[] {
  const service = ctx.get<WorkspacesLike>('workspaces')
  if (service === undefined) return []
  try {
    return service.list.getSnapshot().items.map((entry) => ({ id: entry.workspaceId, title: entry.title }))
  } catch {
    return []
  }
}

/** Staging failure that carries the reason the page translates for its row. */
class AttachmentStageError extends Error {
  /**
   * @param fileName - the file the Host refused.
   * @param reason - translated cause bucket shown to the user.
   * @param code - the Host's error code, kept for the console log only.
   */
  constructor(
    readonly fileName: string,
    readonly reason: UploadFailureReason,
    readonly code: string | undefined,
  ) {
    super(`attachment upload failed: ${fileName} (${reason}${code === undefined ? '' : `, ${code}`})`)
    this.name = 'AttachmentStageError'
  }
}

/**
 * Store the picked files in one session and return their receipts in order.
 *
 * The Host mints a receipt per upload and only resolves it inside the agent
 * scope that stored it, so this must run after the session exists and before
 * the prompt that cites the receipts. Images go through the Host's image
 * admission (type, per-image size, per-message image budget); plain files are
 * stored verbatim, which is the same split the conversation composer makes.
 *
 * Receipts an earlier attempt already stored are reused, so a retry after a
 * storage failure uploads only what is missing instead of starting over.
 * @param ctx - browser context; needs the optional `fileUpload` service.
 * @param t - translator, for the failure text the picker shows.
 * @param sessionId - conversation that owns the staged uploads.
 * @param options - the start options carrying files, receipts and progress.
 * @returns receipt ids in the same order as the files.
 */
async function stageAttachments(
  ctx: ClientContext,
  t: TranslateFn,
  sessionId: string,
  options: OpenConversationOptions,
): Promise<readonly string[]> {
  const files = options.attachments ?? []
  if (files.length === 0) return []
  // A service this plugin does not declare in `inject`: the composer's upload
  // support may be absent from a shell, and the page then says so instead of
  // failing the whole start.
  const upload = ctx.get<FileUploadLike>('fileUpload')
  if (upload === undefined) throw new Error(t('create.attachment.unavailable'))

  const receipts: string[] = []
  for (const [index, file] of files.entries()) {
    const known = options.attachmentReceipts?.[index]
    if (known !== undefined) {
      receipts.push(known)
      continue
    }
    if (options.attachmentSignal?.aborted === true) throw new Error(t('create.attachment.cancelled'))
    options.onAttachment?.({ type: 'uploading', index })
    const report = (progress: FileUploadProgress): void =>
      options.onAttachment?.({ type: 'progress', index, progress })
    const result = isImageFile(file)
      ? await upload.uploadImage(sessionId, file, file.type, file.name, options.attachmentSignal, report)
      : await upload.upload(sessionId, file, file.name, options.attachmentSignal, report)
    if (!result.ok) {
      const code = result.error?.code
      const detail = result.error?.details?.['reason']
      const reason = uploadFailureReason(code, typeof detail === 'string' ? detail : undefined)
      options.onAttachment?.({ type: 'failed', index, reason })
      throw new AttachmentStageError(file.name, reason, code)
    }
    const receiptId = result.value?.receiptId
    if (receiptId === undefined) {
      options.onAttachment?.({ type: 'failed', index, reason: 'unknown' })
      throw new AttachmentStageError(file.name, 'unknown', undefined)
    }
    receipts.push(receiptId)
    options.onAttachment?.({ type: 'uploaded', index, receiptId })
  }
  return receipts
}

/**
 * Open a conversation for one node, with the prompt already written.
 *
 * The injected text must not land in the blank session that "新会话" opens, so
 * this creates a dedicated session and prepares its draft before navigating.
 * `startSession` is the fallback for Hosts that do not expose the session and
 * conversation services to plugins; it reuses the shared blank and is
 * therefore the less isolated path.
 *
 * When `agentPreset` is set, the preset is composed at session creation. It is
 * not selected afterwards: the registry only switches a preset on a blank
 * session, and creation avoids that race entirely.
 *
 * `autoSend` sends the prompt through the retained session instead of leaving
 * it as a draft. If the Host refuses the prompt (the session is already busy),
 * the text is written into the draft so it is not lost.
 */
async function openConversation(
  ctx: ClientContext,
  t: TranslateFn,
  workspaceId: string | undefined,
  prompt: string,
  options: OpenConversationOptions = {},
): Promise<ConversationOutcome> {
  const uiWorkspace = ctx.get<UiWorkspaceLike>('uiWorkspace')
  if (uiWorkspace === undefined) {
    return { status: 'unavailable', message: t('session.navigationUnavailable') }
  }

  const sessions = ctx.get<SessionsLike>('sessions')
  const conversation = ctx.get<ConversationLike>('conversation')
  if (sessions !== undefined && conversation !== undefined) {
    let failure: unknown
    /** The caller's pre-send hook already ran in the dedicated-session path. */
    let recorded = false
    /** The prompt was accepted by a real session; never deliver it twice. */
    let deliveredSessionId: string | undefined
    try {
      const sessionOptions: { workspaceId?: string; agentPreset?: string } = {}
      if (workspaceId !== undefined) sessionOptions.workspaceId = workspaceId
      if (options.agentPreset !== undefined) sessionOptions.agentPreset = options.agentPreset
      // An earlier attempt that failed while staging already created a session;
      // reusing it keeps retries from piling up empty conversations.
      const reused = options.attachmentSessionId
      const sessionId = reused ?? (await sessions.create(sessionOptions))
      if (reused === undefined && options.composerKind !== undefined) {
        rememberComposerKind(sessionId, options.composerKind)
      }
      options.onAttachment?.({ type: 'created', sessionId })
      const reference = sessions.retain(sessionId, { source: 'teamflowWorkbench' })
      try {
        const binding = await reference.ready
        // Picked files are staged here: the receipts only resolve inside this
        // session, and the prompt that cites them goes out right after.
        let content: SessionPromptPart[] = [{ type: 'text', text: prompt }]
        const pending = options.attachments?.length ?? 0
        if (pending > 0) {
          let receipts: readonly string[]
          try {
            receipts = await stageAttachments(ctx, t, sessionId, options)
          } catch (error) {
            reportFailure('attachment upload failed, prompt withheld', error)
            // Each row already explains its own file in the UI language; the
            // banner only has to say that something needs a retry.
            const message =
              error instanceof AttachmentStageError
                ? t('create.attachment.failedHint')
                : describeError(error)
            return { status: 'failed', sessionId, message }
          }
          content = [
            ...receipts.map((receiptId): SessionPromptPart => ({ type: 'file', receiptId })),
            { type: 'text', text: prompt },
          ]
        }
        if (options.autoSend === true) {
          if (options.beforePrompt !== undefined) {
            try {
              await options.beforePrompt(sessionId)
            } catch (error) {
              reportFailure('prompt withheld because the caller could not record the run', error)
              return { status: 'failed', sessionId, message: describeError(error) }
            }
            recorded = true
          }
          const sent = await binding.session.prompt(content, 'queue')
          if (sent.ok) {
            deliveredSessionId = sessionId
            options.onAttachment?.({ type: 'delivered' })
            uiWorkspace.openSession(sessionId)
            return { status: 'sent', sessionId }
          }
          if (pending > 0) {
            // A draft cannot carry staged receipts, so falling back to one
            // would drop the files the user just picked. Keep it retryable.
            reportFailure('prompt with attachments was refused', sent.error)
            return { status: 'failed', sessionId, message: t('create.attachment.busy') }
          }
          reportFailure('direct prompt was refused, leaving the text as a draft', sent.error)
        }
        const outcome = conversation.input.requestDraftInitialization(binding, {
          prompt,
          clearPreviousDraft: true,
        })
        options.onAttachment?.({ type: 'delivered' })
        uiWorkspace.openSession(sessionId)
        if (outcome === 'blocked') {
          return { status: 'drafted', sessionId, message: t('session.composerBusy') }
        }
        return { status: 'drafted', sessionId }
      } finally {
        reference.release()
      }
    } catch (error) {
      if (deliveredSessionId !== undefined) {
        // The prompt is queued, so opening the conversation is cosmetic: do
        // not fall back and deliver it a second time.
        reportFailure('prompt queued but the session could not be opened', error)
        return { status: 'sent', sessionId: deliveredSessionId }
      }
      if ((options.attachments?.length ?? 0) > 0) {
        // The shared blank session cannot carry staged receipts, so the
        // fallback would silently drop the files the user picked.
        reportFailure('dedicated session unavailable, attachments cannot be delivered', error)
        return { status: 'failed', message: describeError(error) }
      }
      // Falling back is correct here: a Host without draft initialisation
      // still opens a usable conversation, just with the shared blank.
      failure = error
      reportFailure('dedicated session unavailable, using the blank session', error)
    }

    if (!recorded && options.beforePrompt !== undefined) {
      try {
        await options.beforePrompt(undefined)
      } catch (error) {
        reportFailure('fallback prompt withheld because the caller could not record the run', error)
        return { status: 'failed', message: describeError(error) }
      }
    }
    // A requested preset must not be silently dropped by the fallback path.
    // `startSession` accepts the preset too, so keep it and let the Host
    // report an unknown id through its own error surface.
    uiWorkspace.startSession(workspaceId, {
      prompt,
      clearPreviousDraft: true,
      ...(options.agentPreset === undefined ? {} : { agentPreset: options.agentPreset }),
    })
    return {
      status: 'sent',
      ...(failure === undefined ? {} : { message: describeError(failure) }),
    }
  }

  if ((options.attachments?.length ?? 0) > 0) {
    // `startSession` writes into the shared blank session and cannot stage
    // files, so an attachment start needs the session services above.
    reportFailure('no session services, attachments cannot be delivered', null)
    return { status: 'failed', message: t('create.attachment.unavailable') }
  }

  if (options.beforePrompt !== undefined) {
    try {
      await options.beforePrompt(undefined)
    } catch (error) {
      reportFailure('prompt withheld because the caller could not record the run', error)
      return { status: 'failed', message: describeError(error) }
    }
  }
  uiWorkspace.startSession(workspaceId, {
    prompt,
    clearPreviousDraft: true,
    ...(options.agentPreset === undefined ? {} : { agentPreset: options.agentPreset }),
  })
  return { status: 'sent' }
}

/** Stable, user-showable text for an unknown thrown value. */
function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Surface a recoverable failure without breaking the panel. */
function reportFailure(scope: string, error: unknown): void {
  if (typeof console !== 'undefined') {
    console.warn(`[teamflow] ${scope}`, error)
  }
}

/** A promise plus its resolvers, so mounting can finish after `apply` returns. */
interface Deferred<Value> {
  readonly promise: Promise<Value>
  resolve(value: Value): void
  reject(error: unknown): void
}

/** Build a {@link Deferred}. */
function defer<Value>(): Deferred<Value> {
  let resolve: (value: Value) => void = () => undefined
  let reject: (error: unknown) => void = () => undefined
  const promise = new Promise<Value>((settle, fail) => {
    resolve = settle
    reject = fail
  })
  return { promise, resolve, reject }
}

/** Unwrap a Remote reply, turning the failure envelope into an error. */
async function callRemote<Value>(pending: Promise<RemoteResult<Value>>): Promise<Value> {
  const result = await pending
  if (result.ok) return result.value
  // The Host already answered in the caller's locale; the code stays available
  // in the message only when the Host produced no text at all.
  throw new Error(result.error.message || `teamflow: ${result.error.code}`)
}

/**
 * Mount the Remote namespace and expose it as plain promise-returning calls.
 *
 * Mounting is asynchronous while `apply` is not, so the panel gets a channel
 * that awaits the mount instead of a service it might catch half-installed.
 * The namespace is read with `ctx.get` rather than `inject`: a service this
 * plugin installs itself cannot also be a load dependency.
 *
 * @param ctx - browser context; needs the optional `remote` service.
 * @returns the loader the panel calls on mount and refresh.
 */
function createChannel(ctx: ClientContext): WorkbenchData {
  const ready = defer<WorkbenchRemote>()

  ctx.effect(() => {
    let active = true
    let unmount: RemoteMountDisposer | undefined

    const mount = async (): Promise<void> => {
      const remote = ctx.get<RemoteService>('remote')
      if (remote === undefined) {
        throw new Error('the Web shell exposes no api gateway, so the workbench cannot read the database')
      }
      const dispose = await remote.$mount(REMOTE_CONTRIBUTION)
      if (!active) {
        await dispose()
        return
      }
      unmount = dispose
      const face = ctx.get<WorkbenchRemote>(`remote.${REMOTE_NAMESPACE}`)
      if (face === undefined) {
        throw new Error(`the mounted contribution did not install the "${REMOTE_NAMESPACE}" namespace`)
      }
      ready.resolve(face)
    }

    mount().catch((error: unknown) => {
      if (!active) return
      reportFailure('workbench data channel failed to mount', error)
      ready.reject(error)
    })

    return () => {
      active = false
      if (unmount === undefined) return
      Promise.resolve(unmount()).catch((error: unknown) => reportFailure('workbench data channel failed to unmount', error))
    }
  }, 'teamflow: workbench remote')

  /** The browser's active language, sent with every Remote call. */
  const locale = (): string => ctx.locale.getLocale().active

  return {
    load: async () => callRemote<WorkbenchSnapshot>((await ready.promise).snapshot(locale())),
    readDoc: async (docId: string) =>
      callRemote<DocBody>((await ready.promise).readDoc(docId, locale())),
    startStoryRun: async (storyId: string, sessionId: string | null, permissionTier?: string | null) =>
      callRemote<StartRunReply>(
        (await ready.promise).startStoryRun(storyId, sessionId, locale(), permissionTier ?? null),
      ),
    cancelStoryRun: async (storyId: string) =>
      callRemote<CancelRunReply>((await ready.promise).cancelStoryRun(storyId, locale())),
    startBugFixRun: async (bugId: string, sessionId: string | null, permissionTier?: string | null) =>
      callRemote<BugRunReply>(
        (await ready.promise).startBugFixRun(bugId, sessionId, locale(), permissionTier ?? null),
      ),
    cancelBugRun: async (bugId: string) =>
      callRemote<BugRunReply>((await ready.promise).cancelBugRun(bugId, locale())),
    completeRequirement: async (requirementId: string) =>
      callRemote<RequirementStatusReply>((await ready.promise).completeRequirement(requirementId, locale())),
    completeStory: async (storyId: string) =>
      callRemote<StoryStatusReply>((await ready.promise).completeStory(storyId, locale())),
    completeBug: async (bugId: string) =>
      callRemote<BugStatusReply>((await ready.promise).completeBug(bugId, locale())),
    cancelStory: async (storyId: string) =>
      callRemote<StoryStatusReply>((await ready.promise).cancelStory(storyId, locale())),
    prepareRequirementSession: async (
      requirementId: string,
      sessionId: string,
      kind: 'design' | 'detail' | 'split',
    ) =>
      callRemote<RequirementSessionReply>(
        (await ready.promise).prepareRequirementSession(requirementId, sessionId, kind, locale()),
      ),
    sessionPermissionTier: async (sessionId: string) =>
      callRemote<SessionTierReply>((await ready.promise).sessionPermissionTier(sessionId, locale())),
    previewDelete: async (targets: readonly DeleteTarget[]) =>
      callRemote<DeletePreview>((await ready.promise).previewDelete(targets, locale())),
    deleteRecords: async (targets: readonly DeleteTarget[]) =>
      callRemote<DeleteReport>((await ready.promise).deleteRecords(targets, locale())),
    attachmentPolicy: async () =>
      callRemote<AttachmentPolicy | null>((await ready.promise).attachmentPolicy(locale())),
    attachmentUploadAvailable: () => ctx.get<FileUploadLike>('fileUpload') !== undefined,
  }
}

/**
 * Register the dictionaries and both slot contributions.
 * @param ctx - browser context with `slots` and `locale`.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(
    () => ctx.locale.register(NAMESPACE, { en, zh }),
    'teamflow: locale dictionaries',
  )

  const t = ctx.locale.bind(NAMESPACE)

  // The panel never imports `ctx`: it receives these two calls as props, so it
  // stays a pure function of its data and can be replayed.
  const data = createChannel(ctx)

  /**
   * Record the conversation tab's exit asked the panel to show.
   *
   * The tab and the panel are two registrations of this same plugin. The value
   * cannot be handed over as a plain `inject` member: the Host resolves a
   * root-scoped entry's `inject` once and caches it for the entry's lifetime,
   * so the panel would only ever see the request that existed before its first
   * mount. The store is published through the inject face's `hooks` instead,
   * which the Host re-reads whenever the snapshot changes.
   */
  const requestedView = createRequestedViewStore()

  /**
   * Show one record in the workbench panel of the current page.
   *
   * The panel is the same plugin page the sidebar opens, so the exit selects it
   * instead of opening a second browser tab; the requested record travels in
   * the value above and becomes the panel's initial view.
   * @param target - record the conversation tab is showing.
   * @returns whether the Host accepted the panel selection.
   */
  function openInWorkbench(target: DetailTarget): boolean {
    requestedView.request(target)
    const layout = ctx.get<LayoutLike>('layout')
    if (layout === undefined) {
      reportFailure('the Host exposes no layout, so the workbench panel cannot be opened', null)
      return false
    }
    try {
      layout.selectPanel(PANEL_ID)
      return true
    } catch (error) {
      reportFailure('the workbench panel could not be opened', error)
      return false
    }
  }

  // The `main` keyed slot must exist for `layout.selectPanel(PANEL_ID)` to
  // succeed; the sidebar entry alone would throw when clicked.
  //
  // `inject` is the only way the panel gets the workspace capability and the
  // hand-off store: the component itself stays free of `ctx`, so it can be
  // replayed and tested as a pure function of its props.
  ctx.effect(
    () =>
      ctx.slots.inject('main', () => {
        const dispose = ctx.slots.register(
          {
            name: 'main',
            key: PANEL_ID,
            locale: NAMESPACE,
            inject: () => ({
              uiWorkspace: ctx.get<UiWorkspaceLike>('uiWorkspace'),
              workspaces: readWorkspaces(ctx),
              openConversation: (
                workspaceId: string | undefined,
                prompt: string,
                options?: OpenConversationOptions,
              ) => openConversation(ctx, t, workspaceId, prompt, options),
              data,
              // `hooks` is the Host's escape hatch for a live source: it turns
              // each bare `getSnapshot`/`subscribe` pair into a `use…` prop
              // re-read on every change, which a plain member here could not be
              // (the face itself is resolved once and cached per entry).
              hooks: { requestedView },
              consumeRequestedView: () => requestedView.consume(),
            }),
          },
          WorkbenchPage,
        )
        return dispose
      }),
    'teamflow: workbench panel',
  )

  // The entry reports its own clicks because the Host cannot: selecting the
  // panel that is already selected writes the same `activePanelId` again, the
  // layout store's Immer update returns an unchanged state object, and no
  // subscriber runs. The glyph observes the row button it is rendered in and
  // asks the panel for the clean list, which is what a sidebar click means both
  // when the panel opens and when it is already open on a record.
  ctx.effect(
    () =>
      ctx.slots.inject('sidebar.panellist', () =>
        ctx.slots.register(
          {
            name: 'sidebar.panellist',
            id: PANEL_ID,
            order: 40,
            locale: NAMESPACE,
            label: () => t('panel'),
            // A stable callback, so the entry keeps working while the Host
            // caches this face for the entry's whole lifetime.
            inject: () => ({
              requestHome: () => {
                requestedView.requestHome()
              },
            }),
          },
          WorkbenchIcon,
        ),
      ),
    'teamflow: sidebar entry',
  )

  // The read-only tab lives in the conversation's own tab row, so the Host's
  // tab bar, session and streaming connection stay in place while it is open.
  // Detail rendering is shared with the panel above; the tab adds the three
  // states, the fixed exit bar and the read-only switch.
  ctx.effect(
    () =>
      ctx.slots.inject('conversation.view', () =>
        ctx.slots.register(
          {
            name: 'conversation.view',
            id: SESSION_VIEW_ID,
            order: 5,
            locale: NAMESPACE,
            label: () => t('panel'),
            inject: (sessionId?: string) => ({
              sessionId,
              workspaces: readWorkspaces(ctx),
              data,
              openInWorkbench,
            }),
          },
          SessionWorkbench,
        ),
      ),
    'teamflow: conversation workbench tab',
  )

  // The composer cell only exists while a conversation is on screen; it is
  // how a blank session started with "新会话" reaches the same interviewer
  // flows as the Create page.
  ctx.effect(
    () =>
      ctx.slots.inject('conversation.input.left', () =>
        ctx.slots.register(
          {
            name: 'conversation.input.left',
            id: 'teamflow.create-kind',
            order: 80,
            locale: NAMESPACE,
            label: () => t('composer.label'),
            inject: () => ({
              agentPresets: ctx.get<AgentPresetRemote>('remote.agentPresets'),
            }),
          },
          ComposerKindPicker,
        ),
      ),
    'teamflow: composer kind picker',
  )

  // The permission badge sits in the header's action list, next to the Host's
  // own session utilities. It is display-only and reads the workbench's run
  // record, so a session without a record renders nothing.
  ctx.effect(
    () =>
      ctx.slots.inject('conversation.session.header.actions', () =>
        ctx.slots.register(
          {
            name: 'conversation.session.header.actions',
            id: 'teamflow.permission-tier',
            order: 10,
            locale: NAMESPACE,
            inject: (sessionId?: string) => ({
              sessionId: sessionId ?? '',
              load: (id: string) => data.sessionPermissionTier(id),
            }),
          },
          SessionTierBadge,
        ),
      ),
    'teamflow: session permission badge',
  )
}
