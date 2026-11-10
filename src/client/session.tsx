/**
 * The conversation's 「息壤工作台」 tab: read-only access to the teamflow 环节
 * this conversation is attached to.
 *
 * The tab is a Conversation View, so the Host's own tab row stays in place and
 * switching back to the conversation never leaves the page. Everything below is
 * rendered from one snapshot read through the same Remote channel the full-view
 * workbench uses, and the detail surfaces are the workbench's own components in
 * their read-only mode — there is no second copy of a requirement, story or bug
 * page to drift apart.
 *
 * Three states follow from the attachment alone: no link (empty guidance), a
 * link whose 环节 has no detail page yet (placeholder), and a link with a page
 * (the read-only detail). Loading and read failures never render a spinner
 * forever: they end in a short message with a retry.
 *
 * @module
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactElement } from 'react'

import type { WorkbenchSnapshot } from '../remote/contract.ts'
import { EMPTY_BOARD, buildBoard } from './board.ts'
import type { Board, BugNode, RequirementNode, StoryNode } from './board.ts'
import type { TranslateFn, UseSessionStatus, UseSessions, WorkspaceOption } from './context.ts'
import { normalizePath } from './files.ts'
import {
  BugSurface,
  DocSurface,
  RequirementSurface,
  StorySurface,
  failureMessage,
} from './page.tsx'
import type { WorkbenchData } from './page.tsx'
import type { RunStartOutcome } from './run-tier.tsx'
import { ChevronLeft, RefreshGlyph } from './icons.tsx'
import { resolveSessionTab } from './session-link.ts'
import type { DetailTarget } from './session-link.ts'
import { sessionDisplayTitle, useEmptySessions } from './session-title.ts'
import { SESSION_STYLES, STYLES } from './styles.ts'

/** Props injected by the Conversation View registration. */
export interface SessionWorkbenchProps {
  /** Translator bound to this plugin's namespace. */
  readonly t: TranslateFn
  /** Host queries shared with the full-view workbench. */
  readonly data: WorkbenchData
  /** Conversation whose 环节 is shown; the Host passes it to the slot inject. */
  readonly sessionId?: string
  /** DSH workspaces, used to label the workspace of the shown record. */
  readonly workspaces?: readonly WorkspaceOption[]
  /** Host's standard session-list hook, used for linked-conversation titles. */
  readonly useSessions?: UseSessions
  /** Host's standard live-session-status hook, used by the progress chart. */
  readonly useSessionStatus?: UseSessionStatus
  /**
   * Show one record in the workbench panel of the current page.
   *
   * Returns false when the Host refused the panel selection, so the tab can say
   * so instead of leaving a button that appears to do nothing.
   */
  readonly openInWorkbench: (target: DetailTarget) => boolean
}

/** Reading sub-views of a requirement: a document, or one of its stories. */
type NestedView =
  | { readonly kind: 'doc'; readonly path: string }
  | { readonly kind: 'story'; readonly storyId: string }

/** Find a story under a requirement or among the standalone ones. */
function findStory(board: Board, id: string): StoryNode | undefined {
  return (
    board.standalone.find((item) => item.story.id === id)?.story ??
    board.requirements.flatMap((requirement) => requirement.stories).find((story) => story.id === id)
  )
}

/** Resolve a workspace id to the title the Host gave it. */
function workspaceTitle(
  workspaces: readonly WorkspaceOption[] | undefined,
  id: string,
  t: TranslateFn,
): string {
  const found = workspaces?.find((option) => option.id === id)
  if (found !== undefined) return found.title
  return id.length > 0 ? id : t('workspace.local')
}

/**
 * Render the read-only workbench tab.
 * @param props - translator, Host queries, conversation and workspace list.
 * @returns the tab surface.
 */
