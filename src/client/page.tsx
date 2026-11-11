/**
 * The workbench panel: the default list of unfinished work, a requirement's
 * document tree, and the detailed-design reader.
 *
 * Opening a conversation is not this panel's job — a node click hands the
 * session to the Host through `uiWorkspace`, so the native conversation view
 * takes over. Nothing here reads `ctx`; the slot injects `t` and the workspace
 * capability, which keeps the component replayable and testable as a pure
 * function of props.
 *
 * @module
 */
import { MarkdownDelegateProvider, MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactElement, ReactNode } from 'react'

import type {
  AttachmentPolicy,
  BugRunReply,
  BugStatusReply,
  CancelRunReply,
  DiscussionSessionReply,
  DocBody,
  RequirementSessionReply,
  RequirementStatusReply,
  SessionTierReply,
  StartRunReply,
  StoryStatusReply,
  WorkbenchSnapshot,
} from '../remote/contract.ts'
import { EMPTY_BOARD, LANE_ORDER, buildBoard, formatWhen, requirementLane, runState } from './board.ts'
import type {
  BugNode,
  DetailDoc,
  ListItem,
  ListLane,
  NodeState,
  DiscussionSessionNode,
  RequirementNode,
  StoryNode,
} from './board.ts'
import { buildFileTree, normalizePath, resolveMarkdownHref } from './files.ts'
import type { FileTreeNode } from './files.ts'
import { useEmptyRequestedView } from './requested-view.ts'
import type { UseRequestedView } from './requested-view.ts'
import { sessionDisplayTitle, useEmptySessions } from './session-title.ts'
import type {
  BugSeverity,
  BugStatus,
  DeletePreview,
  DeletePreviewItem,
  DeleteReport,
  DeleteTarget,
  DeletableKind,
  DiscussionSubjectType,
  RequirementStatus,
} from '../store/model.ts'
import { DEV_PRESET, buildBugDevPrompt, buildDevPrompt } from '../dev.ts'
import {
  buildRecordDiscussionPrompt,
  buildRequirementDiscussionPrompt,
  presetForRecordDiscussion,
  presetForRequirementDiscussion,
  type RecordDiscussionKind,
  type RequirementDiscussionKind,
} from '../requirement-discussion.ts'
import { CREATE_PRESET, buildCreatePrompt, type CreateDraft } from '../create.ts'
import {
  useEmptyWorkspaces,
  type AttachmentEvent,
  type OpenConversation,
  type TranslateFn,
  type UiWorkspaceLike,
  type UseSessionStatus,
  type UseSessions,
  type UseWorkspaces,
  type WorkspaceOption,
} from './context.ts'
import { fileKey, uploadPercent } from './create-attachment.ts'
import { CreateSurface } from './create.tsx'
import type { CreateSurfaceDraft, CreateUploadState, CreateUploadStatus } from './create.tsx'
import { RequirementFlow } from './flow.tsx'
import { FLOW_TARGETS, flowNodeTarget, flowStoryTarget } from './flow-model.ts'
import type { FlowNode } from './flow-model.ts'
import {
  AlertGlyph,
  ChatGlyph,
  ChevronRight,
  FileGlyph,
  FolderGlyph,
  HistoryGlyph,
  InfoGlyph,
  PlayGlyph,
  PlusGlyph,
  RefreshGlyph,
  TrashGlyph,
} from './icons.tsx'
import { RunTierControl, type RunStartOutcome } from './run-tier.tsx'
import { DEFAULT_PERMISSION_TIER, type PermissionTier } from '../permission-tier.ts'
import { STYLES } from './styles.ts'
import { NavBar } from './nav.tsx'
import type { NavCrumb } from './nav.tsx'

/**
 * Host queries the panel needs.
 *
 * The slot injects the pair once the Remote contribution is mounted; both
 * functions reject with a message the panel can show, so the component never
 * handles wire envelopes itself.
 */
export interface WorkbenchData {
  /** Read one frame of the whole workbench. */
  readonly load: () => Promise<WorkbenchSnapshot>
  /** Read one detailed-design document body. */
  readonly readDoc: (docId: string) => Promise<DocBody>
  /**
   * Record the start of a story run once its conversation exists.
   *
   * `permissionTier` is the tier the user picked in the run menu; omitted (or
   * null) keeps the pre-existing default behaviour.
   */
  readonly startStoryRun: (
    storyId: string,
    sessionId: string | null,
    permissionTier?: string | null,
  ) => Promise<StartRunReply>
  /** Cancel the story's active run when the Agent session cannot finish it. */
  readonly cancelStoryRun: (storyId: string) => Promise<CancelRunReply>
  /** Record the start of a defect fix run once its conversation exists. */
  readonly startBugFixRun: (
    bugId: string,
    sessionId: string | null,
    permissionTier?: string | null,
  ) => Promise<BugRunReply>
  /** Read the tier a conversation was started with (null when none was recorded). */
  readonly sessionPermissionTier: (sessionId: string) => Promise<SessionTierReply>
  /** Cancel the defect's active fix run when the Agent session cannot finish it. */
  readonly cancelBugRun: (bugId: string) => Promise<BugRunReply>
  /** Complete a requirement the user decided is finished. */
  readonly completeRequirement: (requirementId: string) => Promise<RequirementStatusReply>
  /** Complete a story whose run already finished. */
  readonly completeStory: (storyId: string) => Promise<StoryStatusReply>
  /** Confirm a fixed defect's problem is solved. */
  readonly completeBug: (bugId: string) => Promise<BugStatusReply>
  readonly cancelStory: (storyId: string) => Promise<StoryStatusReply>
  /** Register the pending requirement binding before the user sends the first message. */
  readonly prepareRequirementSession: (
    requirementId: string,
    sessionId: string,
    kind: RequirementDiscussionKind,
  ) => Promise<RequirementSessionReply>
  /** Register the pending story or defect binding before the user sends the first message. */
  readonly prepareDiscussionSession: (
    subjectType: DiscussionSubjectType,
    subjectId: string,
    sessionId: string,
    kind: string,
  ) => Promise<DiscussionSessionReply>
  /** Compute deletion impact; the Host never writes during a preview. */
  readonly previewDelete: (targets: readonly DeleteTarget[]) => Promise<DeletePreview>
  /** Physically delete the confirmed records. */
  readonly deleteRecords: (targets: readonly DeleteTarget[]) => Promise<DeleteReport>
  /**
   * Read the Host's attachment rules so the create page mirrors them.
   *
   * Optional: an older Host composition returns nothing, which leaves the page
   * accepting every file rather than inventing limits of its own.
   */
  readonly attachmentPolicy?: () => Promise<AttachmentPolicy | null>
  /** Whether this build exposes the Host upload service the page stages through. */
  readonly attachmentUploadAvailable?: () => boolean
}

/**
 * A create submission that already opened a session.
 *
 * A failure after the session exists must not open a second one: the retry
 * reuses it and skips the files whose receipts were already staged.
 */
interface CreateAttempt {
  readonly workspaceId: string
  readonly kind: CreateDraft['kind']
  /** Set once the start flow reported the session it created. */
  sessionId: string | undefined
  /** Receipts staged so far, keyed by file identity so removals keep matching. */
  readonly receipts: Map<string, string>
  /** The prompt reached the session; the attempt is no longer reusable. */
  delivered: boolean
}

/** Props injected by the slot renderer for this registration. */
export interface WorkbenchPageProps {
  /** Translator bound to this plugin's namespace. */
  readonly t: TranslateFn
  /** Host queries for the workbench rows. */
  readonly data: WorkbenchData
  /** Host navigation capability; absent when the workspace plugin is not loaded. */
  readonly uiWorkspace?: UiWorkspaceLike
  /** DSH workspaces, used to filter and to label each node. */
  readonly workspaces?: readonly WorkspaceOption[]
  /** Opens a conversation for a node, creating a dedicated session when possible. */
  readonly openConversation?: OpenConversation
  /**
   * Pending request from outside the panel, as a live source (the Host converts
   * it into this hook from the inject face's `hooks`).
   *
   * Two routes publish here: the conversation tab's exit names a record, and a
   * click on the sidebar entry asks for the clean list.
   *
   * The panel is a root-scoped entry, so its injected props are resolved once
   * and cached for the entry's lifetime; a plain value would freeze at first
   * mount and every later 【在息壤工作台中打开】 would land on the list.
   * Optional only for direct component tests and minimal shells, where no
   * request is ever pending.
   */
  readonly useRequestedView?: UseRequestedView
  /**
   * Tell the plugin the pending request was acted on.
   *
   * Without this, the hand-off would replay: the recorded detail would reopen
   * on the next visit instead of the list, and a list request would keep firing
   * on every mount. The request is one-shot.
   */
  readonly consumeRequestedView?: () => void
  /**
   * Host's standard session-list hook.
   *
   * Optional only for direct component tests and minimal shells; every Host
   * slot renderer passes it. It keeps linked-conversation titles current when a
   * title is generated while this page is already open.
   */
  readonly useSessions?: UseSessions
  /**
   * Host's standard live-session-status hook.
   *
   * Drives the flowing outline on the progress chart; optional for component
   * tests and minimal shells, which simply see no session as running.
   */
  readonly useSessionStatus?: UseSessionStatus
  /**
   * Host's standard live-workspace-list hook.
   *
   * The panel's injected `workspaces` are resolved once when the entry is
   * created, so a workspace deleted while the panel is open would stay in the
   * copy. The Create page reads this live list instead, which is what lets the
   * quick picks only offer workspaces that still exist. Optional for component
   * tests and minimal shells, which fall back to the injected list.
   */
  readonly useWorkspaces?: UseWorkspaces
}

/** Workspace shown when the Host exposes none (fresh profile, no directories). */
/** Placeholder id shown when the Host exposes no workspaces; its label is localized at render time. */
export const FALLBACK_WORKSPACE = { id: 'ws-local' } as const

/** Fields that keep Alt+← for text editing instead of panel navigation. */
const TEXT_ENTRY_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

type Tab = 'open' | 'running' | 'ready' | 'done'

type View =
  | { readonly kind: 'list' }
  | { readonly kind: 'create' }
  | { readonly kind: 'requirement'; readonly id: string }
  | { readonly kind: 'story'; readonly id: string; readonly requirementId: string | null }
  | { readonly kind: 'doc'; readonly requirementId: string; readonly path: string }
  | { readonly kind: 'bug'; readonly id: string }

/** One file link target, resolved from a path found in a markdown document. */
type FileTarget =
  | { readonly kind: 'requirement'; readonly requirement: RequirementNode }
  | { readonly kind: 'doc'; readonly requirement: RequirementNode; readonly doc: DetailDoc }
  | { readonly kind: 'story'; readonly story: StoryNode; readonly requirement?: RequirementNode }

interface Toast {
  readonly seq: number
  readonly text: string
}

/** The pending deletion confirmation; `preview` is null while the Host computes it. */
interface DeleteConfirmState {
  readonly targets: readonly DeleteTarget[]
  readonly preview: DeletePreview | null
  readonly loading: boolean
  readonly error: string | null
}

/** One lifecycle decision waiting for confirmation. */
interface StoryDecisionState {
  readonly kind: 'complete-story' | 'cancel-story' | 'cancel-run' | 'complete-requirement' | 'complete-bug'
  readonly story?: StoryNode
  readonly requirement?: RequirementNode
  readonly bug?: BugNode
  readonly busy: boolean
  readonly error: string | null
}

/** Title of whichever record the pending decision is about. */
function decisionSubject(state: StoryDecisionState): string {
  return state.story?.title ?? state.requirement?.title ?? state.bug?.title ?? ''
}

/** One click target on a list row or tree node. */
interface Action {
  readonly label: string
  readonly tone: 'primary' | 'soft' | 'live' | 'ghost'
  readonly icon: ReactElement
}

const ICONS: Record<Action['tone'], ReactElement> = {
  primary: <PlayGlyph />,
  soft: <PlayGlyph />,
  live: <ChatGlyph />,
  ghost: <HistoryGlyph />,
}

/** Kinds of detailed-design documents, as locale keys. */
/** Localized bug status; the store keeps the machine name. */
function bugStatusLabel(t: TranslateFn, status: BugStatus): string {
  return t(`bug.status.${status}`)
}

/** Localized requirement status; the store keeps the machine name. */
function requirementStatusLabel(t: TranslateFn, status: RequirementStatus): string {
  return t(`requirement.status.${status}`)
}

/** Map the bug workflow onto the same pill tones as requirement and story rows. */
function bugTone(status: BugStatus): 'running' | 'ready' | 'done' | 'muted' {
  switch (status) {
    case 'fixing':
      return 'running'
    case 'reported':
      return 'ready'
    case 'wontfix':
      return 'muted'
    default:
      return 'done'
  }
}

/** Localized bug severity; the store keeps the machine name. */
function bugSeverityLabel(t: TranslateFn, severity: BugSeverity): string {
  return t(`bug.severity.${severity}`)
}

const DOC_KINDS: Record<string, string> = {
  interface: 'doc.kind.interface',
  data: 'doc.kind.data',
  flow: 'doc.kind.flow',
  page: 'doc.kind.page',
  rule: 'doc.kind.rule',
}

/** One-line message out of a thrown value, for a toast or a banner. */
export function failureMessage(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure)
}

/**
 * Render Markdown with the Web shell's shared renderer.
 *
 * The primitives package owns GFM, tables, task lists, fenced code, math and
 * link safety; this wrapper only supplies locale chrome and resolves local
 * links against the file that contains them. `labels` is memoized because the
 * renderer keys its streaming cache on that identity.
 */
function MarkdownBody({
  text,
  t,
  basePath,
  onOpenPath,
  onMissing,
}: {
  readonly text: string
  readonly t: TranslateFn
  readonly basePath?: string
  readonly onOpenPath?: (path: string) => void
  readonly onMissing?: (href: string) => void
}): ReactElement {
  const labels = useMemo(
    () => ({
      code: {
        copyLabel: t('markdown.copy'),
        copiedLabel: t('markdown.copied'),
        toolbarLabels: {
          codeLabel: t('markdown.code'),
          wrapLabel: t('markdown.wrap'),
          unwrapLabel: t('markdown.unwrap'),
        },
      },
      footnotes: t('markdown.footnotes'),
    }),
    [t],
  )
  const openFile = useCallback(
    (target: string) => {
      if (basePath === undefined) return
      const resolved = resolveMarkdownHref(basePath, target)
      if (resolved === null) onMissing?.(target)
      else onOpenPath?.(resolved)
    },
    [basePath, onMissing, onOpenPath],
  )
  return (
    <MarkdownDelegateProvider openFile={basePath === undefined ? undefined : openFile}>
      <MarkdownText text={text} labels={labels} />
    </MarkdownDelegateProvider>
  )
}

