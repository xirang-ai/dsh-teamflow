/**
 * The slice of the browser plugin context this plugin uses, typed locally.
 *
 * The Host's client packages publish their own types, but they are resolved at
 * runtime by the Web shell, not installed in this repository. Declaring the
 * used surface here keeps the plugin honest about what it depends on instead
 * of importing types it cannot resolve.
 *
 * @module
 */
import type { ComponentType } from 'react'

import type { ComposerKind } from './composer-kind.ts'

/** Undo callback returned by every registration and effect. */
export type Disposer = () => void

/** Translate function bound to one namespace. */
export interface TranslateFn {
  (key: string, params?: Record<string, string | number>): string
}

/** One locale's message table. */
export type LocaleDictionary = Record<string, string>

/** Locale service: registers dictionaries and binds a `t` for them. */
export interface LocaleService {
  register(namespace: string, dictionaries: Record<string, LocaleDictionary>): Disposer
  bind(namespace: string): TranslateFn
  /** Current immutable locale snapshot; `active` is the BCP 47 tag sent to the Host. */
  getLocale(): { readonly active: string }
}

/** Options accepted by a slot registration. */
export interface SlotOptions {
  readonly name: string
  /** List-slot identity (`sidebar.panellist`) or keyed-slot key (`main`). */
  readonly id?: string
  readonly key?: string
  /** Ordering inside a list slot; lower comes first. */
  readonly order?: number
  /** Namespace whose `t` is handed to the rendered component as `props.t`. */
  readonly locale?: string
  /** Sidebar label; resolved through the locale service at read time. */
  readonly label?: () => string
  /**
   * Extra props for the component, resolved when the slot renders.
   *
   * This is the supported way to hand a capability (workspace navigation,
   * remote face) to a component that must stay free of `ctx`. Session-scoped
   * slots also receive the bound conversation id, which is how a contribution
   * addresses the session it renders for.
   */
  readonly inject?: (sessionId?: string) => Record<string, unknown>
}

/** The Web shell's layout actions, as this plugin uses them. */
export interface LayoutLike {
  /** Select one registered `main` panel by its key. */
  selectPanel(panelId: string | null): void
}

/**
 * Host navigation, as this panel uses it.
 *
 * Both calls hand the session to the Host so the native conversation view takes
 * over; the panel never renders a conversation itself.
 */
export interface UiWorkspaceLike {
  /** Select an existing session and show it in the main region. */
  openSession(target: string): void
  /**
   * Open a blank session with its composer pre-filled.
   *
   * `clearPreviousDraft` matters: without it the Host keeps whatever the user
   * left in the blank session, and the injected prompt is silently dropped.
   */
  startSession(
    workspaceId: string | undefined,
    options: {
      readonly prompt?: string
      readonly clearPreviousDraft?: boolean
      /** Preset id composed for the new session, when the caller needs one. */
      readonly agentPreset?: string
    },
  ): void
  /**
   * Archive a session and clear it when it is the current selection.
   *
   * Optional: it is only used to clean up a session the create page opened and
   * then abandoned, so a Host without it simply leaves that conversation.
   */
  archiveSession?(sessionId: string, options?: { readonly stopActivity?: boolean }): Promise<void>
}

/**
 * One DSH workspace, as the workbench needs it.
 *
 * The panel never manages workspaces itself: they are created, renamed and
 * deleted in DSH's own UI, and this list is only projected for filtering and
 * for showing which workspace a node belongs to.
 */
export interface WorkspaceOption {
  readonly id: string
  readonly title: string
}

/** The workspace service the panel reads its options from. */
export interface WorkspacesLike {
  readonly list: {
    getSnapshot(): { readonly items: ReadonlyArray<{ workspaceId: string; title: string }> }
  }
}

/**
 * The workspace list as the Host keeps it live.
 *
 * `phase` is the arrival lifecycle: `pending` means the panel has not yet
 * received the authoritative list, so an empty `items` there must not be read
 * as "no workspaces exist". Only `ready` may be used to drop remembered ids.
 */
