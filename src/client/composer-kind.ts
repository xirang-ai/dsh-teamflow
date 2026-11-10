/**
 * The extra kinds the composer knows about besides the three creation kinds.
 *
 * A requirement discussion is not a creation flow: it starts from a specific
 * requirement page, which prepares the session binding before the composer
 * mounts. The outline (`design`), the detailed design (`detail`) and story
 * splitting (`split`) each run under their own discussion preset, so the
 * Agent picker names the job the user actually started. The preset is still
 * selected at session creation, so this module only keeps the visible picker in
 * sync with that choice. `sessionStorage` is a hint, never the source of truth:
 * a stale or malformed value falls back to "其他".
 *
 * @module
 */
import {
  CREATE_KINDS,
  CREATE_PRESET,
  CREATE_KIND_LABEL,
  type CreateKind,
} from '../create.ts'
import {
  DETAIL_DISCUSSION_PRESET,
  REQUIREMENT_DISCUSSION_PRESET,
  STORY_SPLIT_PRESET,
} from '../requirement-discussion.ts'

/** Kinds the composer can display; the discussion kinds only for a prepared session. */
export type ComposerKind = CreateKind | 'design' | 'detail' | 'split'

/** All kinds in display order. */
export const COMPOSER_KINDS: readonly ComposerKind[] = [...CREATE_KINDS, 'design', 'detail', 'split']

/** Preset id per composer kind. */
export const COMPOSER_PRESET: Readonly<Record<ComposerKind, string>> = {
  ...CREATE_PRESET,
  design: REQUIREMENT_DISCUSSION_PRESET,
  detail: DETAIL_DISCUSSION_PRESET,
  split: STORY_SPLIT_PRESET,
}

/** Locale keys for the picker options. */
export const COMPOSER_KIND_LABEL: Readonly<Record<ComposerKind, string>> = {
  ...CREATE_KIND_LABEL,
  design: 'composer.kind.design',
  detail: 'composer.kind.detail',
  split: 'composer.kind.split',
}

/** Narrow an untrusted value (a select value, sessionStorage) to a kind. */
export function isComposerKind(value: unknown): value is ComposerKind {
  return (
    value === 'requirement' ||
    value === 'story' ||
    value === 'bug' ||
    value === 'design' ||
    value === 'detail' ||
    value === 'split'
  )
}

const STORAGE_PREFIX = 'teamflow.composer.kind:'

/** Remember the kind for one session so a reload keeps the picker in sync. */
export function rememberComposerKind(sessionId: string, kind: ComposerKind): void {
  try {
    if (typeof sessionStorage === 'undefined') return
    sessionStorage.setItem(`${STORAGE_PREFIX}${sessionId}`, kind)
  } catch {
    // Storage can be unavailable (private mode, quota); the picker is optional.
  }
}

/** Read the remembered kind, ignoring stale or malformed values. */
export function readComposerKind(sessionId: string): ComposerKind | '' {
  try {
    if (typeof sessionStorage === 'undefined') return ''
    const value = sessionStorage.getItem(`${STORAGE_PREFIX}${sessionId}`)
    return isComposerKind(value) ? value : ''
  } catch {
    return ''
  }
}

/** Drop the hint when the user returns the session to the default agent. */
export function forgetComposerKind(sessionId: string): void {
  try {
    if (typeof sessionStorage === 'undefined') return
    sessionStorage.removeItem(`${STORAGE_PREFIX}${sessionId}`)
  } catch {
    // See rememberComposerKind.
  }
}
