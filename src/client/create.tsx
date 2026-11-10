/**
 * The Create page: pick a kind, a workspace and describe the work item.
 *
 * The page is a pure form. It never talks to the Host directly — the panel
 * passes a `onSubmit` capability that builds the prompt and starts the
 * conversation, so this component can be replayed and tested with plain props.
 *
 * @module
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent, ReactElement } from 'react'

import {
  CREATE_KINDS,
  CREATE_KIND_LABEL,
  type CreateDraft,
  type CreateKind,
} from '../create.ts'
import type { AttachmentPolicy } from '../remote/contract.ts'
import {
  describeMediaTypes,
  fileExtension,
  fileKey,
  formatBytes,
  intakeAttachments,
  isImageFile,
  type AttachmentRejection,
} from './create-attachment.ts'
import type { TranslateFn, UploadFailureReason, WorkspaceOption } from './context.ts'
import { orderQuickPicks, readRecentWorkspaces, rememberWorkspace, pruneRecent, writeRecentWorkspaces } from './recent-workspaces.ts'
import { WorkspacePicker } from './workspace-picker.tsx'

/** One picked file plus what the form shows for it while submitting. */
export type CreateUploadStatus = 'queued' | 'uploading' | 'uploaded' | 'failed'

/** Staging state of one file, keyed by `fileKey` so a removed row drops it. */
export interface CreateUploadState {
  readonly status: CreateUploadStatus
  /** Upload percentage, present once the Host reports bytes. */
  readonly percent?: number
  /** Why the upload failed, translated by the row instead of the Host text. */
  readonly reason?: UploadFailureReason
}

/** What the form hands to the start flow: the draft plus its files. */
export interface CreateSurfaceDraft extends CreateDraft {
  readonly attachments: readonly File[]
}

/** Props injected by the workbench page. */
export interface CreateSurfaceProps {
  readonly t: TranslateFn
  /** Real Host workspaces; the fallback pseudo-workspace is not offered here. */
  readonly workspaces: readonly WorkspaceOption[]
  /**
   * Whether `workspaces` is the Host's authoritative list rather than a list
   * still being loaded or a one-time copy taken at mount.
   *
   * Only then may remembered quick picks be dropped and a selection that
   * vanished be cleared; doing it while the list is still arriving would treat
   * "not known yet" as "deleted".
   */
  readonly workspacesReady?: boolean
  readonly busy: boolean
  /** Failure from the start flow; the form stays filled so nothing is lost. */
  readonly error: string | null
  /**
   * Attachment rules read from the Host, mirrored instead of redefined.
   *
   * `undefined` while the read is in flight; `null` when the Host composes no
   * attachment store, in which case nothing is validated here either.
   */
  readonly attachmentPolicy?: AttachmentPolicy | null
  /** Whether this build exposes the Host's upload service. */
  readonly attachmentAvailable?: boolean
  /** Per-file staging state of the submission in flight, keyed by `fileKey`. */
  readonly uploads?: Readonly<Record<string, CreateUploadState>>
  readonly onSubmit: (draft: CreateSurfaceDraft) => void
  readonly onCancel: () => void
}

/** Locale key of the line explaining one failed upload. */
const FAILURE_KEY = {
  rejected: 'create.attachment.failed.rejected',
  storage: 'create.attachment.failed.storage',
  network: 'create.attachment.failed.network',
  unknown: 'create.attachment.failed.unknown',
} as const

/** Locale key of the message explaining one refused file. */
const REJECTION_KEY = {
  unsupportedType: 'create.attachment.rejected.type',
  tooLarge: 'create.attachment.rejected.size',
  tooMany: 'create.attachment.rejected.count',
  totalTooLarge: 'create.attachment.rejected.total',
} as const

/** One radio-style card for a work-item kind. */
function KindOption({
  kind,
  active,
  t,
  onSelect,
}: {
  readonly kind: CreateKind
  readonly active: boolean
  readonly t: TranslateFn
  readonly onSelect: () => void
}): ReactElement {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      className="tf-kind-option"
      data-active={active ? 'true' : undefined}
      onClick={onSelect}
    >
      <span className="tf-kind-name">{t(CREATE_KIND_LABEL[kind])}</span>
      <span className="tf-kind-hint">{t(`create.kind.${kind}.hint`)}</span>
    </button>
  )
}

/**
 * Render the Create page.
 * @param props - translator, workspace options and the start capability.
 * @returns the form surface.
 */