export interface WorkspaceListLike {
  readonly items: ReadonlyArray<{ readonly workspaceId: string; readonly title: string }>
  readonly phase: 'pending' | 'ready'
}

/**
 * The Host's standard `useWorkspaces` slot prop.
 *
 * Every slot receives this snapshot selector. The panel reads it instead of
 * taking a one-time copy of the list, so a workspace deleted (or added) while
 * the Create page is open disappears from the quick picks immediately.
 */
export type UseWorkspaces = <Selected>(
  selector: (state: WorkspaceListLike) => Selected,
  equal?: (left: Selected, right: Selected) => boolean,
) => Selected

/**
 * Workspace-list state before the Host reports one.
 *
 * Used only when a slot renders without the standard hook (tests or a minimal
 * shell); `pending` keeps the panel from treating "not asked yet" as "none".
 */
export const EMPTY_WORKSPACE_LIST: WorkspaceListLike = { items: [], phase: 'pending' }

/**
 * Stand-in for the Host's `useWorkspaces` when a slot renders without it.
 *
 * The selector still runs so callers keep one unconditional hook-call shape;
 * `pending` tells the panel the empty list is "not known yet", not "none".
 */
export const useEmptyWorkspaces: UseWorkspaces = (selector) => selector(EMPTY_WORKSPACE_LIST)

/**
 * One accepted/rejected direct prompt.
 *
 * The Host answers with a Remote envelope; a rejected prompt is a normal
 * outcome (the session may already be running), not an exception.
 */
export interface SessionPromptResult {
  readonly ok: boolean
  readonly error?: { readonly message?: string }
}

/**
 * One part of a prompt this plugin sends.
 *
 * Files and images both travel as a staged upload receipt: the Host resolves
 * the receipt inside the receiving session's Agent scope, which is why the
 * upload must target the session the prompt goes to.
 */
export type SessionPromptPart =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'file'; readonly receiptId: string }

/** The retained session face this plugin prompts directly. */
export interface SessionBindingLike {
  readonly session: {
    prompt(
      content: ReadonlyArray<SessionPromptPart>,
      mode: 'queue' | 'steer',
    ): Promise<SessionPromptResult>
  }
}

/** Byte progress of one browser upload. */
export interface FileUploadProgress {
  readonly loaded: number
  readonly total?: number
}

/** One staged upload as the Host returns it. */
export interface StagedUpload {
  readonly receiptId: string
}

/**
 * The Host's browser upload service (`fileUpload`), as this plugin uses it.
 *
 * Both entry points store bytes for one session and answer with a receipt the
 * next prompt cites. The session must exist: the Create page therefore creates
 * the conversation first and uploads before sending.
 */
export interface FileUploadLike {
  upload(
    sessionId: string,
    data: Blob,
    name?: string,
    signal?: AbortSignal,
    onProgress?: (progress: FileUploadProgress) => void,
  ): Promise<RemoteCallResult<StagedUpload>>
  uploadImage(
    sessionId: string,
    data: Blob,
    mediaType: string,
    name?: string,
    signal?: AbortSignal,
    onProgress?: (progress: FileUploadProgress) => void,
  ): Promise<RemoteCallResult<StagedUpload>>
}

/** What the start flow reports while it stages picked files. */
/**
 * Coarse cause of a failed upload, translated by the page instead of showing
 * the Host's own English message.
 *
 * `rejected` means the Host refused the content itself (damaged image, wrong
 * media type), `storage` means it could not persist it, `network` means the
 * request never completed, and `unknown` covers everything else.
 */
export type UploadFailureReason = 'rejected' | 'storage' | 'network' | 'unknown'

