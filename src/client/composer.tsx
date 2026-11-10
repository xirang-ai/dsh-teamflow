/**
 * Composer cell that turns a blank conversation into one of the interviewer
 * flows, including a design discussion prepared from the design page.
 *
 * It is registered into `conversation.input.left`, so it sits in the composer
 * tool row and only exists while a session is on screen. The cell only
 * composes the matching Agent preset on the blank session: the interviewer
 * instructions live in the preset persona, and the user's draft is never
 * touched.
 *
 * @module
 */
import { useCallback, useState } from 'react'
import type { ReactElement } from 'react'

import { CREATE_KINDS } from '../create.ts'
import {
  COMPOSER_KINDS,
  COMPOSER_KIND_LABEL,
  COMPOSER_PRESET,
  forgetComposerKind,
  readComposerKind,
  rememberComposerKind,
  type ComposerKind,
} from './composer-kind.ts'
import type { AgentPresetRemote, TranslateFn } from './context.ts'
import { COMPOSER_STYLES } from './styles.ts'

/** The subset of the session snapshot this cell reads. */
interface SessionSnapshotLike {
  readonly blank: boolean
}

/** Props injected by the composer slot. */
export interface ComposerKindPickerProps {
  readonly t: TranslateFn
  /** Preset registry face; absent when that plugin is not installed. */
  readonly agentPresets?: AgentPresetRemote
  readonly sessionId: string
  readonly useSession: <Value>(selector: (state: SessionSnapshotLike) => Value) => Value
}

/**
 * Render the kind picker.
 * @param props - bound translator, session hooks and the preset registry.
 * @returns the composer cell.
 */
export function ComposerKindPicker({
  t,
  agentPresets,
  sessionId,
  useSession,
}: ComposerKindPickerProps): ReactElement {
  const blank = useSession((state) => state.blank)
  const [mode, setMode] = useState<ComposerKind | ''>(() => readComposerKind(sessionId))
  // A discussion session keeps its option visible even after the user switches
  // away, so they can switch back without losing the binding.
  const [discussionSession] = useState(() => {
    const kind = readComposerKind(sessionId)
    return kind === 'design' || kind === 'detail' || kind === 'split'
  })
  const kinds: readonly ComposerKind[] = discussionSession ? COMPOSER_KINDS : CREATE_KINDS
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const change = useCallback(
    (next: ComposerKind | '') => {
      setError(null)
      const previous = mode

      if (!blank) {
        setMode(previous)
        setError(t('composer.locked'))
        return
      }

      if (next === '') {
        if (previous === '') return
        if (agentPresets === undefined) {
          setError(t('composer.noPreset'))
          return
        }
        // 其他（默认）means the plugin must not shape this task: give the
        // blank session back the registry's default preset. The draft stays
        // exactly as the user typed it.
        setPending(true)
        agentPresets
          .list()
          .then((roster) => {
            const fallback = roster.ok
              ? roster.value?.presets.find((preset) => preset.isDefault === true)
              : undefined
            return fallback === undefined
              ? undefined
              : agentPresets.select(sessionId, fallback.id)
          })
          .then((result) => {
            if (result === undefined) {
              setError(t('composer.failed'))
              return
            }
            if (!result.ok) {
              setError(result.error?.message ?? t('composer.failed'))
              return
            }
            forgetComposerKind(sessionId)
            setMode('')
          })
          .catch((failure: unknown) => {
            setError(failure instanceof Error ? failure.message : String(failure))
          })
          .finally(() => setPending(false))
        return
      }

      if (agentPresets === undefined) {
        setError(t('composer.noPreset'))
        return
      }

      setPending(true)
      agentPresets
        .select(sessionId, COMPOSER_PRESET[next])
        .then((result) => {
          if (!result.ok) {
            setError(result.error?.message ?? t('composer.failed'))
            return
          }
          rememberComposerKind(sessionId, next)
          setMode(next)
        })
        .catch((failure: unknown) => {
          setError(failure instanceof Error ? failure.message : String(failure))
        })
        .finally(() => setPending(false))
    },
    [agentPresets, blank, mode, sessionId, t],
  )

  return (
    <>
      <style>{COMPOSER_STYLES}</style>
      <span className="tf-composer">
      <label className="tf-composer-field">
        <span className="tf-composer-label">{t('composer.label')}</span>
        <select
          className="tf-select tf-composer-select"
          value={mode}
          disabled={pending}
          title={blank ? t('composer.hint') : t('composer.locked')}
          onChange={(event) => change(event.target.value as ComposerKind | '')}
        >
          <option value="">{t('composer.other')}</option>
          {kinds.map((kind) => (
            <option key={kind} value={kind}>
              {t(COMPOSER_KIND_LABEL[kind])}
            </option>
          ))}
        </select>
      </label>
      {error !== null ? (
        <span className="tf-composer-note" role="status">
          {error}
        </span>
      ) : null}
      </span>
    </>
  )
}