/** A section title with a rule, optional hint and an optional trailing action. */
function SectionHead({
  title,
  hint,
  action,
}: {
  readonly title: string
  readonly hint?: string
  readonly action?: ReactNode
}): ReactElement {
  return (
    <div className="tf-section-head">
      <span className="tf-section-title">{title}</span>
      {hint !== undefined ? <span className="tf-section-hint">{hint}</span> : null}
      {action === undefined ? null : <span className="tf-section-action">{action}</span>}
    </div>
  )
}

/** The single startable story of a requirement, when there is exactly one. */
function loneReadyStory(requirement: RequirementNode): StoryNode | undefined {
  const ready = requirement.stories.filter((story) => story.state === 'ready')
  return ready.length === 1 ? ready[0] : undefined
}

/**
 * Render the workbench panel.
 * @param props - translator, Host queries and workspace capability from the slot.
 * @returns the panel surface.
 */
export function WorkbenchPage({
  t,
  data,
  uiWorkspace,
  workspaces,
  openConversation,
  useRequestedView,
  consumeRequestedView,
  useSessions,
  useSessionStatus,
  useWorkspaces,
}: WorkbenchPageProps): ReactElement {
  // The Host's session list is the only source of conversation titles; reading
  // it through its standard hook keeps a title that arrives after first render
  // in sync. The stand-in keeps the hook call unconditional in tests.
  const sessionList = (useSessions ?? useEmptySessions)((state) => state)
  const sessionTitle = useCallback(
    (sessionId: string) => sessionDisplayTitle(sessionList, sessionId),
    [sessionList],
  )
  // The request the conversation tab handed over, read through the Host's
  // observable binding: a plain prop would be resolved once per entry and go
  // stale, which is exactly what used to leave every click on the list page.
  const requested = (useRequestedView ?? useEmptyRequestedView)((state) => state)
  // The workspace list is read live too: a workspace deleted (or renamed) while
  // the panel is open must leave both the picker and the quick-pick row at once,
  // so the Create page can never offer something the Host no longer has. The
  // injected `workspaces` prop is only the fallback for shells without the hook.
  const workspaceSnapshot = (useWorkspaces ?? useEmptyWorkspaces)((state) => state)
  const liveWorkspaces = useMemo<readonly WorkspaceOption[]>(
    () =>
      useWorkspaces === undefined
        ? (workspaces ?? [])
        : workspaceSnapshot.items.map((entry) => ({ id: entry.workspaceId, title: entry.title })),
    [useWorkspaces, workspaceSnapshot.items, workspaces],
  )
  const workspacesReady = useWorkspaces === undefined ? true : workspaceSnapshot.phase === 'ready'
  const [view, setView] = useState<View>(() =>
    requested !== null && requested.kind === 'record' ? requested.target : { kind: 'list' },
  )
  const [tab, setTab] = useState<Tab>('open')
  const [query, setQuery] = useState('')
  const [workspace, setWorkspace] = useState('')
  const [toast, setToast] = useState<Toast | null>(null)
  const [deleted, setDeleted] = useState<string | null>(null)
  const [snapshot, setSnapshot] = useState<WorkbenchSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [docBodies, setDocBodies] = useState<Readonly<Record<string, string>>>({})
  const [createBusy, setCreateBusy] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [discussionBusy, setDiscussionBusy] = useState<RequirementDiscussionKind | null>(null)
  const [recordDiscussionBusy, setRecordDiscussionBusy] = useState<RecordDiscussionKind | null>(null)
  const [cleanup, setCleanup] = useState(false)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [confirm, setConfirm] = useState<DeleteConfirmState | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [report, setReport] = useState<DeleteReport | null>(null)
  const [skippedByPreview, setSkippedByPreview] = useState(0)
  const [decision, setDecision] = useState<StoryDecisionState | null>(null)
  // Attachment rules come from the Host; the page never keeps a second copy of
  // the allow-list. `undefined` means "not read yet" so a slow read does not
  // block the form, `null` means the Host composes no attachment store.
  const [attachmentPolicy, setAttachmentPolicy] = useState<AttachmentPolicy | null | undefined>(undefined)
  const [attachmentAvailable, setAttachmentAvailable] = useState(true)
  // Keyed by `fileKey`: a row keeps its own upload state, and removing a file
  // cannot shift another row's progress or error onto its neighbour.
  const [createUploads, setCreateUploads] = useState<Readonly<Record<string, CreateUploadState>>>({})
  const createAttempt = useRef<CreateAttempt | null>(null)
  const createAbort = useRef<AbortController | null>(null)

  /**
   * Frame guard for the two async paths below: the panel can be unmounted while
   * a read is in flight (the user switched to another sidebar panel).
   */
  const mounted = useRef(true)
  // Read at unmount: the cleanup must not depend on the prop's identity, or a
  // re-render would archive an attempt that is still running.
  const navigation = useRef(uiWorkspace)
  useEffect(() => {
    navigation.current = uiWorkspace
  }, [uiWorkspace])
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      // Leaving the panel stops whatever the form was staging and clears the
      // session it opened, so no half-filled conversation is left behind.
      createAbort.current?.abort()
      createAbort.current = null
      const attempt = createAttempt.current
      createAttempt.current = null
      if (attempt === null || attempt.sessionId === undefined || attempt.delivered) return
      void navigation.current?.archiveSession?.(attempt.sessionId, { stopActivity: true }).catch(() => {
        // Best effort: failing to archive only leaves an empty conversation.
      })
    }
  }, [])

  useEffect(() => {
    let live = true
    setAttachmentAvailable(data.attachmentUploadAvailable?.() ?? true)
    const read = data.attachmentPolicy
    if (read === undefined) {
      // No Remote method: nothing to mirror, so the form admits every file.
      setAttachmentPolicy(null)
      return () => {
        live = false
      }
    }
    read()
      .then((policy) => {
        if (live) setAttachmentPolicy(policy)
      })
      .catch(() => {
        // A failed read must not hide the attachment area: unknown limits mean
        // "no local validation", never a silently disabled picker.
        if (live) setAttachmentPolicy(null)
      })
    return () => {
      live = false
    }
  }, [data])

  /** Nav bar's Back control; focused after a view change for keyboard users. */
  const backRef = useRef<HTMLButtonElement>(null)
  /** The scrolling viewport, reset to the top whenever the view changes. */
  const scrollRef = useRef<HTMLDivElement>(null)

  const board = useMemo(() => (snapshot === null ? EMPTY_BOARD : buildBoard(snapshot)), [snapshot])
  const standaloneById = useMemo(
    () => new Map(board.standalone.map((item) => [item.story.id, item])),
    [board],
  )

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const next = await data.load()
      if (!mounted.current) return
      setSnapshot(next)
      setError(null)
    } catch (failure) {
      if (mounted.current) setError(failureMessage(failure))
    } finally {
      if (mounted.current) setLoading(false)
    }
  }, [data])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const showToast = useCallback((text: string) => {
    setToast({ seq: Date.now(), text })
  }, [])

  // A selection belongs to one filter frame: changing the tab, search or
  // workspace must not leave hidden rows queued for deletion.
  useEffect(() => {
    setSelected(new Set())
  }, [tab, query, workspace])

  useEffect(() => {
    if (toast === null) return
    const timer = window.setTimeout(() => setToast(null), 4200)
    return () => window.clearTimeout(timer)
  }, [toast])

  /** Workspace options come from the Host; rows carry the real workspace id. */
  const workspaceOptions = useMemo<readonly WorkspaceOption[]>(
    () =>
      workspaces !== undefined && workspaces.length > 0
        ? workspaces
        : [{ id: FALLBACK_WORKSPACE.id, title: t('workspace.local') }],
    [t, workspaces],
  )

  const workspaceOf = useCallback(
    (workspaceId: string): WorkspaceOption =>
      workspaceOptions.find((option) => option.id === workspaceId) ?? {
        id: workspaceId,
        title: workspaceId.length > 0 ? workspaceId : t('workspace.local'),
      },
    [t, workspaceOptions],
  )

  const openSession = useCallback(
    (sessionId: string | undefined) => {
      if (sessionId === undefined) return
      try {
        if (uiWorkspace === undefined) throw new Error('workspace navigation is unavailable')
        uiWorkspace.openSession(sessionId)
      } catch {
        // The session under a run can be gone (deleted or from another Host).
        // The modal explains that instead of leaking a Host error into a toast.
        setDeleted(sessionId)
      }
    },
    [uiWorkspace],
  )

  const openDoc = useCallback(
    (requirement: RequirementNode, path: string) => {
      setView({ kind: 'doc', requirementId: requirement.id, path })
      const doc = requirement.docs.find((entry) => entry.path === path)
      if (doc === undefined || docBodies[doc.id] !== undefined) return
      data
        .readDoc(doc.id)
        .then((result) => {
          if (mounted.current) setDocBodies((current) => ({ ...current, [result.id]: result.body }))
        })
        .catch((failure: unknown) => {
          if (mounted.current) showToast(t('doc.readFailed', { message: failureMessage(failure) }))
        })
    },
    [data, docBodies, showToast, t],
  )

  /** Every path a markdown link may point at, across requirements and standalone stories. */
  const fileIndex = useMemo(() => {
    const map = new Map<string, FileTarget>()
    const add = (path: string, target: FileTarget): void => {
      const normalized = normalizePath(path)
      if (normalized !== null && !map.has(normalized)) map.set(normalized, target)
    }
    for (const requirement of board.requirements) {
      add(requirement.path, { kind: 'requirement', requirement })
      for (const doc of requirement.docs) add(doc.path, { kind: 'doc', requirement, doc })
      for (const story of requirement.stories) add(story.path, { kind: 'story', story, requirement })
    }
    for (const item of board.standalone) add(item.story.path, { kind: 'story', story: item.story })
    return map
  }, [board])

  /**
   * Follow a link found in a document.
   *
   * The markdown author writes a path relative to the file, and the same path
   * may name a requirement, a detailed-design document or a story. Resolving
   * through the index keeps all three navigable; anything else is reported
   * instead of silently doing nothing.
   */
  const openFile = useCallback(
    (raw: string) => {
      const path = normalizePath(raw)
      const target = path === null ? undefined : fileIndex.get(path)
      if (target === undefined) {
        showToast(t('doc.linkMissing', { path: raw }))
        return
      }
      if (target.kind === 'story') {
        setView({
          kind: 'story',
          id: target.story.id,
          requirementId: target.requirement?.id ?? null,
        })
        return
      }
      openDoc(
        target.requirement,
        target.kind === 'requirement' ? target.requirement.path : target.doc.path,
      )
    },
    [fileIndex, openDoc, showToast, t],
  )

  const startStory = useCallback(
    async (
      story: StoryNode,
      requirement?: RequirementNode,
      tier: PermissionTier = DEFAULT_PERMISSION_TIER,
    ): Promise<RunStartOutcome> => {
      const open = openConversation
      if (open === undefined) {
        showToast(t('toast.startUnavailable'))
        return { ok: false, message: t('toast.startUnavailable') }
      }
      const workspaceId = requirement?.workspaceId ?? standaloneById.get(story.id)?.workspaceId
      if (workspaceId === undefined) {
        showToast(t('toast.startUnavailable'))
        return { ok: false, message: t('toast.startUnavailable') }
      }
      let outcome: Awaited<ReturnType<OpenConversation>>
      try {
        outcome = await open(workspaceId, buildDevPrompt(story, requirement), {
          agentPreset: DEV_PRESET,
          autoSend: true,
          // The run must exist before the prompt is delivered: the Agent's very
          // first tool call may already be `teamflow_begin_self_test`. The tier
          // rides on this same call, so the permissions are in place before the
          // first model request.
          beforePrompt: async (sessionId) => {
            await data.startStoryRun(story.id, sessionId ?? null, tier)
          },
        })
      } catch (failure) {
        if (mounted.current) showToast(t('toast.startFailed', { title: story.title }))
        return { ok: false, message: failureMessage(failure) }
      }
      if (!mounted.current) return { ok: true }
      if (outcome.status === 'unavailable') {
        showToast(t('toast.startUnavailable'))
        return { ok: false, message: t('toast.startUnavailable') }
      }
      if (outcome.status === 'failed') {
        // The pre-send hook refused, so no prompt was delivered and no run
        // exists; the story was never moved out of `ready`.
        showToast(
          t('toast.startRunFailed', {
            title: story.title,
            message: outcome.message ?? '',
          }),
        )
        return { ok: false, message: outcome.message ?? t('run.startFailed') }
      }
      if (outcome.status === 'drafted') {
        // The run was recorded before the prompt attempt, but the prompt
        // never reached the Agent. Release the story instead of leaving
        // it `developing` with nobody working on it.
        try {
          await data.cancelStoryRun(story.id)
        } catch (failure) {
          if (mounted.current) {
            showToast(
              t('toast.cancelRunFailed', {
                title: story.title,
                message: failureMessage(failure),
              }),
            )
          }
          return { ok: false, message: failureMessage(failure) }
        }
        if (!mounted.current) return { ok: false, message: t('run.startFailed') }
        showToast(t('toast.startDrafted', { title: story.title }))
        void refresh()
        return { ok: false, message: t('run.drafted') }
      }
      showToast(t('toast.started', { title: story.title }))
      void refresh()
      return { ok: true }
    },
    [data, openConversation, refresh, showToast, standaloneById, t],
  )

  const startBugFix = useCallback(
    async (bug: BugNode, tier: PermissionTier = DEFAULT_PERMISSION_TIER): Promise<RunStartOutcome> => {
      const open = openConversation
      if (open === undefined) {
        showToast(t('toast.startUnavailable'))
        return { ok: false, message: t('toast.startUnavailable') }
      }
      let outcome: Awaited<ReturnType<OpenConversation>>
      try {
        outcome = await open(
          bug.workspaceId,
          buildBugDevPrompt({
            id: bug.id,
            title: bug.title,
            severity: bug.severity,
            body: bug.content.join('\n'),
          }),
          {
            agentPreset: DEV_PRESET,
            autoSend: true,
            beforePrompt: async (sessionId) => {
              await data.startBugFixRun(bug.id, sessionId ?? null, tier)
            },
          },
        )
      } catch (failure) {
        if (mounted.current) showToast(t('toast.bugStartFailed', { title: bug.title }))
        return { ok: false, message: failureMessage(failure) }
      }
      if (!mounted.current) return { ok: true }
      if (outcome.status === 'unavailable') {
        showToast(t('toast.startUnavailable'))
        return { ok: false, message: t('toast.startUnavailable') }
      }
      if (outcome.status === 'failed') {
        showToast(
          t('toast.bugStartRunFailed', {
            title: bug.title,
            message: outcome.message ?? '',
          }),
        )
        return { ok: false, message: outcome.message ?? t('run.startFailed') }
      }
      if (outcome.status === 'drafted') {
        try {
          await data.cancelBugRun(bug.id)
        } catch (failure) {
          if (mounted.current) {
            showToast(
              t('toast.cancelBugRunFailed', {
                title: bug.title,
                message: failureMessage(failure),
              }),
            )
          }
          return { ok: false, message: failureMessage(failure) }
        }
        if (!mounted.current) return { ok: false, message: t('run.startFailed') }
        showToast(t('toast.bugStartDrafted', { title: bug.title }))
        void refresh()
        return { ok: false, message: t('run.drafted') }
      }
      showToast(t('toast.bugStarted', { title: bug.title }))
      void refresh()
      return { ok: true }
    },
    [data, openConversation, refresh, showToast, t],
  )

  const cancelBugFix = useCallback(
    (bug: BugNode) => {
      data
        .cancelBugRun(bug.id)
        .then(() => {
          if (!mounted.current) return
          showToast(t('toast.bugRunCancelled', { title: bug.title }))
          void refresh()
        })
        .catch((failure: unknown) => {
          if (mounted.current) {
            showToast(
              t('toast.cancelBugRunFailed', {
                title: bug.title,
                message: failureMessage(failure),
              }),
            )
          }
        })
    },
    [data, refresh, showToast, t],
  )

  /**
   * Leave the form. An attempt that already opened a session is archived so the
   * staged uploads do not linger as an empty conversation.
   */
  const cancelCreate = useCallback(() => {
    createAbort.current?.abort()
    createAbort.current = null
    const attempt = createAttempt.current
    createAttempt.current = null
    setCreateUploads({})
    setCreateError(null)
    setView({ kind: 'list' })
    if (attempt !== null && attempt.sessionId !== undefined && !attempt.delivered) {
      const abandoned = attempt.sessionId
      void uiWorkspace?.archiveSession?.(abandoned, { stopActivity: true }).catch(() => {
        // Archiving is best effort: a failure only leaves an empty conversation.
      })
    }
  }, [uiWorkspace])

  /**
   * Show the clean list: no record, no filter frame, no batch-delete frame, no
   * queued selection.
   *
   * This is what a click on the sidebar entry means, whether the panel is
   * already open on a record or the same entry is selected again. The form
   * leaves through `cancelCreate` — the same path its own Back button uses — so
   * the staged session is archived once and the upload rows are dropped instead
   * of lingering as a half-filled conversation.
   *
   * A panel that already shows the clean list is left completely untouched: it
   * must not re-render, re-scroll or reload because the entry was clicked
   * again.
   */
  const showHome = useCallback(() => {
    if (view.kind === 'create') {
      cancelCreate()
    } else if (view.kind !== 'list') {
      setView({ kind: 'list' })
    }
    if (cleanup || tab !== 'open' || query !== '' || workspace !== '' || selected.size > 0) {
      setCleanup(false)
      setTab('open')
      setQuery('')
      setWorkspace('')
      setSelected(new Set())
    }
  }, [cancelCreate, cleanup, query, selected, tab, view, workspace])

  // The two routes into this panel hand over one request each: the conversation
  // tab names a record, the sidebar entry asks for the clean list. Mounting
  // usually already picks a pending request up through `useState`, but a click
  // while this panel is still mounted must act on it as well. The hand-off is
  // one-shot: after acting the panel clears the request, so a later visit does
  // not replay it — a cleared request reads as `null`, which is a no-op here
  // and stops the effect from looping.
  useEffect(() => {
    if (requested === null) return
    if (requested.kind === 'record') {
      setView(requested.target)
    } else {
      showHome()
    }
    consumeRequestedView?.()
  }, [requested, consumeRequestedView, showHome])

  const submitCreate = useCallback(
    (draft: CreateSurfaceDraft) => {
      const open = openConversation
      if (open === undefined) {
        setCreateError(t('create.unavailable'))
        return
      }
      const files = draft.attachments
      // A retry reuses the session the previous attempt opened, but only while
      // it still matches the preset and workspace the user picked.
      const previous = createAttempt.current
      const attempt: CreateAttempt = {
        workspaceId: draft.workspaceId,
        kind: draft.kind,
        sessionId: previous?.workspaceId === draft.workspaceId && previous.kind === draft.kind
          ? previous.sessionId
          : undefined,
        receipts: previous?.workspaceId === draft.workspaceId && previous.kind === draft.kind
          ? previous.receipts
          : new Map<string, string>(),
        delivered: false,
      }
      createAttempt.current = attempt
      // Already staged files are not uploaded twice; their receipts only
      // resolve inside the session they were staged for.
      const receipts: Record<number, string> = {}
      files.forEach((file, index) => {
        const receipt = attempt.receipts.get(fileKey(file))
        if (receipt !== undefined) receipts[index] = receipt
      })
      const initial = (status: CreateUploadStatus): CreateUploadState => ({ status })
      setCreateUploads(
        Object.fromEntries(
          files.map((file, index) => [
            fileKey(file),
            initial(receipts[index] === undefined ? 'queued' : 'uploaded'),
          ]),
        ),
      )
      const abort = new AbortController()
      createAbort.current?.abort()
      createAbort.current = abort
      setCreateBusy(true)
      setCreateError(null)

      /** Mirror one staging event into the row it belongs to. */
      const track = (event: AttachmentEvent): void => {
        if (event.type === 'created') {
          attempt.sessionId = event.sessionId
          return
        }
        if (event.type === 'delivered') {
          // Queued before the panel unmounts into the conversation, so the
          // unmount cleanup below leaves this session alone.
          attempt.delivered = true
          return
        }
        const file = files[event.index]
        if (file === undefined) return
        const key = fileKey(file)
        if (event.type === 'uploaded') attempt.receipts.set(key, event.receiptId)
        if (!mounted.current) return
        setCreateUploads((current) => {
          let row: CreateUploadState
          switch (event.type) {
            case 'uploading':
              row = { status: 'uploading' }
              break
            case 'progress': {
              const percent = uploadPercent(event.progress)
              row = percent === undefined ? { status: 'uploading' } : { status: 'uploading', percent }
              break
            }
            case 'uploaded':
              row = { status: 'uploaded' }
              break
            case 'failed':
              row = { status: 'failed', reason: event.reason }
              break
            default:
              return current
          }
          return { ...current, [key]: row }
        })
      }

      open(draft.workspaceId, buildCreatePrompt(draft), {
        agentPreset: CREATE_PRESET[draft.kind],
        autoSend: true,
        composerKind: draft.kind,
        ...(files.length === 0
          ? {}
          : {
              attachments: files,
              attachmentReceipts: receipts,
              attachmentSignal: abort.signal,
              onAttachment: track,
              ...(attempt.sessionId === undefined ? {} : { attachmentSessionId: attempt.sessionId }),
            }),
      })
        .then((outcome) => {
          if (!mounted.current) return
          if (outcome.status === 'failed' || outcome.status === 'unavailable') {
            // The draft, the picked files and the session stay; the rows keep
            // whatever they reached so a retry only continues from there.
            setCreateError(outcome.message ?? t('create.failed'))
            return
          }
          attempt.delivered = true
          createAttempt.current = null
          createAbort.current = null
          setCreateUploads({})
          setView({ kind: 'list' })
          showToast(
            outcome.status === 'sent' ? t('create.sent') : (outcome.message ?? t('create.drafted')),
          )
        })
        .catch((failure: unknown) => {
          if (mounted.current) setCreateError(failureMessage(failure))
        })
        .finally(() => {
          if (createAbort.current === abort) createAbort.current = null
          if (mounted.current) setCreateBusy(false)
        })
    },
    [openConversation, showToast, t],
  )

  const startRequirementDiscussion = useCallback(
    (requirement: RequirementNode, kind: RequirementDiscussionKind) => {
      const open = openConversation
      if (open === undefined) {
        showToast(t('toast.startUnavailable'))
        return
      }
      setDiscussionBusy(kind)
      open(requirement.workspaceId, buildRequirementDiscussionPrompt(kind), {
        agentPreset: presetForRequirementDiscussion(kind),
        autoSend: false,
        composerKind: kind,
      })
        .then(async (outcome) => {
          if (outcome.status === 'unavailable') {
            if (mounted.current) {
              showToast(outcome.message ?? t('toast.discussionFailed', { title: requirement.title }))
            }
            return
          }
          if (outcome.sessionId === undefined) {
            if (mounted.current) {
              showToast(t('toast.discussionDrafted', { title: requirement.title }))
            }
            return
          }
          // Opening the session unmounts the workbench panel, so the binding
          // must be written before the mounted guard below.

          try {
            await data.prepareRequirementSession(requirement.id, outcome.sessionId, kind)
            if (!mounted.current) return
            showToast(
              outcome.status === 'drafted'
                ? t('toast.discussionDrafted', { title: requirement.title })
                : t('toast.discussionStarted', { title: requirement.title }),
            )
          } catch (failure) {
            if (!mounted.current) return
            showToast(
              t('toast.discussionLinkFailed', {
                title: requirement.title,
                message: failureMessage(failure),
              }),
            )
          }
        })
        .catch(() => {
          if (mounted.current) showToast(t('toast.discussionFailed', { title: requirement.title }))
        })
        .finally(() => {
          if (mounted.current) setDiscussionBusy(null)
        })
    },
    [data, openConversation, showToast, t],
  )

  const startRecordDiscussion = useCallback(
    (subject: { readonly kind: RecordDiscussionKind; readonly id: string; readonly title: string; readonly workspaceId: string }) => {
      const open = openConversation
      if (open === undefined) {
        showToast(t('toast.startUnavailable'))
        return
      }
      setRecordDiscussionBusy(subject.kind)
      open(subject.workspaceId, buildRecordDiscussionPrompt(subject.kind, subject.title), {
        agentPreset: presetForRecordDiscussion(subject.kind),
        autoSend: false,
        composerKind: subject.kind,
      })
        .then(async (outcome) => {
          if (outcome.status === 'unavailable') {
            if (mounted.current) {
              showToast(outcome.message ?? t('toast.discussionFailed', { title: subject.title }))
            }
            return
          }
          if (outcome.sessionId === undefined) {
            if (mounted.current) {
              showToast(t('toast.discussionDrafted', { title: subject.title }))
            }
            return
          }
          // Opening the session unmounts the workbench panel, so the binding
          // must be written before the mounted guard below.
          try {
            await data.prepareDiscussionSession(subject.kind, subject.id, outcome.sessionId, 'discuss')
            if (!mounted.current) return
            showToast(
              outcome.status === 'drafted'
                ? t('toast.discussionDrafted', { title: subject.title })
                : t('toast.discussionStarted', { title: subject.title }),
            )
          } catch (failure) {
            if (!mounted.current) return
            showToast(
              t('toast.discussionLinkFailed', {
                title: subject.title,
                message: failureMessage(failure),
              }),
            )
          }
        })
        .catch(() => {
          if (mounted.current) showToast(t('toast.discussionFailed', { title: subject.title }))
        })
        .finally(() => {
          if (mounted.current) setRecordDiscussionBusy(null)
        })
    },
    [data, openConversation, showToast, t],
  )

  const requirementAction = useCallback(
    (requirement: RequirementNode): Action | null => {
      if (requirement.state === 'running') {
        return { label: t('row.open'), tone: 'live', icon: ICONS.live }
      }
      const lone = loneReadyStory(requirement)
      return lone === undefined ? null : { label: t('row.start'), tone: 'soft', icon: ICONS.soft }
    },
    [t],
  )

  const runRequirementAction = useCallback(
    (requirement: RequirementNode) => {
      if (requirement.state === 'running' || requirement.state === 'done') {
        openSession(requirement.sessionId)
        return
      }
      const lone = loneReadyStory(requirement)
      if (lone !== undefined) startStory(lone, requirement)
    },
    [openSession, startStory],
  )

  /** Apply the confirmed lifecycle action and refresh the board. */
  const decideStory = useCallback(async () => {
    if (decision === null) return
    const current = decision
    setDecision({ ...current, busy: true, error: null })
    try {
      if (current.kind === 'complete-story' && current.story !== undefined) {
        await data.completeStory(current.story.id)
      } else if (current.kind === 'cancel-story' && current.story !== undefined) {
        await data.cancelStory(current.story.id)
      } else if (current.kind === 'cancel-run' && current.story !== undefined) {
        await data.cancelStoryRun(current.story.id)
      } else if (current.kind === 'complete-requirement' && current.requirement !== undefined) {
        await data.completeRequirement(current.requirement.id)
      } else if (current.kind === 'complete-bug' && current.bug !== undefined) {
        await data.completeBug(current.bug.id)
      } else {
        throw new Error('teamflow: incomplete lifecycle action.')
      }
    } catch (failure) {
      if (mounted.current) {
        setDecision((current) =>
          current === null ? null : { ...current, busy: false, error: failureMessage(failure) },
        )
      }
      return
    }
    if (!mounted.current) return
    setDecision(null)
    const title = decisionSubject(current)
    showToast(
      current.kind === 'complete-story'
        ? t('toast.completed', { title })
        : current.kind === 'cancel-story'
          ? t('toast.storyCancelled', { title })
          : current.kind === 'cancel-run'
            ? t('toast.runCancelled', { title })
            : current.kind === 'complete-requirement'
              ? t('toast.requirementCompleted', { title })
              : t('toast.bugCompleted', { title }),
    )
    void refresh()
  }, [data, decision, refresh, showToast, t])

  const decisionTitle = (state: StoryDecisionState): string => {
    switch (state.kind) {
      case 'complete-story':
        return t('story.completeTitle')
      case 'cancel-story':
        return t('story.cancelStoryTitle')
      case 'cancel-run':
        return t('story.cancelRunTitle')
      case 'complete-requirement':
        return t('requirement.completeTitle')
      case 'complete-bug':
        return t('bug.completeTitle')
    }
  }
  const decisionLabel = (state: StoryDecisionState): string => {
    switch (state.kind) {
      case 'complete-story':
        return t('story.complete')
      case 'cancel-story':
        return t('story.cancelStory')
      case 'cancel-run':
        return t('story.cancelRun')
      case 'complete-requirement':
        return t('requirement.complete')
      case 'complete-bug':
        return t('bug.complete')
    }
  }
  const decisionBody = (state: StoryDecisionState): string => {
    const title = decisionSubject(state)
    switch (state.kind) {
      case 'complete-story':
        return t('story.completeBody', { title })
      case 'cancel-story':
        return t('story.cancelStoryBody', { title })
      case 'cancel-run':
        return t('story.cancelRunBody', { title })
      case 'complete-requirement':
        return t('requirement.completeBody', { title })
      case 'complete-bug':
        return t('bug.completeBody', { title })
    }
  }

  // The story detail header never carries a conversation button, whatever the
  // state: discussions hang off the story body card and run sessions stay on
  // their run rows, so only a ready story gets a start action here.
  const storyAction = useCallback(
    (story: StoryNode): Action | null =>
      story.state === 'ready' ? { label: t('row.start'), tone: 'soft', icon: ICONS.soft } : null,
    [t],
  )

  const runStoryAction = useCallback(
    (story: StoryNode, requirement?: RequirementNode) => {
      if (story.state === 'ready') {
        startStory(story, requirement)
        return
      }
      openSession(story.sessionId)
    },
    [openSession, startStory],
  )

  /** Tab counts are units of work, not units of type: requirements, stories and defects all count. */
  const counts = useMemo(() => {
    const work = [...board.requirements, ...board.standalone].map((item) => itemState(item))
    const bugs = board.bugs.map((bug) => bug.state)
    const of = (state: NodeState): number =>
      work.filter((entry) => entry === state).length + bugs.filter((entry) => entry === state).length
    return {
      open: work.length + bugs.length - of('done'),
      running: of('running'),
      ready: of('ready'),
      done: of('done'),
    }
  }, [board])

  const items = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const match = (item: ListItem): boolean => {
      const state = itemState(item)
      if (tab === 'open' && state === 'done') return false
      if (tab === 'running' && state !== 'running') return false
      if (tab === 'ready' && state !== 'ready') return false
      if (tab === 'done' && state !== 'done') return false
      if (workspace !== '' && itemWorkspaceId(item) !== workspace) return false
      if (needle === '') return true
      const haystack = [itemTitle(item), item.id, item.kind === 'requirement' ? item.summary : item.story.id]
        .join(' ')
        .toLowerCase()
      return haystack.includes(needle)
    }
    const list = [...board.requirements, ...board.standalone].filter(match)
    return list
  }, [board, query, tab, workspace])

  const bugItems = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return board.bugs.filter((bug) => {
      if (tab === 'open' && bug.state === 'done') return false
      if (tab === 'running' && bug.state !== 'running') return false
      if (tab === 'ready' && bug.state !== 'ready') return false
      if (tab === 'done' && bug.state !== 'done') return false
      if (workspace !== '' && bug.workspaceId !== workspace) return false
      if (needle === '') return true
      const place = workspaceOf(bug.workspaceId).title
      return `${bug.title} ${bug.id} ${place} ${bugStatusLabel(t, bug.status)}`
        .toLowerCase()
        .includes(needle)
    })
  }, [board, query, tab, workspace, workspaceOf, t])

  const groups = useMemo(() => {
    const buckets = new Map<ListLane, ListItem[]>()
    for (const item of items) {
      const lane = itemLane(item)
      const bucket = buckets.get(lane)
      if (bucket === undefined) buckets.set(lane, [item])
      else bucket.push(item)
    }
    // Fixed lane order: executing work, then approved work waiting to start,
    // then requirements still in discussion. Defects render above all three.
    return LANE_ORDER.flatMap((lane) => {
      const bucket = buckets.get(lane)
      return bucket === undefined ? [] : [{ lane, items: bucket }]
    })
  }, [items])

  /** Groups in final display order: defects first, then the work lanes. */
  const lanes = useMemo((): readonly ListGroup[] => {
    if (bugItems.length === 0) return groups
    return [{ lane: 'bugs', items: bugItems }, ...groups]
  }, [bugItems, groups])

  /** Every record the list can select, with the workspace that owns it. */
  const targetIndex = useMemo(() => {
    const map = new Map<string, { target: DeleteTarget; workspaceId: string }>()
    for (const requirement of board.requirements) {
      map.set(rowKey({ kind: 'requirement', id: requirement.id }), {
        target: { kind: 'requirement', id: requirement.id },
        workspaceId: requirement.workspaceId,
      })
    }
    for (const item of board.standalone) {
      map.set(rowKey({ kind: 'story', id: item.story.id }), {
        target: { kind: 'story', id: item.story.id },
        workspaceId: item.story.workspaceId,
      })
    }
    for (const bug of board.bugs) {
      map.set(rowKey({ kind: 'bug', id: bug.id }), {
        target: { kind: 'bug', id: bug.id },
        workspaceId: bug.workspaceId,
      })
    }
    return map
  }, [board])

  /** Records currently passing the tab/search/workspace filters. */
  const visibleTargets = useMemo(() => {
    const rows: { target: DeleteTarget; workspaceId: string }[] = []
    for (const item of items) {
      rows.push({
        target:
          item.kind === 'requirement'
            ? { kind: 'requirement', id: item.id }
            : { kind: 'story', id: item.story.id },
        workspaceId: itemWorkspaceId(item),
      })
    }
    for (const bug of bugItems) rows.push({ target: { kind: 'bug', id: bug.id }, workspaceId: bug.workspaceId })
    return rows
  }, [items, bugItems])

  const selectedTargets = useMemo(
    () =>
      [...selected]
        .map((key) => targetIndex.get(key)?.target)
        .filter((target): target is DeleteTarget => target !== undefined),
    [selected, targetIndex],
  )

  const openDelete = useCallback(
    (targets: readonly DeleteTarget[]) => {
      if (targets.length === 0) return
      setConfirm({ targets, preview: null, loading: true, error: null })
      data
        .previewDelete(targets)
        .then((preview) => {
          if (!mounted.current) return
          setConfirm((current) =>
            current === null || current.targets !== targets
              ? current
              : { ...current, preview, loading: false, error: null },
          )
        })
        .catch((failure: unknown) => {
          if (!mounted.current) return
          setConfirm((current) =>
            current === null
              ? null
              : { ...current, loading: false, error: failureMessage(failure) },
          )
        })
    },
    [data],
  )

  const toggleSelected = useCallback(
    (target: DeleteTarget, workspaceId: string) => {
      setSelected((current) => {
        const next = new Set(current)
        const key = rowKey(target)
        if (next.has(key)) {
          next.delete(key)
          return next
        }
        const anchorKey = current.values().next().value
        const anchor = anchorKey === undefined ? undefined : targetIndex.get(anchorKey)
        if (anchor !== undefined && anchor.workspaceId !== workspaceId) {
          showToast(t('delete.singleWorkspace'))
          return current
        }
        next.add(key)
        return next
      })
    },
    [showToast, t, targetIndex],
  )

  const selectAllVisible = useCallback(() => {
    const first = visibleTargets[0]
    if (first === undefined) return
    setSelected(new Set(visibleTargets.filter((row) => row.workspaceId === first.workspaceId).map((row) => rowKey(row.target))))
    if (visibleTargets.some((row) => row.workspaceId !== first.workspaceId)) {
      showToast(t('delete.singleWorkspace'))
    }
  }, [showToast, t, visibleTargets])

  const runDelete = useCallback(() => {
    if (confirm === null || deleting) return
    // Only records the preview marked deletable are attempted; skipped rows are
    // already explained in the dialog and are not turned into fake failures.
    const deletable = (confirm.preview?.items ?? [])
      .filter((item) => item.deletable)
      .map((item): DeleteTarget => ({ kind: item.kind, id: item.id }))
    if (deletable.length === 0) return
    setSkippedByPreview(confirm.targets.length - deletable.length)
    setDeleting(true)
    data
      .deleteRecords(deletable)
      .then((result) => {
        if (!mounted.current) return
        setConfirm(null)
        setReport(result)
        setSelected(new Set())
        // A deleted record may be the surface currently on screen (design,
        // story or bug detail); return to the list before refreshing so the
        // panel never renders a view of a row that no longer exists.
        setView({ kind: 'list' })
        void refresh()
      })
      .catch((failure: unknown) => {
        if (!mounted.current) return
        setConfirm((current) =>
          current === null ? null : { ...current, error: failureMessage(failure) },
        )
      })
      .finally(() => {
        if (mounted.current) setDeleting(false)
      })
  }, [confirm, data, deleting, refresh])

  const styleTag = useMemo(() => <style>{STYLES}</style>, [])

  const requirementIdOfView =
    view.kind === 'requirement'
      ? view.id
      : view.kind === 'doc' || view.kind === 'story'
        ? view.requirementId
        : null
  // A deep link names only the story, so its parent is resolved from the story
  // itself: without it the surface would label a child story as standalone.
  const activeRequirement =
    requirementIdOfView !== null
      ? board.requirements.find((requirement) => requirement.id === requirementIdOfView)
      : view.kind === 'story'
        ? board.requirements.find((requirement) =>
            requirement.stories.some((story) => story.id === view.id),
          )
        : undefined
  const activeDoc =
    view.kind === 'doc' && activeRequirement !== undefined
      ? activeRequirement.docs.find((doc) => doc.path === view.path)
      : undefined
  const activeBug = view.kind === 'bug' ? board.bugs.find((bug) => bug.id === view.id) : undefined
  // A deep link carries no requirement id, so a story is also looked up under
  // its parent; a standalone story has no parent and stays in the standalone map.
  const activeStory =
    view.kind === 'story'
      ? (view.requirementId === null
          ? (standaloneById.get(view.id)?.story ??
            board.requirements.flatMap((requirement) => requirement.stories).find((story) => story.id === view.id))
          : activeRequirement?.stories.find((story) => story.id === view.id))
      : undefined
  const activeDocBody =
    view.kind === 'doc' && activeRequirement !== undefined
      ? view.path === activeRequirement.path
        ? activeRequirement.content.join('\n')
        : activeDoc === undefined
          ? null
          : (docBodies[activeDoc.id] ?? null)
      : null

  /**
   * One step up the hierarchy. Each surface used to carry its own back
   * callback; this is now the only definition, shared by the bar and the
   * Alt/Cmd+← shortcut so the two can never drift apart.
   */
  const goBack = useCallback(() => {
    if (createBusy) return
    setView((current) => {
      switch (current.kind) {
        case 'list':
          return current
        case 'create':
        case 'requirement':
        case 'bug':
          return { kind: 'list' }
        case 'doc':
          return { kind: 'requirement', id: current.requirementId }
        case 'story':
          return current.requirementId === null
            ? { kind: 'list' }
            : { kind: 'requirement', id: current.requirementId }
      }
    })
  }, [createBusy])

  // A view starts at its top. Carrying the previous offset over made a freshly
  // opened document look like it began halfway down.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 })
  }, [view])

  // Move focus to Back when the view changes: keyboard users land on the way
  // out instead of at the top of an unfamiliar page.
  useEffect(() => {
    if (view.kind === 'list') return
    backRef.current?.focus({ preventScroll: true })
  }, [view])

  // Alt+← and Cmd+← are the muscle memory the browser built for "go back".
  // Honour them inside the panel instead of letting the whole page leave.
  useEffect(() => {
    if (view.kind === 'list') return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'ArrowLeft' || !(event.altKey || event.metaKey)) return
      if (event.defaultPrevented || deleted !== null || confirm !== null || report !== null) return
      const target = event.target
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || TEXT_ENTRY_TAGS.has(target.tagName))
      ) {
        return
      }
      event.preventDefault()
      goBack()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [view.kind, deleted, confirm, report, goBack])

  // The trail is derived from the same state the surfaces render from, so the
  // bar cannot disagree with the page below it.
  const rootCrumb: NavCrumb = {
    label: t('page.title'),
    home: true,
    onClick: () => setView({ kind: 'list' }),
  }
  let navCrumbs: readonly NavCrumb[] = [rootCrumb]
  let navKind: string | undefined
  if (view.kind === 'create') {
    navCrumbs = [rootCrumb, { label: t('create.title') }]
  } else if (view.kind === 'requirement' && activeRequirement !== undefined) {
    navCrumbs = [rootCrumb, { label: activeRequirement.title }]
    navKind = t('kind.requirement')
  } else if (view.kind === 'doc' && activeRequirement !== undefined) {
    navCrumbs = [
      rootCrumb,
      {
        label: activeRequirement.title,
        onClick: () => setView({ kind: 'requirement', id: activeRequirement.id }),
      },
      { label: activeDoc?.title ?? t('detail.design') },
    ]
    navKind =
      activeDoc === undefined ? t('kind.requirement') : t(DOC_KINDS[activeDoc.kind] ?? 'detail.docs')
  } else if (view.kind === 'story' && activeStory !== undefined) {
    navCrumbs = [
      rootCrumb,
      ...(activeRequirement === undefined
        ? []
        : [
            {
              label: activeRequirement.title,
              onClick: () => setView({ kind: 'requirement', id: activeRequirement.id }),
            },
          ]),
      { label: activeStory.title },
    ]
    navKind = t('kind.story')
  } else if (view.kind === 'bug' && activeBug !== undefined) {
    navCrumbs = [rootCrumb, { label: activeBug.title }]
    navKind = t('kind.bug')
  }

  return (
    <div className="tf-root">
      {styleTag}
      {view.kind === 'list' ? null : (
        <NavBar
          t={t}
          crumbs={navCrumbs}
          currentKind={navKind}
          onBack={goBack}
          backDisabled={createBusy}
          backRef={backRef}
        />
      )}
      <div className="tf-scroll" ref={scrollRef}>
        <div className="tf-inner">
          {view.kind === 'list' ? (
            <>
              <header className="tf-head">
                <div className="tf-head-main">
                  <h1 className="tf-title">{t('page.title')}</h1>
                  <p className="tf-sub">{t('page.subtitle')}</p>
                </div>
                <div className="tf-head-actions">
                  <button
                    className="tf-btn"
                    data-tone="primary"
                    type="button"
                    onClick={() => {
                      setCreateError(null)
                      setView({ kind: 'create' })
                    }}
                  >
                    <PlusGlyph />
                    {t('create.open')}
                  </button>
                  <button
                    className="tf-btn"
                    data-tone="ghost"
                    type="button"
                    disabled={loading}
                    onClick={() => void refresh()}
                  >
                    <RefreshGlyph />
                    {t('page.refresh')}
                  </button>
                </div>
              </header>

              {error !== null ? (
                <div className="tf-error" role="alert">
                  <span className="tf-error-text">{t('page.loadFailed', { message: error })}</span>
                  <button className="tf-btn" data-tone="ghost" type="button" onClick={() => void refresh()}>
                    {t('page.retry')}
                  </button>
                </div>
              ) : null}

              <div className="tf-toolbar">
                <div className="tf-seg" role="tablist" aria-label={t('page.title')}>
                  {(
                    [
                      ['open', counts.open],
                      ['running', counts.running],
                      ['ready', counts.ready],
                      ['done', counts.done],
                    ] as const
                  ).map(([key, count]) => (
                    <button
                      key={key}
                      type="button"
                      role="tab"
                      aria-selected={tab === key}
                      onClick={() => setTab(key)}
                    >
                      {t(`tab.${key}`)}
                      <span className="tf-count">{count}</span>
                    </button>
                  ))}
                </div>
                <span className="tf-grow" />
                <input
                  className="tf-search"
                  type="search"
                  value={query}
                  aria-label={t('search.placeholder')}
                  placeholder={t('search.placeholder')}
                  onChange={(event) => setQuery(event.target.value)}
                />
                <select
                  className="tf-select"
                  value={workspace}
                  aria-label={t('workspace.filter')}
                  onChange={(event) => setWorkspace(event.target.value)}
                >
                  <option value="">{t('workspace.all')}</option>
                  {workspaceOptions.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.title}
                    </option>
                  ))}
                </select>
                <button
                  className="tf-btn"
                  data-tone={cleanup ? 'soft' : 'ghost'}
                  type="button"
                  aria-pressed={cleanup}
                  onClick={() => {
                    setCleanup((value) => !value)
                    setSelected(new Set())
                  }}
                >
                  <TrashGlyph />
                  {cleanup ? t('delete.exit') : t('delete.enter')}
                </button>
              </div>

              {cleanup ? (
                <div className="tf-cleanup">
                  <span className="tf-cleanup-count">{t('delete.selectedCount', { count: selectedTargets.length })}</span>
                  <span className="tf-card-hint">{t('delete.batchHint')}</span>
                  <span className="tf-grow" />
                  <button className="tf-btn" data-tone="ghost" type="button" onClick={selectAllVisible}>
                    {t('delete.selectAll')}
                  </button>
                  <button
                    className="tf-btn"
                    data-tone="primary"
                    type="button"
                    disabled={selectedTargets.length === 0}
                    onClick={() => openDelete(selectedTargets)}
                  >
                    <TrashGlyph />
                    {t('delete.actionBatch', { count: selectedTargets.length })}
                  </button>
                </div>
              ) : null}

              {items.length === 0 && bugItems.length === 0 ? (
                <div className="tf-empty">
                  <div className="tf-empty-title">{t('empty.title')}</div>
                  <div className="tf-empty-body">{t('empty.body')}</div>
                  <button
                    className="tf-btn"
                    data-tone="ghost"
                    type="button"
                    onClick={() => {
                      setQuery('')
                      setWorkspace('')
                      setTab('open')
                    }}
                  >
                    {t('empty.clear')}
                  </button>
                </div>
              ) : (
                <div>
                  {lanes.map((group) => (
                    <section key={group.lane} className="tf-group" data-lane={group.lane}>
                      <div className="tf-group-label">
                        <span>{t(group.lane === 'bugs' ? 'group.bugs' : GROUP_LABELS[group.lane])}</span>
                        <span>·</span>
                        <span>{group.items.length}</span>
                      </div>
                      <div className="tf-list">
                        {group.lane === 'bugs' ? (
                          group.items.map((bug) => (
                            <BugRow
                              key={bug.id}
                              bug={bug}
                              t={t}
                              workspace={workspaceOf(bug.workspaceId).title}
                              selectable={cleanup}
                              selected={selected.has(rowKey({ kind: 'bug', id: bug.id }))}
                              onOpen={() => setView({ kind: 'bug', id: bug.id })}
                              onSelect={() => toggleSelected({ kind: 'bug', id: bug.id }, bug.workspaceId)}
                              onDelete={() => openDelete([{ kind: 'bug', id: bug.id }])}
                            />
                          ))
                        ) : (
                          group.items.map((item) => (
                            <ListRow
                              key={item.id}
                              item={item}
                              t={t}
                              workspace={workspaceOf(itemWorkspaceId(item)).title}
                              onOpen={() =>
                                setView(
                                  item.kind === 'requirement'
                                    ? { kind: 'requirement', id: item.id }
                                    : { kind: 'story', id: item.story.id, requirementId: null },
                                )
                              }
                              selectable={cleanup}
                              selected={
                                selected.has(
                                  rowKey(
                                    item.kind === 'requirement'
                                      ? { kind: 'requirement', id: item.id }
                                      : { kind: 'story', id: item.story.id },
                                  ),
                                )
                              }
                              onSelect={() =>
                                toggleSelected(
                                  item.kind === 'requirement'
                                    ? { kind: 'requirement', id: item.id }
                                    : { kind: 'story', id: item.story.id },
                                  itemWorkspaceId(item),
                                )
                              }
                              onDelete={() =>
                                openDelete([
                                  item.kind === 'requirement'
                                    ? { kind: 'requirement', id: item.id }
                                    : { kind: 'story', id: item.story.id },
                                ])
                              }
                            />
                          ))
                        )}
                      </div>
                    </section>
                  ))}
                </div>
              )}
            </>
          ) : null}

          {view.kind === 'create' ? (
            <CreateSurface
              t={t}
              workspaces={liveWorkspaces}
              workspacesReady={workspacesReady}
              busy={createBusy}
              error={createError}
              attachmentPolicy={attachmentPolicy}
              attachmentAvailable={attachmentAvailable}
              uploads={createUploads}
              onSubmit={submitCreate}
              onCancel={cancelCreate}
            />
          ) : null}

          {view.kind === 'requirement' && activeRequirement !== undefined ? (
            <RequirementSurface
              requirement={activeRequirement}
              t={t}
              sessionTitle={sessionTitle}
              workspace={workspaceOf(activeRequirement.workspaceId).title}
              action={requirementAction(activeRequirement)}
              onAct={() => runRequirementAction(activeRequirement)}
              onDelete={() => openDelete([{ kind: 'requirement', id: activeRequirement.id }])}
              onComplete={() =>
                setDecision({ kind: 'complete-requirement', requirement: activeRequirement, busy: false, error: null })
              }
              onOpenPath={openFile}
              onStoryAct={(story) => runStoryAction(story, activeRequirement)}
              onStartStory={(story, tier) => startStory(story, activeRequirement, tier)}
              onStoryDetail={(story) =>
                setView({ kind: 'story', id: story.id, requirementId: activeRequirement.id })
              }
              onOpenSession={(sessionId) => openSession(sessionId)}
              onNewDiscussion={(kind) => startRequirementDiscussion(activeRequirement, kind)}
              discussionBusy={discussionBusy}
              useSessionStatus={useSessionStatus}
            />
          ) : null}

          {view.kind === 'doc' &&
          activeRequirement !== undefined &&
          (activeDoc !== undefined || view.path === activeRequirement.path) ? (
            <DocSurface
              t={t}
              requirement={activeRequirement}
              path={view.path}
              doc={activeDoc}
              body={activeDocBody}
              onOpenPath={openFile}
              onMissing={(path) => showToast(t('doc.linkMissing', { path }))}
            />
          ) : null}

          {view.kind === 'bug' && activeBug !== undefined ? (
            <BugSurface
              t={t}
              bug={activeBug}
              workspace={workspaceOf(activeBug.workspaceId).title}
              sessionTitle={sessionTitle}
              onOpenSession={(sessionId) => openSession(sessionId)}
              onDelete={() => openDelete([{ kind: 'bug', id: activeBug.id }])}
              onComplete={() =>
                setDecision({ kind: 'complete-bug', bug: activeBug, busy: false, error: null })
              }
              onStartFix={(tier) => startBugFix(activeBug, tier)}
              onCancelFix={() => cancelBugFix(activeBug)}
              onNewDiscussion={() =>
                startRecordDiscussion({
                  kind: 'bug',
                  id: activeBug.id,
                  title: activeBug.title,
                  workspaceId: activeBug.workspaceId,
                })
              }
              discussionBusy={recordDiscussionBusy === 'bug'}
            />
          ) : null}

          {view.kind === 'story' && activeStory !== undefined ? (
            <StorySurface
              t={t}
              story={activeStory}
              requirement={activeRequirement}
              workspace={workspaceOf(activeStory.workspaceId).title}
              sessionTitle={sessionTitle}
              action={storyAction(activeStory)}
              onAct={() => runStoryAction(activeStory, activeRequirement)}
              onStartRun={(tier) => startStory(activeStory, activeRequirement, tier)}
              onDelete={() => openDelete([{ kind: 'story', id: activeStory.id }])}
              onComplete={() =>
                setDecision({ kind: 'complete-story', story: activeStory, busy: false, error: null })
              }
              onCancelStory={() =>
                setDecision({ kind: 'cancel-story', story: activeStory, busy: false, error: null })
              }
              onCancelRun={() =>
                setDecision({ kind: 'cancel-run', story: activeStory, busy: false, error: null })
              }
              onOpenSession={(sessionId) => openSession(sessionId)}
              onOpenPath={openFile}
              onMissing={(path) => showToast(t('doc.linkMissing', { path }))}
              onNewDiscussion={() =>
                startRecordDiscussion({
                  kind: 'story',
                  id: activeStory.id,
                  title: activeStory.title,
                  workspaceId: activeStory.workspaceId,
                })
              }
              discussionBusy={recordDiscussionBusy === 'story'}
            />
          ) : null}
        </div>
      </div>

      {toast !== null ? (
        <div className="tf-toast" role="status" key={toast.seq}>
          <InfoGlyph />
          <span>{toast.text}</span>
        </div>
      ) : null}

      {deleted !== null ? (
        <div className="tf-modal-mask" role="dialog" aria-modal="true" aria-label={t('modal.title')}>
          <div className="tf-modal">
            <div className="tf-modal-icon">
              <AlertGlyph />
            </div>
            <h2>{t('modal.title')}</h2>
            <p>{t('modal.body')}</p>
            <div className="tf-kv" style={{ marginBottom: 14 }}>
              <dt>{t('modal.session')}</dt>
              <dd>
                <span className="tf-session-title" title={deleted === '' ? undefined : sessionTitle(deleted)}>
                  {deleted === '' ? '—' : sessionTitle(deleted)}
                </span>
              </dd>
            </div>
            <div className="tf-modal-foot">
              <button className="tf-btn" data-tone="ghost" type="button" onClick={() => setDeleted(null)}>
                {t('modal.stay')}
              </button>
              <button
                className="tf-btn"
                data-tone="soft"
                type="button"
                onClick={() => {
                  setDeleted(null)
                  showToast(t('toast.runsHint'))
                }}
              >
                {t('modal.runs')}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {decision !== null ? (
        <div
          className="tf-modal-mask"
          role="dialog"
          aria-modal="true"
          aria-label={decisionTitle(decision)}
        >
          <div className="tf-modal">
            <div className="tf-modal-icon">
              <AlertGlyph />
            </div>
            <h2>{decisionTitle(decision)}</h2>
            <p className={decision.kind.startsWith('cancel') ? 'tf-danger-text' : undefined}>
              {decisionBody(decision)}
            </p>
            {decision.error !== null ? (
              <div className="tf-error" role="alert">
                {decision.error}
              </div>
            ) : null}
            <div className="tf-modal-foot">
              <button
                className="tf-btn"
                data-tone="ghost"
                type="button"
                disabled={decision.busy}
                onClick={() => setDecision(null)}
              >
                {t('story.dismiss')}
              </button>
              <button
                className={decision.kind.startsWith('cancel') ? 'tf-btn tf-danger' : 'tf-btn'}
                data-tone={decision.kind.startsWith('cancel') ? 'ghost' : 'soft'}
                type="button"
                disabled={decision.busy}
                onClick={() => void decideStory()}
              >
                {decision.busy ? t('story.working') : decisionLabel(decision)}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {confirm !== null ? (
        <div className="tf-modal-mask" role="dialog" aria-modal="true" aria-label={t('delete.confirmTitle')}>
          <div className="tf-modal tf-modal-wide">
            <div className="tf-modal-icon">
              <AlertGlyph />
            </div>
            <h2>{t('delete.confirmTitle')}</h2>
            <p className="tf-danger-text">{t('delete.irreversible')}</p>
            {confirm.loading ? <p>{t('delete.previewing')}</p> : null}
            {confirm.error !== null ? (
              <div className="tf-error" role="alert">
                {confirm.error}
              </div>
            ) : null}
            {confirm.preview !== null ? <DeletePreviewBody preview={confirm.preview} t={t} /> : null}
            <div className="tf-modal-foot">
              <button
                className="tf-btn"
                data-tone="ghost"
                type="button"
                disabled={deleting}
                onClick={() => setConfirm(null)}
              >
                {t('delete.cancel')}
              </button>
              <button
                className="tf-btn tf-danger-fill"
                data-tone="primary"
                type="button"
                disabled={
                  deleting ||
                  confirm.loading ||
                  confirm.preview === null ||
                  confirm.preview.deletableCount === 0
                }
                onClick={runDelete}
              >
                <TrashGlyph />
                {deleting ? t('delete.deleting') : t('delete.confirm')}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {report !== null ? (
        <div className="tf-modal-mask" role="dialog" aria-modal="true" aria-label={t('delete.reportTitle')}>
          <div className="tf-modal tf-modal-wide">
            <h2>{t('delete.reportTitle')}</h2>
            <p>{t('delete.reportSummary', { succeeded: report.succeeded, failed: report.failed })}</p>
            {skippedByPreview > 0 ? (
              <p className="tf-danger-text">{t('delete.reportSkipped', { count: skippedByPreview })}</p>
            ) : null}
            <ul className="tf-delete-list">
              {report.results.map((result) => (
                <li key={rowKey(result)} data-state={result.ok ? 'ok' : 'blocked'}>
                  <span className="tf-delete-line">
                    <span className="tf-kind">{kindLabel(t, result.kind)}</span>
                    <span>{result.title}</span>
                    <span className="tf-delete-state">{result.ok ? t('delete.ok') : t('delete.failed')}</span>
                  </span>
                  <span className="tf-delete-reason">
                    {result.ok
                      ? t('delete.removed', { docs: result.removedDocs, runs: result.removedRuns })
                      : (result.error?.message ?? '')}
                  </span>
                </li>
              ))}
            </ul>
            <div className="tf-modal-foot">
              <button
                className="tf-btn"
                data-tone="soft"
                type="button"
                onClick={() => {
                  setReport(null)
                  setSkippedByPreview(0)
                }}
              >
                {t('delete.close')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

/** Localized status of a preview row, including the "record is gone" case. */
function deleteStatusText(t: TranslateFn, item: DeletePreviewItem): string {
  if (!item.found) return t('delete.statusMissing')
  if (item.kind === 'story') return t(`story.status.${item.status}`)
  if (item.kind === 'requirement') return t(`requirement.status.${item.status}`)
  return bugStatusLabel(t, item.status as BugStatus)
}

/** One refusal reason, rebuilt from structured fields so it is localized. */
function deleteReasonText(t: TranslateFn, item: DeletePreviewItem): string {
  switch (item.reasonCode) {
    case 'not_found':
      return t('delete.reason.notFound', { title: item.title || t('delete.missing') })
    case 'invalid_transition':
      return t('delete.reason.status', {
        title: item.title || t('delete.missing'),
        status: deleteStatusText(t, item),
      })
    case 'has_active_run':
      return t('delete.reason.activeRun', {
        title: item.title || t('delete.missing'),
        status: deleteStatusText(t, item),
      })
    case 'has_children':
      return t('delete.reason.hasChildren', {
        title: item.title || t('delete.missing'),
        count: item.stories.length,
      })
    default:
      return item.reason ?? ''
  }
}

/** Impact of a pending deletion: records, skipped rows, and cascaded designs. */
function DeletePreviewBody({
  preview,
  t,
}: {
  readonly preview: DeletePreview
  readonly t: TranslateFn
}): ReactElement {
  const cascadedDocs = preview.items.flatMap((item) =>
    item.deletable ? item.docs.map((doc) => ({ designId: item.id, doc })) : [],
  )
  return (
    <>
      <div className="tf-delete-summary">
        <span>{t('delete.summary', { total: preview.items.length, deletable: preview.deletableCount })}</span>
        <span>
          {t('delete.byKind', {
            bugs: preview.counts.bug,
            stories: preview.counts.story,
            requirements: preview.counts.requirement,
          })}
        </span>
        <span>{t('delete.docTotal', { count: preview.docCount })}</span>
        <span>{t('delete.runTotal', { count: preview.runCount })}</span>
        {preview.skippedCount > 0 ? (
          <span className="tf-danger-text">{t('delete.skipped', { count: preview.skippedCount })}</span>
        ) : null}
      </div>
      <ul className="tf-delete-list">
        {preview.items.map((item) => (
          <li key={rowKey(item)} data-state={item.deletable ? 'ok' : 'blocked'}>
            <span className="tf-delete-line">
              <span className="tf-kind">{kindLabel(t, item.kind)}</span>
              <span>{item.found ? item.title : t('delete.missing')}</span>
              <span className="tf-delete-state">{deleteStatusText(t, item)}</span>
            </span>
            {item.deletable ? null : (
              <span className="tf-delete-reason">{deleteReasonText(t, item)}</span>
            )}
            {item.stories.length > 0 ? (
              <span className="tf-delete-reason">
                {t('delete.children', {
                  count: item.stories.length,
                  titles: item.stories.map((story) => story.title).join(', '),
                })}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      {cascadedDocs.length > 0 ? (
        <div className="tf-delete-docs">
          <span className="tf-card-hint">{t('delete.docs', { count: cascadedDocs.length })}</span>
          <ul className="tf-delete-list">
            {cascadedDocs.map(({ designId, doc }) => (
              <li key={`${designId}:${doc.id}`} data-state="cascade">
                <span className="tf-delete-line">
                  <span className="tf-kind">{t(`doc.kind.${doc.kind}`)}</span>
                  <span>{doc.title}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  )
}

/** The state a list row reports: running wins over the requirement's own state. */
function itemState(item: ListItem): NodeState {
  if (item.kind === 'story') return item.story.state
  if (item.state === 'running') return 'running'
  const hasRunning = item.stories.some((story) => story.state === 'running')
  return hasRunning ? 'running' : item.state
}

/** Locale key of each lane's group heading. */
const GROUP_LABELS: Record<ListLane, string> = {
  running: 'group.running',
  ready: 'group.waiting',
  discussing: 'group.discussing',
  done: 'group.done',
}

/** One rendered group: defects first, then one lane of requirement/story rows. */
type ListGroup =
  | { readonly lane: 'bugs'; readonly items: readonly BugNode[] }
  | { readonly lane: ListLane; readonly items: readonly ListItem[] }

/**
 * Lane a row renders in. A running story lifts its requirement into the
 * executing lane; otherwise an item only splits off into the discussion lane
 * when it is a requirement that has not been completed yet.
 */
function itemLane(item: ListItem): ListLane {
  const state = itemState(item)
  if (state !== 'ready') return state
  return item.kind === 'requirement' ? requirementLane(item.status) : 'ready'
}

/** Row title. */
function itemTitle(item: ListItem): string {
  return item.kind === 'requirement' ? item.title : item.story.title
}

/** Workspace id a row belongs to. */
function itemWorkspaceId(item: ListItem): string {
  return item.kind === 'requirement' ? item.workspaceId : item.story.workspaceId
}

/** Stable identity of one selectable target, used by the checkbox set. */
function rowKey(target: DeleteTarget): string {
  return `${target.kind}:${target.id}`
}

/** Localized record-type label. */
function kindLabel(t: TranslateFn, kind: DeletableKind): string {
  return t(kind === 'requirement' ? 'kind.requirement' : kind === 'story' ? 'kind.story' : 'kind.bug')
}

/** One row in the default list; the whole row opens its detail page. */
function ListRow({
  item,
  t,
  onOpen,
  selectable,
  selected,
  onSelect,
  onDelete,
  workspace,
}: {
  readonly item: ListItem
  readonly t: TranslateFn
  readonly onOpen: () => void
  readonly selectable: boolean
  readonly selected: boolean
  readonly onSelect: () => void
  readonly onDelete: () => void
  readonly workspace: string
}): ReactElement {
  const state = itemState(item)
  const updatedAt = item.kind === 'requirement' ? item.updatedAt : item.story.updatedAt
  // Row metadata stays to one line and never shows a nanoid: the stage and the
  // workspace are enough context at this level, and full ids live in 属性.
  const meta: ReactNode[] = []
  if (item.kind === 'requirement') {
    meta.push(<span key="stage">{requirementStatusLabel(t, item.status)}</span>)
  }
  meta.push(<span key="workspace">{workspace}</span>)

  return (
    <div
      className="tf-row"
      role="button"
      tabIndex={0}
      data-active={state === 'running'}
      onClick={() => (selectable ? onSelect() : onOpen())}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          if (selectable) onSelect()
          else onOpen()
        }
      }}
    >
      {selectable ? (
        <input
          className="tf-check"
          type="checkbox"
          checked={selected}
          aria-label={t('delete.select', { id: item.id })}
          onClick={(event) => event.stopPropagation()}
          onChange={onSelect}
        />
      ) : null}
      <StatusPill state={state} t={t} />
      <span className="tf-type" data-kind={item.kind}>
        {t(item.kind === 'requirement' ? 'type.requirement' : 'type.story')}
      </span>
      <span className="tf-row-main">
        <span className="tf-row-title">{itemTitle(item)}</span>
        <span className="tf-row-meta">
          {meta.map((piece, index) => (
            <span key={index}>
              {index > 0 ? <span className="tf-sep">·</span> : null}
              {piece}
            </span>
          ))}
        </span>
      </span>
      <span className="tf-row-side">
        <span className="tf-time">{formatWhen(updatedAt)}</span>
        {selectable ? null : (
          <button
            className="tf-btn tf-danger"
            data-tone="ghost"
            type="button"
            aria-label={t('delete.actionOne', { id: item.id })}
            onClick={(event) => {
              event.stopPropagation()
              onDelete()
            }}
          >
            <TrashGlyph />
          </button>
        )}
        {selectable ? null : (
          <span className="tf-row-chevron" aria-hidden="true">
            <ChevronRight />
          </span>
        )}
      </span>
    </div>
  )
}

/** One defect row; defects sit in their own lane above the work lanes. */
function BugRow({
  bug,
  t,
  workspace,
  selectable,
  selected,
  onOpen,
  onSelect,
  onDelete,
}: {
  readonly bug: BugNode
  readonly t: TranslateFn
  readonly workspace: string
  readonly selectable: boolean
  readonly selected: boolean
  readonly onOpen: () => void
  readonly onSelect: () => void
  readonly onDelete: () => void
}): ReactElement {
  return (
    <div
      className="tf-row tf-row-bug"
      data-state={bug.state}
      role="button"
      tabIndex={0}
      onClick={() => (selectable ? onSelect() : onOpen())}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          if (selectable) onSelect()
          else onOpen()
        }
      }}
    >
      {selectable ? (
        <input
          className="tf-check"
          type="checkbox"
          checked={selected}
          aria-label={t('delete.select', { id: bug.id })}
          onClick={(event) => event.stopPropagation()}
          onChange={onSelect}
        />
      ) : null}
      <span className="tf-state" data-state={bugTone(bug.status)}>
        <i />
        {bugStatusLabel(t, bug.status)}
      </span>
      <span className="tf-type" data-kind="bug">
        {t('type.bug')}
      </span>
      <span className="tf-row-main">
        <span className="tf-row-title">{bug.title}</span>
        <span className="tf-row-meta">
          <span>{bugSeverityLabel(t, bug.severity)}</span>
          <span className="tf-sep">·</span>
          <span>{workspace}</span>
        </span>
      </span>
      <span className="tf-row-side">
        <span className="tf-time">{formatWhen(bug.updatedAt)}</span>
        <button
          className="tf-btn tf-danger"
          data-tone="ghost"
          type="button"
          aria-label={t('delete.actionOne', { id: bug.id })}
          onClick={(event) => {
            event.stopPropagation()
            onDelete()
          }}
        >
          <TrashGlyph />
        </button>
        <ChevronRight />
      </span>
    </div>
  )
}

/** Status chip. */
function StatusPill({
  state,
  t,
  label,
}: {
  readonly state: NodeState
  readonly t: TranslateFn
  readonly label?: string
}): ReactElement {
  return (
    <span className="tf-state" data-state={state}>
      <i />
      {label ?? t(`state.${state}`)}
    </span>
  )
}

/**
 * The sessions attached to one design section.
 *
 * The outline, detailed-design and story cards embed this block, so a
 * discussion is always shown next to the work it is about instead of in a
 * separate sidebar. The newest confirmed session stays open; older ones fold.
 */
function DiscussionSessions({
  t,
  sessions,
  sessionTitle,
  onOpenSession,
  readOnly = false,
}: {
  readonly t: TranslateFn
  readonly sessions: readonly DiscussionSessionNode[]
  /** Human-facing conversation title for a linked session id. */
  readonly sessionTitle: (sessionId: string) => string
  readonly onOpenSession: (sessionId: string | undefined) => void
  /** Keep the history list and its disclosure, drop the "continue" actions. */
  readonly readOnly?: boolean
}): ReactElement {
  const [historyOpen, setHistoryOpen] = useState(false)
  const latest = sessions[0]
  const older = sessions.slice(1)
  return (
    <div className="tf-sessions">
      <div className="tf-sessions-head">
        <span className="tf-sessions-title">{t('detail.sessions')}</span>
        <span className="tf-sessions-count">{sessions.length}</span>
      </div>
      {latest === undefined ? (
        <p className="tf-card-hint" style={{ margin: 0 }}>
          {t('detail.discussionEmpty')}
        </p>
      ) : (
        <>
          <div className="tf-session-list">
            <div className="tf-session-item" data-latest="true">
              <span className="tf-session-main">
                <span className="tf-session-label">{t('detail.discussionLatest')}</span>
                <span className="tf-session-title" title={sessionTitle(latest.sessionId)}>
                  {sessionTitle(latest.sessionId)}
                </span>
                <span className="tf-session-meta">
                  {t('detail.discussionLinkedAt', { when: formatWhen(latest.at) })}
                </span>
              </span>
              {readOnly ? null : (
                <button
                  className="tf-btn"
                  data-tone="ghost"
                  type="button"
                  onClick={() => onOpenSession(latest.sessionId)}
                >
                  <ChatGlyph />
                  {t('detail.discussionContinue')}
                </button>
              )}
            </div>
          </div>
          {older.length === 0 ? null : (
            <>
              <button
                className="tf-session-toggle"
                type="button"
                aria-expanded={historyOpen}
                onClick={() => setHistoryOpen((open) => !open)}
              >
                <HistoryGlyph />
                {historyOpen
                  ? t('detail.discussionHistoryHide')
                  : t('detail.discussionHistory', { count: older.length })}
              </button>
              {historyOpen ? (
                <div className="tf-session-list tf-session-history">
                  {older.map((session) => {
                    const title = sessionTitle(session.sessionId)
                    return (
                      <div className="tf-session-item" key={session.sessionId}>
                        <span className="tf-session-main">
                          <span className="tf-session-title" title={title}>
                            {title}
                          </span>
                          <span className="tf-session-meta">
                            {t('detail.discussionLinkedAt', { when: formatWhen(session.at) })}
                          </span>
                        </span>
                        {readOnly ? null : (
                          <button
                            className="tf-btn"
                            data-tone="ghost"
                            type="button"
                            onClick={() => onOpenSession(session.sessionId)}
                          >
                            {t('detail.discussionOpen')}
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              ) : null}
            </>
          )}
        </>
      )}
    </div>
  )
}

/**
 * One requirement read on its own surface: the requirement body (which is also
 * the outline design), the detailed-design documents under it, the stories it
 * owns and the runs that built them.
 */
export function RequirementSurface({
  requirement,
  t,
  sessionTitle,
  workspace,
  action,
  onAct,
  onDelete,
  onComplete,
  onOpenPath,
  onStoryAct,
  onStartStory,
  onStoryDetail,
  onOpenSession,
  onNewDiscussion,
  discussionBusy,
  useSessionStatus,
  readOnly = false,
}: {
  readonly requirement: RequirementNode
  readonly t: TranslateFn
  /** Human-facing conversation title for a linked session id. */
  readonly sessionTitle: (sessionId: string) => string
  readonly workspace: string
  readonly action: Action | null
  readonly onAct: () => void
  readonly onDelete: () => void
  /** Complete the whole requirement; only offered while it is open. */
  readonly onComplete: () => void
  readonly onOpenPath: (path: string) => void
  readonly onStoryAct: (story: StoryNode) => void
  /**
   * Start a ready story with the tier picked in the run menu. Present only on
   * the writable surface; without it a ready row keeps its plain action button.
   */
  readonly onStartStory?: (story: StoryNode, tier: PermissionTier) => Promise<RunStartOutcome>
  readonly onStoryDetail: (story: StoryNode) => void
  readonly onOpenSession: (sessionId: string | undefined) => void
  readonly onNewDiscussion: (kind: RequirementDiscussionKind) => void
  readonly discussionBusy: RequirementDiscussionKind | null
  /** Host's standard live-session-status hook; absent in tests. */
  readonly useSessionStatus?: UseSessionStatus
  /**
   * Render the same information without any write or submission control.
   *
   * Every action is removed at render time rather than disabled: a read-only
   * surface must not offer a control that only fails when pressed.
   */
  readonly readOnly?: boolean
}): ReactElement {
  const discussions = requirement.sessions.filter((session) => session.kind === 'design')
  const details = requirement.sessions.filter((session) => session.kind === 'detail')
  const splits = requirement.sessions.filter((session) => session.kind === 'split')
  const createSessions = requirement.sessions.filter((session) => session.kind === 'create')

  // A chart node is a shortcut, not a second detail view: scroll the matching
  // card or story row into view and pulse it briefly. No navigation state is
  // kept, so the same handler works on the read-only session tab.
  const revealFlowNode = (node: FlowNode): void => {
    const target = document.getElementById(flowNodeTarget(node))
    if (target === null) return
    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    target.scrollIntoView({
      behavior: reduced ? 'auto' : 'smooth',
      block: node.kind === 'story' || node.kind === 'run' ? 'center' : 'start',
    })
    if (reduced || typeof target.animate !== 'function') return
    target.animate(
      [
        {
          boxShadow:
            '0 0 0 2px color-mix(in srgb, var(--dsw-alias-link, #4176e6) 55%, transparent)',
        },
        { boxShadow: '0 0 0 2px transparent' },
      ],
      { duration: 1400, easing: 'ease-out' },
    )
  }

  return (
    <>
      <div className="tf-detail-head">
        <div style={{ minWidth: 0, flex: '1 1 auto' }}>
          <h2 className="tf-detail-title">{requirement.title}</h2>
          <div className="tf-pills">
            <StatusPill state={itemState(requirement)} t={t} />
            <span className="tf-kind">{t('kind.requirement')}</span>
            <span className="tf-kind">{workspace}</span>
            <span className="tf-time">
              {`${t('detail.updated')} ${formatWhen(requirement.updatedAt)}`}
            </span>
          </div>
        </div>
        {readOnly || requirement.status !== 'draft' ? null : (
          <button className="tf-btn" data-tone="soft" type="button" onClick={onComplete} style={{ flex: '0 0 auto' }}>
            {t('requirement.complete')}
          </button>
        )}
        {readOnly ? null : (
          <button className="tf-btn tf-danger" data-tone="ghost" type="button" onClick={onDelete} style={{ flex: '0 0 auto' }}>
            <TrashGlyph />
            {t('delete.action')}
          </button>
        )}
        {readOnly || action === null ? null : (
          <button className="tf-btn" data-tone={action.tone} type="button" onClick={onAct} style={{ flex: '0 0 auto' }}>
            {action.icon}
            {action.label}
          </button>
        )}
      </div>

      <div className="tf-grid">
        <div>
          <section className="tf-card">
            <SectionHead title={t('flow.title')} hint={t('flow.hint')} />
            <RequirementFlow
              requirement={requirement}
              t={t}
              useSessionStatus={useSessionStatus}
              onActivate={revealFlowNode}
            />
          </section>
          <section className="tf-card" id={FLOW_TARGETS.design}>
            <SectionHead
              title={t('detail.design')}
              hint={t('detail.storyProgress', {
                done: requirement.stories.filter((story) => story.status === 'completed').length,
                total: requirement.stories.length,
                docs: requirement.docs.length,
              })}
              action={
                readOnly ? undefined : (
                  <button
                    className="tf-btn tf-btn-sm"
                    data-tone="soft"
                    type="button"
                    disabled={discussionBusy !== null}
                    onClick={() => onNewDiscussion('design')}
                  >
                    <PlusGlyph />
                    {discussionBusy === 'design'
                      ? t('detail.discussionStarting')
                      : t('detail.discussionNewDesign')}
                  </button>
                )
              }
            />
            {requirement.bodyMissing ? (
              <p className="tf-card-hint" style={{ margin: 0 }}>
                {t('body.missing', { path: requirement.path })}
              </p>
            ) : requirement.content.length === 0 ? (
              <p className="tf-card-hint" style={{ margin: 0 }}>
                {t('detail.designEmpty')}
              </p>
            ) : (
              <div className="tf-doc-body">
                <MarkdownBody
                  text={requirement.content.join('\n')}
                  t={t}
                  basePath={requirement.path}
                  onOpenPath={onOpenPath}
                />
              </div>
            )}
            <DiscussionSessions
              t={t}
              sessions={discussions}
              sessionTitle={sessionTitle}
              onOpenSession={onOpenSession}
              readOnly={readOnly}
            />
          </section>

          <section className="tf-card" id={FLOW_TARGETS.docs}>
            <SectionHead
              title={t('detail.docs')}
              hint={t('detail.docsHint', { count: requirement.docs.length + 1 })}
              action={
                readOnly ? undefined : (
                  <button
                    className="tf-btn tf-btn-sm"
                    data-tone="soft"
                    type="button"
                    disabled={discussionBusy !== null}
                    onClick={() => onNewDiscussion('detail')}
                  >
                    <PlusGlyph />
                    {discussionBusy === 'detail'
                      ? t('detail.discussionStarting')
                      : t('detail.discussionNewDetail')}
                  </button>
                )
              }
            />
            <DesignFileTree requirement={requirement} t={t} activePath={null} onOpen={onOpenPath} />
            <DiscussionSessions
              t={t}
              sessions={details}
              sessionTitle={sessionTitle}
              onOpenSession={onOpenSession}
              readOnly={readOnly}
            />
          </section>

          <section className="tf-card" id={FLOW_TARGETS.stories}>
            <SectionHead
              title={t('detail.stories')}
              hint={t('detail.storiesHint')}
              action={
                readOnly ? undefined : (
                  <button
                    className="tf-btn tf-btn-sm"
                    data-tone="soft"
                    type="button"
                    disabled={discussionBusy !== null}
                    onClick={() => onNewDiscussion('split')}
                  >
                    <PlusGlyph />
                    {discussionBusy === 'split'
                      ? t('detail.discussionStarting')
                      : t('detail.discussionNewSplit')}
                  </button>
                )
              }
            />
            {requirement.stories.length === 0 ? (
              <p className="tf-card-hint" style={{ margin: 0 }}>
                {t('detail.storiesEmpty')}
              </p>
            ) : null}
            {requirement.stories.map((story) => {
              const storyActionHere =
                story.state === 'running'
                  ? { label: t('row.open'), tone: 'live' as const, icon: ICONS.live }
                  : story.state === 'done'
                    ? { label: t('row.history'), tone: 'ghost' as const, icon: ICONS.ghost }
                    : { label: t('row.start'), tone: 'soft' as const, icon: ICONS.soft }
              const linkedDoc =
                story.docId === undefined
                  ? undefined
                  : requirement.docs.find((doc) => doc.id === story.docId)
              return (
                <div
                  key={story.id}
                  id={flowStoryTarget(story.id)}
                  className="tf-story"
                  role="button"
                  tabIndex={0}
                  onClick={() => onStoryDetail(story)}
                  onKeyDown={(event) => {
                    if (event.target !== event.currentTarget) return
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      onStoryDetail(story)
                    }
                  }}
                >
                  <StatusPill state={story.state} t={t} label={t(`story.status.${story.status}`)} />
                  <span className="tf-story-main">
                    <span className="tf-story-title">{story.title}</span>
                    <span className="tf-story-meta">
                      {linkedDoc === undefined
                        ? formatWhen(story.updatedAt)
                        : `${linkedDoc.title} · ${formatWhen(story.updatedAt)}`}
                    </span>
                  </span>
                  {readOnly ? null : story.state === 'ready' && onStartStory !== undefined ? (
                    <RunTierControl
                      t={t}
                      label={t('run.button')}
                      icon={ICONS.soft}
                      tone="soft"
                      onStart={(tier) => onStartStory(story, tier)}
                    />
                  ) : (
                    <button
                      className="tf-btn"
                      data-tone={storyActionHere.tone}
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation()
                        onStoryAct(story)
                      }}
                    >
                      {storyActionHere.icon}
                      {storyActionHere.label}
                    </button>
                  )}
                  <span className="tf-row-chevron" aria-hidden="true">
                    <ChevronRight />
                  </span>
                </div>
              )
            })}
            <DiscussionSessions
              t={t}
              sessions={splits}
              sessionTitle={sessionTitle}
              onOpenSession={onOpenSession}
              readOnly={readOnly}
            />
          </section>

          <section className="tf-card">
            <SectionHead
              title={t('detail.runs')}
              hint={requirement.runs.length === 0 ? t('detail.runsEmpty') : `${requirement.runs.length}`}
            />
            {requirement.runs.map((run) => (
              <div key={run.id} className="tf-run">
                <span className="tf-run-dot" data-state={runState(run.status)} />
                <span className="tf-run-main">
                  <span className="tf-run-title">{run.subjectTitle}</span>
                  <span className="tf-run-meta">
                    {`${run.branch} · ${t(`run.status.${run.status}`)} · ${formatWhen(run.at)}`}
                  </span>
                </span>
                {readOnly ? null : (
                  <button
                    className="tf-btn"
                    data-tone="ghost"
                    type="button"
                    disabled={run.sessionId === undefined}
                    onClick={() => onOpenSession(run.sessionId)}
                  >
                    {t('row.open')}
                  </button>
                )}
              </div>
            ))}
          </section>
        </div>

        <aside>
          <section className="tf-card">
            <SectionHead title={t('detail.props')} />
            <dl className="tf-kv">
              <dt>{t('detail.id')}</dt>
              <dd className="tf-id">{requirement.id}</dd>
              <dt>{t('detail.workspace')}</dt>
              <dd>{workspace}</dd>
              <dt>{t('detail.status')}</dt>
              <dd>{requirementStatusLabel(t, requirement.status)}</dd>
              {requirement.completedAt === null ? null : (
                <>
                  <dt>{t('detail.completedAt')}</dt>
                  <dd>{formatWhen(requirement.completedAt)}</dd>
                </>
              )}
              <dt>{t('detail.updated')}</dt>
              <dd>{formatWhen(requirement.updatedAt)}</dd>
              {requirement.branch !== undefined ? (
                <>
                  <dt>{t('detail.branch')}</dt>
                  <dd className="tf-session-id">{requirement.branch}</dd>
                </>
              ) : null}
              {createSessions.length === 0 ? null : (
                <>
                  <dt>{t('detail.sessionKindCreate')}</dt>
                  <dd>
                    {createSessions.map((session) => {
                      const title = sessionTitle(session.sessionId)
                      return (
                        <span className="tf-kv-session" key={session.sessionId}>
                          {readOnly ? (
                            <span className="tf-session-title" title={title}>
                              {title}
                            </span>
                          ) : (
                            <button type="button" title={title} onClick={() => onOpenSession(session.sessionId)}>
                              {title}
                            </button>
                          )}
                          <span className="tf-session-meta">{formatWhen(session.at)}</span>
                        </span>
                      )
                    })}
                  </dd>
                </>
              )}
            </dl>
          </section>
        </aside>
      </div>
    </>
  )
}

/** The folder tree of one requirement: the outline body plus every detailed-design document. */
function DesignFileTree({
  requirement,
  t,
  activePath,
  onOpen,
}: {
  readonly requirement: RequirementNode
  readonly t: TranslateFn
  readonly activePath: string | null
  readonly onOpen: (path: string) => void
}): ReactElement {
  const tree = useMemo(
    () =>
      buildFileTree(requirement.path, [
        requirement.path,
        ...requirement.docs.map((doc) => doc.path),
      ]),
    [requirement],
  )
  const docsByPath = useMemo(() => {
    const map = new Map<string, DetailDoc>()
    for (const doc of requirement.docs) {
      const path = normalizePath(doc.path)
      if (path !== null) map.set(path, doc)
    }
    return map
  }, [requirement.docs])
  const outlinePath = normalizePath(requirement.path)
  const active = activePath === null ? null : normalizePath(activePath)

  const renderNode = (node: FileTreeNode, depth: number): ReactElement => {
    if (!node.isFile) {
      return (
        <div key={node.path}>
          <div className="tf-tree-dir" style={{ paddingLeft: 8 + depth * 14 }}>
            <FolderGlyph />
            <span>{node.name}</span>
          </div>
          {node.children.map((child) => renderNode(child, depth + 1))}
        </div>
      )
    }
    const doc = docsByPath.get(node.path)
    const label =
      node.path === outlinePath ? t('detail.design') : (doc?.title ?? node.name)
    const note = doc === undefined ? '' : t(DOC_KINDS[doc.kind] ?? 'detail.docs')
    return (
      <button
        key={node.path}
        className="tf-tree-file"
        data-active={active === node.path}
        type="button"
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => onOpen(node.path)}
      >
        <FileGlyph />
        <span className="tf-tree-name">{label}</span>
        {note === '' ? null : <span className="tf-tree-note">{note}</span>}
      </button>
    )
  }

  if (tree.length === 0) {
    return (
      <p className="tf-card-hint" style={{ margin: 0 }}>
        {t('detail.docsEmpty')}
      </p>
    )
  }
  return <div className="tf-tree">{tree.map((node) => renderNode(node, 0))}</div>
}

/** One markdown file of a requirement, read on its own. */
export function DocSurface({
  t,
  requirement,
  path,
  doc,
  body,
  onOpenPath,
  onMissing,
}: {
  readonly t: TranslateFn
  readonly requirement: RequirementNode
  readonly path: string
  readonly doc?: DetailDoc
  readonly body: string | null
  readonly onOpenPath: (path: string) => void
  readonly onMissing: (path: string) => void
}): ReactElement {
  const title = doc?.title ?? t('detail.design')
  return (
    <>
      <div className="tf-detail-head" style={{ paddingBottom: 10 }}>
        <div style={{ minWidth: 0, flex: '1 1 auto' }}>
          <h2 className="tf-detail-title">{title}</h2>
          <div className="tf-pills">
            <span className="tf-doc-kind">
              {doc === undefined ? t('kind.requirement') : t(DOC_KINDS[doc.kind] ?? 'detail.docs')}
            </span>
            <span className="tf-time">
              {`${t('detail.updated')} ${formatWhen(doc?.updatedAt ?? requirement.updatedAt)}`}
            </span>
            {doc === undefined ? null : (
              <span className="tf-time">{t('doc.covered', { count: doc.storyIds.length })}</span>
            )}
          </div>
        </div>
      </div>

      <div className="tf-doc-layout">
        <article className="tf-doc-body">
          {body === null ? (
            <p className="tf-card-hint">{t('doc.loading')}</p>
          ) : body.trim() === '' ? (
            <p className="tf-card-hint">{t('doc.empty')}</p>
          ) : (
            <MarkdownBody
              text={body}
              t={t}
              basePath={path}
              onOpenPath={onOpenPath}
              onMissing={onMissing}
            />
          )}
        </article>
        <aside className="tf-doc-aside">
          <section className="tf-card">
            <SectionHead title={t('doc.files')} />
            <DesignFileTree requirement={requirement} t={t} activePath={path} onOpen={onOpenPath} />
          </section>
        </aside>
      </div>
    </>
  )
}

/** One defect read on its own surface: body, properties, and the runs that fixed it. */
export function BugSurface({
  t,
  bug,
  workspace,
  sessionTitle,
  onOpenSession,
  onDelete,
  onComplete,
  onStartFix,
  onCancelFix,
  onNewDiscussion,
  discussionBusy = false,
  readOnly = false,
}: {
  readonly t: TranslateFn
  readonly bug: BugNode
  readonly workspace: string
  /** Host title of a linked conversation, falling back to its id. */
  readonly sessionTitle: (sessionId: string) => string
  readonly onOpenSession: (sessionId: string | undefined) => void
  readonly onDelete: () => void
  /** Confirm the problem is solved; only offered after a fix run finished. */
  readonly onComplete: () => void
  /** Start (or restart) a fix run in a fresh development session, at one tier. */
  readonly onStartFix: (tier: PermissionTier) => Promise<RunStartOutcome>
  /** Release a fix run whose session is gone. */
  readonly onCancelFix: () => void
  /** Start a discussion about this defect in a fresh session. */
  readonly onNewDiscussion?: () => void
  /** True while the discussion session is being created. */
  readonly discussionBusy?: boolean
  /** Render the same information without write or submission controls. */
  readonly readOnly?: boolean
}): ReactElement {
  return (
    <>
      <div className="tf-detail-head">
        <div style={{ minWidth: 0, flex: '1 1 auto' }}>
          <h2 className="tf-detail-title">{bug.title}</h2>
          <div className="tf-pills">
            <span className="tf-kind">{bugStatusLabel(t, bug.status)}</span>
            <span className="tf-kind">{`${t('detail.severity')} ${bugSeverityLabel(t, bug.severity)}`}</span>
            <span className="tf-time">{`${t('detail.updated')} ${formatWhen(bug.updatedAt)}`}</span>
          </div>
        </div>
        {readOnly ? null : bug.status === 'fixing' ? (
          <button className="tf-btn tf-danger" data-tone="ghost" type="button" onClick={onCancelFix} style={{ flex: '0 0 auto' }}>
            {t('bug.cancelFix')}
          </button>
        ) : (
          <RunTierControl
            t={t}
            label={t('run.button')}
            icon={ICONS.soft}
            tone="soft"
            onStart={onStartFix}
          />
        )}
        {readOnly || bug.status !== 'fixed' ? null : (
          <button className="tf-btn" data-tone="soft" type="button" onClick={onComplete} style={{ flex: '0 0 auto' }}>
            {t('bug.complete')}
          </button>
        )}
        {readOnly ? null : (
          <button className="tf-btn tf-danger" data-tone="ghost" type="button" onClick={onDelete} style={{ flex: '0 0 auto' }}>
            <TrashGlyph />
            {t('delete.action')}
          </button>
        )}
      </div>

      <div className="tf-grid">
        <div>
          <section className="tf-card">
            <SectionHead
              title={t('detail.bugBody')}
              action={
                readOnly || onNewDiscussion === undefined ? undefined : (
                  <button
                    className="tf-btn tf-btn-sm"
                    data-tone="soft"
                    type="button"
                    disabled={discussionBusy}
                    onClick={onNewDiscussion}
                  >
                    <PlusGlyph />
                    {discussionBusy ? t('detail.discussionStarting') : t('detail.bugDiscussion')}
                  </button>
                )
              }
            />
            <div className="tf-doc-body">
              {bug.bodyMissing ? (
                <p className="tf-card-hint">{t('body.missingGeneric')}</p>
              ) : (
                <MarkdownBody text={bug.content.join('\n')} t={t} />
              )}
            </div>
            <DiscussionSessions
              t={t}
              sessions={bug.sessions}
              sessionTitle={sessionTitle}
              onOpenSession={onOpenSession}
              readOnly={readOnly}
            />
          </section>
          <section className="tf-card">
            <SectionHead
              title={t('detail.runs')}
              hint={bug.runs.length === 0 ? t('detail.runsEmpty') : `${bug.runs.length}`}
            />
            {bug.runs.map((run) => (
              <div key={run.id} className="tf-run">
                <span className="tf-run-dot" data-state={runState(run.status)} />
                <span className="tf-run-main">
                  <span className="tf-run-title">{run.subjectTitle}</span>
                  <span className="tf-run-meta">
                    {`${run.branch} · ${t(`run.status.${run.status}`)} · ${formatWhen(run.at)}`}
                  </span>
                </span>
                {readOnly ? null : (
                  <button
                    className="tf-btn"
                    data-tone="ghost"
                    type="button"
                    disabled={run.sessionId === undefined}
                    onClick={() => onOpenSession(run.sessionId)}
                  >
                    {t('row.open')}
                  </button>
                )}
              </div>
            ))}
          </section>
        </div>
        <aside>
          <section className="tf-card">
            <SectionHead title={t('detail.props')} />
            <dl className="tf-kv">
              <dt>{t('detail.id')}</dt>
              <dd className="tf-id">{bug.id}</dd>
              <dt>{t('detail.workspace')}</dt>
              <dd>{workspace}</dd>
              <dt>{t('detail.status')}</dt>
              <dd>{bugStatusLabel(t, bug.status)}</dd>
              <dt>{t('detail.severity')}</dt>
              <dd>{bugSeverityLabel(t, bug.severity)}</dd>
              <dt>{t('detail.updated')}</dt>
              <dd>{formatWhen(bug.updatedAt)}</dd>
              {bug.createSessionId === undefined ? null : (
                <>
                  <dt>{t('detail.sessionKindCreate')}</dt>
                  <dd>
                    <span className="tf-kv-session">
                      {readOnly ? (
                        <span className="tf-session-title" title={sessionTitle(bug.createSessionId)}>
                          {sessionTitle(bug.createSessionId)}
                        </span>
                      ) : (
                        <button
                          type="button"
                          title={sessionTitle(bug.createSessionId)}
                          onClick={() => onOpenSession(bug.createSessionId)}
                        >
                          {sessionTitle(bug.createSessionId)}
                        </button>
                      )}
                    </span>
                  </dd>
                </>
              )}
            </dl>
          </section>
        </aside>
      </div>
    </>
  )
}

/** One story: its markdown body, runs and properties. */
export function StorySurface({
  t,
  story,
  requirement,
  workspace,
  sessionTitle,
  action,
  onAct,
  onStartRun,
  onDelete,
  onComplete,
  onCancelStory,
  onCancelRun,
  onOpenSession,
  onOpenPath,
  onMissing,
  onNewDiscussion,
  discussionBusy = false,
  readOnly = false,
}: {
  readonly t: TranslateFn
  readonly story: StoryNode
  readonly requirement?: RequirementNode
  readonly workspace: string
  /** Host title of a linked conversation, falling back to its id. */
  readonly sessionTitle: (sessionId: string) => string
  readonly action: Action | null
  readonly onAct: () => void
  /** Start a ready story with the tier picked in the run menu. */
  readonly onStartRun: (tier: PermissionTier) => Promise<RunStartOutcome>
  readonly onDelete: () => void
  /** Complete a story whose run already finished. */
  readonly onComplete: () => void
  readonly onCancelStory: () => void
  readonly onCancelRun: () => void
  readonly onOpenSession: (sessionId: string | undefined) => void
  /** Follow a link to another workbench file, resolved against story.md. */
  readonly onOpenPath: (path: string) => void
  /** Report a markdown link that points at no known file. */
  readonly onMissing: (path: string) => void
  /** Start a discussion about this story in a fresh session. */
  readonly onNewDiscussion?: () => void
  /** True while the discussion session is being created. */
  readonly discussionBusy?: boolean
  /** Render the same information without write or submission controls. */
  readonly readOnly?: boolean
}): ReactElement {
  return (
    <>
      <div className="tf-detail-head">
        <div style={{ minWidth: 0, flex: '1 1 auto' }}>
          <h2 className="tf-detail-title">{story.title}</h2>
          <div className="tf-pills">
            <StatusPill state={story.state} t={t} label={t(`story.status.${story.status}`)} />
            <span className="tf-kind">{t('kind.story')}</span>
            <span className="tf-kind">{workspace}</span>
            <span className="tf-time">{`${t('detail.updated')} ${formatWhen(story.updatedAt)}`}</span>
          </div>
        </div>
        {readOnly ? null : (
          <>
            {story.status === 'done' ? (
              <button className="tf-btn" data-tone="soft" type="button" onClick={onComplete} style={{ flex: '0 0 auto' }}>
                {t('story.complete')}
              </button>
            ) : null}
            {story.status === 'ready' ? (
              <button
                className="tf-btn tf-danger"
                data-tone="ghost"
                type="button"
                onClick={onCancelStory}
                style={{ flex: '0 0 auto' }}
              >
                {t('story.cancelStory')}
              </button>
            ) : null}
            {story.status === 'developing' || story.status === 'self_testing' ? (
              <button className="tf-btn tf-danger" data-tone="ghost" type="button" onClick={onCancelRun} style={{ flex: '0 0 auto' }}>
                {t('story.cancelRun')}
              </button>
            ) : null}
            <button className="tf-btn tf-danger" data-tone="ghost" type="button" onClick={onDelete} style={{ flex: '0 0 auto' }}>
              <TrashGlyph />
              {t('delete.action')}
            </button>
            {action === null ? null : story.status === 'ready' ? (
              <RunTierControl
                t={t}
                label={t('run.button')}
                icon={ICONS.soft}
                tone="soft"
                onStart={onStartRun}
              />
            ) : (
              <button className="tf-btn" data-tone={action.tone} type="button" onClick={onAct} style={{ flex: '0 0 auto' }}>
                {action.icon}
                {action.label}
              </button>
            )}
          </>
        )}
      </div>

      <div className="tf-grid">
        <div>
          <section className="tf-card">
            <SectionHead
              title={t('detail.storyBody')}
              action={
                readOnly || onNewDiscussion === undefined ? undefined : (
                  <button
                    className="tf-btn tf-btn-sm"
                    data-tone="soft"
                    type="button"
                    disabled={discussionBusy}
                    onClick={onNewDiscussion}
                  >
                    <PlusGlyph />
                    {discussionBusy ? t('detail.discussionStarting') : t('detail.storyDiscussion')}
                  </button>
                )
              }
            />
            <div className="tf-doc-body">
              {story.bodyMissing ? (
                <p className="tf-card-hint" style={{ margin: 0 }}>
                  {t('body.missing', { path: story.path })}
                </p>
              ) : story.body.trim() === '' ? (
                <p className="tf-card-hint" style={{ margin: 0 }}>
                  {t('detail.noDescription')}
                </p>
              ) : (
                <MarkdownBody
                  text={story.body}
                  t={t}
                  basePath={story.path}
                  onOpenPath={onOpenPath}
                  onMissing={onMissing}
                />
              )}
            </div>
            <DiscussionSessions
              t={t}
              sessions={story.sessions}
              sessionTitle={sessionTitle}
              onOpenSession={onOpenSession}
              readOnly={readOnly}
            />
          </section>

          <section className="tf-card">
            <SectionHead
              title={t('detail.runs')}
              hint={story.runs.length === 0 ? t('detail.runsEmpty') : `${story.runs.length}`}
            />
            {story.runs.map((run) => (
              <div key={run.id} className="tf-run">
                <span className="tf-run-dot" data-state={runState(run.status)} />
                <span className="tf-run-main">
                  <span className="tf-run-title">{run.subjectTitle}</span>
                  <span className="tf-run-meta">
                    {`${run.branch} · ${t(`run.status.${run.status}`)} · ${formatWhen(run.at)}`}
                  </span>
                </span>
                {readOnly ? null : (
                  <button
                    className="tf-btn"
                    data-tone="ghost"
                    type="button"
                    disabled={run.sessionId === undefined}
                    onClick={() => onOpenSession(run.sessionId)}
                  >
                    {t('row.open')}
                  </button>
                )}
              </div>
            ))}
          </section>
        </div>

        <aside>
          <section className="tf-card">
            <SectionHead title={t('detail.props')} />
            <dl className="tf-kv">
              <dt>{t('detail.requirement')}</dt>
              <dd>{requirement === undefined ? t('detail.standalone') : requirement.title}</dd>
              <dt>{t('detail.id')}</dt>
              <dd className="tf-id">{story.id}</dd>
              <dt>{t('detail.workspace')}</dt>
              <dd>{workspace}</dd>
              <dt>{t('detail.status')}</dt>
              <dd>{t(`story.status.${story.status}`)}</dd>
              <dt>{t('detail.updated')}</dt>
              <dd>{formatWhen(story.updatedAt)}</dd>
              {story.createSessionId === undefined ? null : (
                <>
                  <dt>{t('detail.sessionKindCreate')}</dt>
                  <dd>
                    <span className="tf-kv-session">
                      {readOnly ? (
                        <span className="tf-session-title" title={sessionTitle(story.createSessionId)}>
                          {sessionTitle(story.createSessionId)}
                        </span>
                      ) : (
                        <button
                          type="button"
                          title={sessionTitle(story.createSessionId)}
                          onClick={() => onOpenSession(story.createSessionId)}
                        >
                          {sessionTitle(story.createSessionId)}
                        </button>
                      )}
                    </span>
                  </dd>
                </>
              )}
            </dl>
          </section>
        </aside>
      </div>
    </>
  )
}