export type AttachmentEvent =
  | { readonly type: 'created'; readonly sessionId: string }
  | { readonly type: 'uploading'; readonly index: number }
  | { readonly type: 'progress'; readonly index: number; readonly progress: FileUploadProgress }
  | { readonly type: 'uploaded'; readonly index: number; readonly receiptId: string }
  | { readonly type: 'failed'; readonly index: number; readonly reason: UploadFailureReason }
  /** The prompt (and its files) is queued; the session must not be abandoned. */
  | { readonly type: 'delivered' }


/**
 * One session row as the Host's list exposes it.
 *
 * Only the display label is needed here; the id is the record key.
 */
export interface SessionSummaryLike {
  /** Durable title, then project basename, then the session id. */
  readonly displayTitle?: string
}

/** Session-list snapshot: every known id mapped to its summary row. */
export interface SessionListLike {
  readonly byId: Readonly<Record<string, SessionSummaryLike | undefined>>
}

/**
 * The Host's standard `useSessions` slot prop.
 *
 * Every slot receives this snapshot selector; the workbench uses it to rerender
 * when a conversation title arrives or changes while a detail page is open.
 */
export type UseSessions = <Selected>(
  selector: (state: SessionListLike) => Selected,
  equal?: (left: Selected, right: Selected) => boolean,
) => Selected

/**
 * Session-list state with no rows.
 *
 * Used only when a slot is rendered without the Host's standard hook (tests or
 * a minimal shell), so the component still has a stable snapshot to call.
 */
export const EMPTY_SESSION_LIST: SessionListLike = { byId: {} }

/**
 * Live status of one session, as the Host's `useSessionStatus` exposes it.
 *
 * `running` is absent until the Host has a baseline for that session, so the
 * chart treats "unknown" as not running instead of flickering.
 */
export interface SessionStatusLike {
  readonly running?: boolean | undefined
}

/** Live session status indexed by session id. */
export type SessionStatusMap = ReadonlyMap<string, SessionStatusLike>

/**
 * The Host's standard `useSessionStatus` slot prop.
 *
 * The shell merges this into every slot's props, so the workbench can tell
 * which requirement sessions are executing right now.
 */
export type UseSessionStatus = <Selected>(
  selector: (state: SessionStatusMap) => Selected,
  equal?: (left: Selected, right: Selected) => boolean,
) => Selected

/** Session-status snapshot with no entries, for shells that omit the hook. */
export const EMPTY_SESSION_STATUS: SessionStatusMap = new Map()

/** Session creation and retention, as the workbench start flow uses it. */
export interface SessionsLike {
  create(options?: {
    readonly workspaceId?: string
    /** Preset composed for the new agent; unknown ids make creation fail. */
    readonly agentPreset?: string
  }): Promise<string>
  retain(
    target: string,
    options: { readonly source: string },
  ): {
    readonly ready: Promise<SessionBindingLike>
    release(): void
  }
}

/** The conversation surface that accepts a prepared draft. */
export interface ConversationLike {
  readonly input: {
    requestDraftInitialization(
      binding: unknown,
      options: { readonly prompt?: string; readonly clearPreviousDraft?: boolean },
    ): string
  }
}

/** How a conversation start ended. */
export type ConversationStatus = 'sent' | 'drafted' | 'unavailable' | 'failed'

/** Result of starting a conversation, including a user-showable failure. */
export interface ConversationOutcome {
  readonly status: ConversationStatus
  /**
   * Session the prompt was sent to or drafted in.
   *
   * Absent on `unavailable`, and on the fallback path that relies on the
   * Host's shared blank session, which does not expose an id.
   */
  readonly sessionId?: string
  /**
   * Present for `unavailable`, `failed`, and for a draft that could not be
   * written. A `failed` outcome means a pre-send hook refused the attempt, so
   * the prompt was never delivered.
   */
  readonly message?: string
}