export function SessionWorkbench({
  t,
  data,
  sessionId,
  workspaces,
  openInWorkbench,
  useSessions,
  useSessionStatus,
}: SessionWorkbenchProps): ReactElement {
  const sessionList = (useSessions ?? useEmptySessions)((state) => state)
  const sessionTitle = useCallback(
    (linkedId: string) => sessionDisplayTitle(sessionList, linkedId),
    [sessionList],
  )
  const [snapshot, setSnapshot] = useState<WorkbenchSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [nested, setNested] = useState<NestedView | null>(null)
  const [docBodies, setDocBodies] = useState<Readonly<Record<string, string>>>({})
  const [docError, setDocError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  /** Frame guard: the View unmounts when the user switches back to chat. */
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const next = await data.load()
      if (!mounted.current) return
      setSnapshot(next)
      // The frame may have changed on disk; read documents again on demand.
      setDocBodies({})
      setDocError(null)
    } catch (failure) {
      if (mounted.current) setError(failureMessage(failure))
    } finally {
      if (mounted.current) setLoading(false)
    }
  }, [data])

  // One read per conversation. A conversation switch resets the reading
  // position too, so a document opened under one session never leaks into another.
  useEffect(() => {
    setNested(null)
    setNotice(null)
    void refresh()
  }, [refresh, sessionId])

  const board = useMemo(() => (snapshot === null ? EMPTY_BOARD : buildBoard(snapshot)), [snapshot])
  const tab = useMemo(
    () => (snapshot === null ? null : resolveSessionTab(snapshot, sessionId)),
    [snapshot, sessionId],
  )
  const target = tab?.kind === 'detail' ? tab.target : null

  const requirement: RequirementNode | undefined =
    target?.kind === 'requirement'
      ? board.requirements.find((entry) => entry.id === target.id)
      : undefined

  const loadDoc = useCallback(
    async (docId: string) => {
      setDocError(null)
      try {
        const result = await data.readDoc(docId)
        if (!mounted.current) return
        setDocBodies((current) => ({ ...current, [result.id]: result.body }))
      } catch (failure) {
        if (mounted.current) setDocError(failureMessage(failure))
      }
    },
    [data],
  )

  /** Follow one markdown link inside the shown requirement. */
  const openPath = useCallback(
    (raw: string) => {
      if (requirement === undefined) return
      const path = normalizePath(raw)
      if (path === null) {
        setNotice(t('doc.linkMissing', { path: raw }))
        return
      }
      if (path === normalizePath(requirement.path)) {
        setNested({ kind: 'doc', path: requirement.path })
        return
      }
      const doc = requirement.docs.find((entry) => normalizePath(entry.path) === path)
      if (doc !== undefined) {
        setNested({ kind: 'doc', path: doc.path })
        return
      }
      const story = requirement.stories.find((entry) => normalizePath(entry.path) === path)
      if (story !== undefined) {
        setNested({ kind: 'story', storyId: story.id })
        return
      }
      setNotice(t('doc.linkMissing', { path: raw }))
    },
    [requirement, t],
  )

  // An open document owns its body read: opening it, retrying after a failure
  // and a manual refresh all converge here, so no path can leave the reader on
  // a body that will never arrive.
  useEffect(() => {
    if (nested?.kind !== 'doc' || requirement === undefined) return
    const open = requirement.docs.find((entry) => entry.path === nested.path)
    if (open === undefined || docBodies[open.id] !== undefined) return
    void loadDoc(open.id)
  }, [docBodies, loadDoc, nested, requirement])


  // The panel may never have mounted, so the tab brings the shared sheet along.
  const styleTag = useMemo(() => <style>{`${STYLES}${SESSION_STYLES}`}</style>, [])

  /** One centered message: used by loading, empty, placeholder and missing. */
  const centered = (
    title: string,
    body: string,
    extra?: ReactElement,
  ): ReactElement => (
    <div className="tf-tab-state">
      <div className="tf-tab-state-inner">
        <div className="tf-tab-state-title">{title}</div>
        <div className="tf-tab-state-body">{body}</div>
        {extra}
      </div>
    </div>
  )

  const retry = (
    <button className="tf-btn" data-tone="soft" type="button" disabled={loading} onClick={() => void refresh()}>
      {t('session.retry')}
    </button>
  )

  // First read: no frame yet. A failure is a message with a retry, never a blank
  // surface, and the retry is the only control because there is nothing to link to.
  if (snapshot === null || tab === null) {
    return (
      <div className="tf-root tf-tab">
        {styleTag}
        {error !== null
          ? centered(t('session.loadFailedTitle'), error, retry)
          : centered(t('session.loading'), t('session.loadingBody'))}
      </div>
    )
  }

  // No attachment at all: explain what the tab is for. No creation action — the
  // workbench owns creation, and this surface is read-only by contract.
  if (tab.kind === 'empty') {
    return (
      <div className="tf-root tf-tab">
        {styleTag}
        {centered(t('session.emptyTitle'), t('session.emptyBody'))}
      </div>
    )
  }

  // Attached 环节 without a detail page yet (mapping table miss): say so, render
  // no detail container, request no record data.
  if (tab.kind === 'placeholder') {
    return (
      <div className="tf-root tf-tab">
        {styleTag}
        {centered(
          t('session.placeholderTitle'),
          t('session.placeholderBody'),
        )}
      </div>
    )
  }

  if (tab.kind === 'missing' || target === null) {
    return (
      <div className="tf-root tf-tab">
        {styleTag}
        {centered(t('session.missingTitle'), t('session.missingBody'), retry)}
      </div>
    )
  }

  const story =
    target.kind === 'story'
      ? findStory(board, target.id)
      : nested?.kind === 'story' && requirement !== undefined
        ? requirement.stories.find((entry) => entry.id === nested.storyId)
        : undefined
  const bug: BugNode | undefined =
    target.kind === 'bug' ? board.bugs.find((entry) => entry.id === target.id) : undefined

  if (
    (target.kind === 'requirement' && requirement === undefined) ||
    (target.kind === 'story' && story === undefined) ||
    (target.kind === 'bug' && bug === undefined)
  ) {
    return (
      <div className="tf-root tf-tab">
        {styleTag}
        {centered(t('session.missingTitle'), t('session.missingBody'), retry)}
      </div>
    )
  }

  const doc =
    nested?.kind === 'doc' && requirement !== undefined
      ? requirement.docs.find((entry) => entry.path === nested.path)
      : undefined
  const docBody =
    nested?.kind === 'doc' && requirement !== undefined
      ? nested.path === requirement.path
        ? requirement.content.join('\n')
        : doc === undefined
          ? null
          : (docBodies[doc.id] ?? null)
      : null

  const title =
    nested?.kind === 'doc'
      ? (doc?.title ?? t('detail.design'))
      : nested?.kind === 'story' && story !== undefined
        ? story.title
        : target.kind === 'requirement'
          ? (requirement?.title ?? '')
          : target.kind === 'story'
            ? (story?.title ?? '')
            : (bug?.title ?? '')

  const noop = (): void => undefined
  // The read-only tab never starts a run; the surfaces still ask for the
  // callback shape, so it resolves to a refusal it will never show.
  const noStart = async (): Promise<RunStartOutcome> => ({ ok: false, message: t('run.startFailed') })

  let surface: ReactElement
  if (target.kind === 'requirement' && requirement !== undefined) {
    if (nested?.kind === 'doc') {
      surface = (
        <DocSurface
          t={t}
          requirement={requirement}
          path={nested.path}
          doc={doc}
          body={docBody}
          onOpenPath={openPath}
          onMissing={(path) => setNotice(t('doc.linkMissing', { path }))}
        />
      )
    } else if (nested?.kind === 'story' && story !== undefined) {
      surface = (
        <StorySurface
          t={t}
          story={story}
          requirement={requirement}
          workspace={workspaceTitle(workspaces, story.workspaceId, t)}
          sessionTitle={sessionTitle}
          action={null}
          onAct={noop}
          onStartRun={noStart}
          onDelete={noop}
          onComplete={noop}
          onCancelStory={noop}
          onCancelRun={noop}
          onOpenSession={noop}
          onOpenPath={openPath}
          onMissing={(path) => setNotice(t('doc.linkMissing', { path }))}
          readOnly
        />
      )
    } else {
      surface = (
        <RequirementSurface
          requirement={requirement}
          t={t}
          sessionTitle={sessionTitle}
          workspace={workspaceTitle(workspaces, requirement.workspaceId, t)}
          action={null}
          onAct={noop}
          onDelete={noop}
          onComplete={noop}
          onOpenPath={openPath}
          onStoryAct={noop}
          onStoryDetail={(entry) => setNested({ kind: 'story', storyId: entry.id })}
          onOpenSession={noop}
          onNewDiscussion={noop}
          discussionBusy={null}
          useSessionStatus={useSessionStatus}
          readOnly
        />
      )
    }
  } else if (target.kind === 'story' && story !== undefined) {
    surface = (
      <StorySurface
        t={t}
        story={story}
        requirement={board.requirements.find((entry) =>
          entry.stories.some((candidate) => candidate.id === story.id),
        )}
        workspace={workspaceTitle(workspaces, story.workspaceId, t)}
        sessionTitle={sessionTitle}
        action={null}
        onAct={noop}
        onStartRun={noStart}
        onDelete={noop}
        onComplete={noop}
        onCancelStory={noop}
        onCancelRun={noop}
        onOpenSession={noop}
        onOpenPath={openPath}
        onMissing={(path) => setNotice(t('doc.linkMissing', { path }))}
        readOnly
      />
    )
  } else if (bug !== undefined) {
    surface = (
      <BugSurface
        t={t}
        bug={bug}
        workspace={workspaceTitle(workspaces, bug.workspaceId, t)}
        sessionTitle={sessionTitle}
        onOpenSession={noop}
        onDelete={noop}
        onComplete={noop}
        onStartFix={noStart}
        onCancelFix={noop}
        readOnly
      />
    )
  } else {
    surface = centered(t('session.missingTitle'), t('session.missingBody'), retry)
  }

  return (
    <div className="tf-root tf-tab">
      {styleTag}
      <div className="tf-tab-bar">
        {nested === null ? null : (
          <button
            className="tf-btn tf-tab-back"
            data-tone="ghost"
            type="button"
            onClick={() => {
              setDocError(null)
              setNotice(null)
              setNested(null)
            }}
          >
            <ChevronLeft />
            {t('session.back')}
          </button>
        )}
        <span className="tf-tab-crumb" title={title}>
          {title}
        </span>
        <span className="tf-grow" />
        <span className="tf-tab-readonly">{t('session.readOnly')}</span>
        <button
          className="tf-btn"
          data-tone="ghost"
          type="button"
          disabled={loading}
          onClick={() => void refresh()}
        >
          <RefreshGlyph />
          {loading ? t('session.refreshing') : t('session.refresh')}
        </button>
        <button
          className="tf-btn tf-tab-open"
          data-tone="primary"
          type="button"
          onClick={() => {
            if (!openInWorkbench(target)) setNotice(t('session.openInWorkbenchFailed'))
          }}
        >
          {t('session.openInWorkbench')}
        </button>
      </div>

      {error !== null ? (
        <div className="tf-tab-banner tf-error" role="alert">
          <span className="tf-error-text">{t('session.loadFailedTitle')} {error}</span>
          {retry}
        </div>
      ) : null}

      {notice !== null ? (
        <div className="tf-tab-banner tf-error" role="status">
          <span className="tf-error-text">{notice}</span>
          <button className="tf-btn" data-tone="ghost" type="button" onClick={() => setNotice(null)}>
            {t('session.dismiss')}
          </button>
        </div>
      ) : null}

      {docError !== null ? (
        <div className="tf-tab-banner tf-error" role="alert">
          <span className="tf-error-text">{t('doc.readFailed', { message: docError })}</span>
          <button
            className="tf-btn"
            data-tone="ghost"
            type="button"
            onClick={() => {
              if (doc !== undefined) void loadDoc(doc.id)
            }}
          >
            {t('session.retry')}
          </button>
        </div>
      ) : null}

      <div className="tf-scroll">
        <div className="tf-inner">{surface}</div>
      </div>
    </div>
  )
}