export function CreateSurface({
  t,
  workspaces,
  workspacesReady = true,
  busy,
  error,
  attachmentPolicy,
  attachmentAvailable = true,
  uploads = {},
  onSubmit,
  onCancel,
}: CreateSurfaceProps): ReactElement {
  const [kind, setKind] = useState<CreateKind>('requirement')
  // The workspace is deliberately never pre-selected, not even when only one
  // exists: creating an item in the wrong workspace is expensive, so the user
  // always picks it by hand. The value stays empty until they do — including
  // after the Host list arrives late (see the removed auto-select fallback).
  const [workspace, setWorkspace] = useState('')
  const [description, setDescription] = useState('')
  // Keep the message together with the field it belongs to: the alert stays at the bottom
  // of the form (unchanged), while the offending control gets the error outline.
  const [invalid, setInvalid] = useState<{ message: string; field: 'workspace' | 'description' } | null>(null)
  // Picked files stay in selection order; the submission reports staging state
  // per file identity, so removing one row never moves another row's error.
  const [files, setFiles] = useState<readonly File[]>([])
  const [rejections, setRejections] = useState<readonly AttachmentRejection[]>([])
  const picker = useRef<HTMLInputElement>(null)
  // Image thumbnails are object URLs owned by this component: created once per
  // picked file and revoked when it leaves the list or the page unmounts.
  const previews = useRef(new Map<string, string>())
  const [, bumpPreviews] = useState(0)
  // Images whose bytes the browser cannot decode fall back to the file chip
  // instead of a broken-image placeholder.
  const [broken, setBroken] = useState<readonly string[]>([])

  // Focus the required control when a submit is refused, so keyboard users land
  // on the field that has to be filled instead of hunting for it.
  const workspaceField = useRef<HTMLInputElement>(null)
  // Ids of the workspaces picked most recently, newest first. Only the ids are
  // stored; the quick-pick row below the field rebuilds the titles from the
  // Host list, so a rename or a deleted workspace cannot show a stale label.
  const [recent, setRecent] = useState<readonly string[]>(() => readRecentWorkspaces())
  const quickPicks = useMemo(() => orderQuickPicks(workspaces, recent), [workspaces, recent])

  /**
   * Take one workspace from the list or from a quick pick.
   *
   * Choosing is the only way the value fills: the page never pre-selects a
   * workspace, and a pick is what feeds the quick-pick row next time.
   */
  const chooseWorkspace = (id: string): void => {
    setWorkspace(id)
    setRecent((current) => rememberWorkspace(id, current))
    if (invalid?.field === 'workspace') setInvalid(null)
  }

  // Quick picks must name workspaces that exist right now, so remembered ids
  // are checked against the Host's current list whenever it changes (and when
  // the page opens). A workspace deleted from DSH therefore disappears from the
  // row immediately, and the stale id is dropped from storage as well.
  useEffect(() => {
    if (!workspacesReady) return
    setRecent((current) => {
      const kept = pruneRecent(current, workspaces)
      if (kept === current) return current
      writeRecentWorkspaces(kept)
      return kept
    })
  }, [workspaces, workspacesReady])

  // The same check for the chosen value: if that workspace is deleted while the
  // form is open, keep the draft but return the field to "please choose" so the
  // form cannot submit against a workspace that no longer exists.
  useEffect(() => {
    if (!workspacesReady || workspace === '') return
    if (workspaces.some((entry) => entry.id === workspace)) return
    setWorkspace('')
  }, [workspace, workspaces, workspacesReady])

  /** Keep one object URL per picked image, and drop the ones no longer listed. */
  useEffect(() => {
    const images = files.filter(isImageFile)
    const wanted = new Set(images.map(fileKey))
    let changed = false
    for (const [key, url] of [...previews.current]) {
      if (!wanted.has(key)) {
        URL.revokeObjectURL(url)
        previews.current.delete(key)
        changed = true
      }
    }
    for (const file of images) {
      const key = fileKey(file)
      if (!previews.current.has(key)) {
        previews.current.set(key, URL.createObjectURL(file))
        changed = true
      }
    }
    if (changed) bumpPreviews((count) => count + 1)
  }, [files])

  useEffect(
    () => () => {
      for (const url of previews.current.values()) URL.revokeObjectURL(url)
      previews.current.clear()
    },
    [],
  )

  /**
   * Admit one pick, keeping the legal files and explaining every refused one.
   *
   * The limits come from the Host (`attachmentPolicy`); when it is unknown the
   * page validates nothing, exactly like a composer without image limits.
   */
  const pick = (event: ChangeEvent<HTMLInputElement>): void => {
    const picked = Array.from(event.target.files ?? [])
    // Clear the control so removing a file and picking it again still fires.
    event.target.value = ''
    if (picked.length === 0) return
    const intake = intakeAttachments(picked, files, attachmentPolicy ?? null)
    if (intake.accepted.length > 0) setFiles((current) => [...current, ...intake.accepted])
    setRejections(intake.rejections)
  }

  /** Drop one file; its row disappears and a retry no longer uploads it. */
  const remove = (index: number): void => {
    setFiles((current) => current.filter((_, position) => position !== index))
    setRejections([])
  }

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (busy) return
    const chosen = workspaces.find((item) => item.id === workspace)
    if (chosen === undefined) {
      setInvalid({ message: t('create.required.workspace'), field: 'workspace' })
      // Nothing is reset: the description and picked files stay in the form.
      workspaceField.current?.focus()
      return
    }
    if (description.trim().length === 0) {
      setInvalid({ message: t('create.required.description'), field: 'description' })
      return
    }
    setInvalid(null)
    onSubmit({
      kind,
      workspaceId: chosen.id,
      workspaceTitle: chosen.title,
      description: description.trim(),
      attachments: files,
    })
  }

  const canSubmit = workspaces.length > 0 && description.trim().length > 0 && !busy
  const staging =
    busy && Object.values(uploads).some((state) => state.status === 'uploading' || state.status === 'queued')
  const types = describeMediaTypes(attachmentPolicy ?? null, t('create.attachment.typeSeparator'))
  const attachmentHint =
    attachmentAvailable === false
      ? t('create.attachment.unavailable')
      : attachmentPolicy === undefined
        ? t('create.attachment.optional')
        : attachmentPolicy === null || types.length === 0
          ? t('create.attachment.hintPlain')
          : t('create.attachment.hint', {
              types,
              size: formatBytes(attachmentPolicy.maxImageBytes),
              count: attachmentPolicy.maxImagesPerMessage,
            })

  return (
    <div className="tf-create">
      <header className="tf-detail-head">
        <div className="tf-detail-heading">
          <h1 className="tf-title">{t('create.title')}</h1>
          <p className="tf-sub">{t('create.subtitle')}</p>
        </div>
      </header>

      <form className="tf-create-form" onSubmit={submit}>
        <section className="tf-card">
          <div className="tf-card-head">
            <h2 className="tf-card-title">{t('create.kind')}</h2>
            <span className="tf-card-hint">{t('create.kind.hint')}</span>
          </div>
          <div className="tf-kind-grid" role="radiogroup" aria-label={t('create.kind')}>
            {CREATE_KINDS.map((item) => (
              <KindOption
                key={item}
                kind={item}
                active={item === kind}
                t={t}
                onSelect={() => setKind(item)}
              />
            ))}
          </div>
        </section>

        <section className="tf-card">
          <div className="tf-field">
            <span className="tf-field-label">
              {t('create.workspace')}
              <span className="tf-required-badge">{t('create.required.badge')}</span>
            </span>
            <WorkspacePicker
              workspaces={workspaces}
              value={workspace}
              quickPicks={quickPicks}
              disabled={busy || workspaces.length === 0}
              pending={!workspacesReady}
              invalid={invalid?.field === 'workspace'}
              describedBy="tf-workspace-hint"
              t={t}
              inputRef={workspaceField}
              onSelect={chooseWorkspace}
            />
            <span className="tf-field-hint" id="tf-workspace-hint">
              {!workspacesReady
                ? t('create.workspace.loadingHint')
                : workspaces.length === 0
                  ? t('create.workspace.emptyHint')
                  : t('create.workspace.hint')}
            </span>
          </div>

          <label className="tf-field">
            <span className="tf-field-label">{t('create.description')}</span>
            <textarea
              className="tf-textarea"
              rows={9}
              value={description}
              data-invalid={invalid?.field === 'description' ? 'true' : undefined}
              aria-invalid={invalid?.field === 'description' ? true : undefined}
              disabled={busy}
              placeholder={t(`create.descriptionPlaceholder.${kind}`)}
              onChange={(event) => setDescription(event.target.value)}
            />
            <span className="tf-field-hint">{t('create.descriptionHint')}</span>
          </label>
        </section>

        <section className="tf-card">
          <div className="tf-card-head">
            <h2 className="tf-card-title">{t('create.attachment.label')}</h2>
            <span className="tf-card-hint">{t('create.attachment.optional')}</span>
          </div>
          <div className="tf-attachment-bar">
            <button
              className="tf-btn"
              data-tone="soft"
              type="button"
              disabled={busy || attachmentAvailable === false}
              onClick={() => picker.current?.click()}
            >
              {t('create.attachment.add')}
            </button>
            <span className="tf-field-hint tf-grow">{attachmentHint}</span>
          </div>
          <input
            ref={picker}
            className="tf-attachment-input"
            type="file"
            multiple
            tabIndex={-1}
            aria-hidden
            onChange={pick}
          />
          {files.length > 0 ? (
            <ul className="tf-attachment-list">
              {files.map((file, index) => {
                const state = uploads[fileKey(file)]
                // No submission in flight yet: the card shows only its size.
                const label =
                  state === undefined
                    ? null
                    : state.status === 'uploaded'
                      ? t('create.attachment.uploaded')
                      : state.status === 'failed'
                        ? t('create.attachment.failed')
                        : state.status === 'uploading'
                          ? state.percent === undefined
                            ? t('create.attachment.uploading')
                            : t('create.attachment.uploadingPercent', { percent: state.percent })
                          : t('create.attachment.queued')
                const key = fileKey(file)
                const preview = broken.includes(key) ? undefined : previews.current.get(key)
                return (
                  <li key={`${fileKey(file)}-${index}`} className="tf-attachment-item" data-state={state?.status}>
                    <span className="tf-attachment-thumb" data-kind={isImageFile(file) ? 'image' : 'file'}>
                      {preview === undefined ? (
                        <span className="tf-attachment-ext">{fileExtension(file.name)}</span>
                      ) : (
                        <img
                          className="tf-attachment-thumb-img"
                          src={preview}
                          alt={file.name}
                          onError={() => setBroken((current) => (current.includes(key) ? current : [...current, key]))}
                        />
                      )}
                    </span>
                    <span className="tf-attachment-body">
                      <span className="tf-attachment-name" title={file.name}>
                        {file.name}
                      </span>
                      <span className="tf-attachment-meta">
                        <span className="tf-attachment-size">{formatBytes(file.size)}</span>
                        {label === null ? null : (
                          <>
                            <span className="tf-attachment-sep" aria-hidden>
                              {t('create.attachment.metaSep')}
                            </span>
                            <span className="tf-attachment-status">{label}</span>
                          </>
                        )}
                      </span>
                      {state?.status === 'failed' && state.reason !== undefined ? (
                        <span className="tf-attachment-error">
                          {t(FAILURE_KEY[state.reason])}
                        </span>
                      ) : null}
                      {state?.status === 'uploading' ? (
                        <span className="tf-attachment-track">
                          <span
                            className="tf-attachment-fill"
                            style={{ width: `${Math.max(4, Math.min(100, state.percent ?? 0))}%` }}
                          />
                        </span>
                      ) : null}
                    </span>
                    <button
                      className="tf-attachment-remove"
                      type="button"
                      aria-label={`${t('create.attachment.remove')} ${file.name}`}
                      disabled={busy}
                      onClick={() => remove(index)}
                    >
                      ×
                    </button>
                  </li>
                )
              })}
            </ul>
          ) : null}
          {rejections.length > 0 ? (
            <ul className="tf-attachment-rejected" role="alert">
              {rejections.map((rejection, index) => (
                <li key={`${rejection.file.name}-${index}`}>
                  {t(REJECTION_KEY[rejection.reason], {
                    name: rejection.file.name,
                    ...rejection.params,
                  })}
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        {invalid !== null || error !== null ? (
          <div className="tf-error" role="alert">
            <AlertText text={invalid?.message ?? error ?? ''} />
          </div>
        ) : null}

        <div className="tf-create-actions">
          <button className="tf-btn" data-tone="primary" type="submit" disabled={!canSubmit}>
            {staging ? t('create.attachment.submitUploading') : busy ? t('create.submitting') : t('create.submit')}
          </button>
          <button
            className="tf-btn"
            data-tone="ghost"
            type="button"
            disabled={busy && !staging}
            onClick={onCancel}
          >
            {t('create.cancel')}
          </button>
          <span className="tf-field-hint tf-grow">
            {staging
              ? t('create.attachment.blocked')
              : !busy && Object.values(uploads).some((state) => state.status === 'failed')
                ? t('create.attachment.retryHint')
                : t('create.sendHint')}
          </span>
        </div>
      </form>
    </div>
  )
}

/** Keep the alert markup identical for client-side and Host failures. */
function AlertText({ text }: { readonly text: string }): ReactElement {
  return <span className="tf-error-text">{text}</span>
}