/** Extra behaviour for {@link OpenConversation}. */
export interface OpenConversationOptions {
  /** Preset id composed for the new session. */
  readonly agentPreset?: string
  /** Send the first message immediately instead of leaving it as a draft. */
  readonly autoSend?: boolean
  /** Visible creation kind for the composer; remembered per session. */
  readonly composerKind?: ComposerKind
  /**
   * Runs after the session exists and before the first prompt is sent.
   *
   * Throwing aborts the start: no prompt is delivered and the outcome is
   * `failed`. The workbench uses this to record the development run first, so
   * the Agent cannot call a run tool before its run exists.
   */
  readonly beforePrompt?: (sessionId: string | undefined) => Promise<void> | void
  /**
   * Files to stage into the new session and send with the first prompt.
   *
   * They are uploaded after the session exists and before the prompt is sent,
   * because a receipt only resolves inside the session that stored it. The
   * prompt text arrives after the files, so the Agent sees the message and its
   * attachments as one turn.
   */
  readonly attachments?: readonly File[]
  /**
   * Session an earlier attempt already created, reused instead of creating a
   * second one. A failed upload otherwise leaves an empty conversation behind.
   */
  readonly attachmentSessionId?: string
  /** Receipts already stored by an earlier attempt, keyed by file index. */
  readonly attachmentReceipts?: Readonly<Record<number, string>>
  /** Cancels in-flight uploads (the page aborts it when it is left). */
  readonly attachmentSignal?: AbortSignal
  /** Progress of the staging phase, for the picker's own status list. */
  readonly onAttachment?: (event: AttachmentEvent) => void
}

/**
 * Opens a conversation for one workbench node.
 *
 * Implemented by the plugin entry so the component stays free of `ctx`.
 */
export type OpenConversation = (
  workspaceId: string | undefined,
  prompt: string,
  options?: OpenConversationOptions,
) => Promise<ConversationOutcome>

/** Failure/success envelope every Remote method resolves to. */
export interface RemoteCallResult<Value> {
  readonly ok: boolean
  readonly value?: Value
  readonly error?: {
    readonly code?: string
    readonly message?: string
    /** Structured payload the owner attached; the upload flow reads `reason`. */
    readonly details?: Readonly<Record<string, unknown>>
  }
}

/** One preset row returned by the registry. */
export interface AgentPresetRowLike {
  readonly id: string
  readonly isDefault?: boolean
}

/** Preset registry face injected into the composer and Create page. */
export interface AgentPresetRemote {
  select(agentId: string, agentPreset: string): Promise<RemoteCallResult<string>>
  list(): Promise<RemoteCallResult<{ presets: readonly AgentPresetRowLike[] }>>
}

/** Slot registry: registration plus waiting for a slot to exist. */
export interface SlotService {
  register<Props>(options: SlotOptions, component: ComponentType<Props>): Disposer
  inject(slot: string, declare: () => Disposer): Disposer
}

/**
 * One Remote contribution the browser mounts.
 *
 * The descriptors are the shared table from `src/remote/contract.ts`; the Web
 * shell validates them and installs the namespace as a Cordis service named
 * `remote.<namespace>`.
 */
export interface RemoteContribution {
  readonly package: string
  readonly descriptors: readonly unknown[]
}

/** Undo callback `$mount` resolves with; unmounting may be asynchronous. */
export type RemoteMountDisposer = () => void | Promise<void>

/** The Host's api-gateway client service, as the plugin mounts against it. */
export interface RemoteService {
  /**
   * Register the descriptors and install the namespace service.
   *
   * Called once per plugin load; the returned disposer unregisters both. A
   * namespace may not be injected through `inject` — it does not exist until
   * this resolves, and injecting it before it does would deadlock the fiber.
   */
  $mount(contribution: RemoteContribution): Promise<RemoteMountDisposer>
}

/** Browser context handed to `apply`. */
export interface ClientContext {
  effect(setup: () => Disposer | void, label?: string): Disposer
  readonly locale: LocaleService
  readonly slots: SlotService
  /** Read an optional service; `undefined` when the providing plugin is absent. */
  get<T>(name: string): T | undefined
}
