/**
 * Workspace chooser of the Create page: a filterable combobox plus quick picks.
 *
 * The page must never pre-select a workspace (creating in the wrong one is
 * expensive), so this control starts empty and always requires a deliberate
 * choice — from the filtered list, or from the quick-pick row that repeats the
 * most recently used workspaces under the field.
 *
 * Interaction follows the ARIA combobox pattern: the text input owns focus and
 * the keyboard, the popup is a `listbox` of `option`s, and the active option is
 * mirrored through `aria-activedescendant`. Opening clears the filter so the
 * selected title never leaks into a typed query; closing restores it. Typing a
 * character while closed starts a fresh search instead of appending to the
 * title, which keeps the control usable entirely from the keyboard.
 *
 * @module
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, ReactElement, RefObject } from 'react'

import type { TranslateFn, WorkspaceOption } from './context.ts'
import { filterWorkspaces } from './recent-workspaces.ts'

/** Props injected by the Create page. */
export interface WorkspacePickerProps {
  /** Every workspace the Host reports, in its own order. */
  readonly workspaces: readonly WorkspaceOption[]
  /** Currently chosen workspace id; empty until the user picks one. */
  readonly value: string
  /** Quick picks: recently used workspaces first, then the Host order. */
  readonly quickPicks: readonly WorkspaceOption[]
  readonly disabled: boolean
  /**
   * The Host list is still arriving.
   *
   * Distinguishes "no workspaces exist" from "not known yet" so the field does
   * not claim there are none while the authoritative list is on its way.
   */
  readonly pending?: boolean
  readonly invalid: boolean
  /** Id of the hint that explains why the field is required. */
  readonly describedBy: string
  readonly t: TranslateFn
  /** The page keeps this ref so a refused submit can focus the field. */
  readonly inputRef: RefObject<HTMLInputElement>
  readonly onSelect: (id: string) => void
}

/** Chevron that opens the popup; decorative, the input runs the interaction. */
function Chevron(): ReactElement {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
      <path
        d="M2.5 4.5 6 8l3.5-3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/**
 * Render the workspace combobox and its quick-pick row.
 * @param props - workspaces, current value and the page callbacks.
 * @returns the field contents, without a label (the page owns that).
 */
export function WorkspacePicker({
  workspaces,
  value,
  quickPicks,
  disabled,
  pending = false,
  invalid,
  describedBy,
  t,
  inputRef,
  onSelect,
}: WorkspacePickerProps): ReactElement {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const root = useRef<HTMLDivElement>(null)
  const listId = useId()

  const selected = workspaces.find((entry) => entry.id === value)
  const filtered = useMemo(() => filterWorkspaces(workspaces, query), [workspaces, query])
  // The active row index can point past the filter after the query narrows.
  const activeIndex = filtered.length === 0 ? -1 : Math.min(active, filtered.length - 1)
  const optionId = (index: number): string => `${listId}-option-${index}`

  const close = (): void => {
    setOpen(false)
    setQuery('')
  }

  /** Open with an empty filter, so the query never starts from the title. */
  const openList = (): void => {
    if (disabled || workspaces.length === 0) return
    setOpen(true)
    setQuery('')
    setActive(0)
  }

  const select = (id: string): void => {
    onSelect(id)
    close()
  }

  // A click anywhere outside the field closes the popup; the options use
  // `mousedown` so choosing one never steals focus from the input.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      if (event.target instanceof Node && root.current?.contains(event.target) === true) return
      setOpen(false)
      setQuery('')
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (disabled) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (!open) {
        openList()
        return
      }
      setActive((current) => Math.min(current + 1, Math.max(0, filtered.length - 1)))
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) {
        openList()
        return
      }
      setActive((current) => Math.max(current - 1, 0))
      return
    }
    if (event.key === 'Home' && open) {
      event.preventDefault()
      setActive(0)
      return
    }
    if (event.key === 'End' && open) {
      event.preventDefault()
      setActive(Math.max(0, filtered.length - 1))
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      if (!open) {
        openList()
        return
      }
      const picked = activeIndex >= 0 ? filtered[activeIndex] : undefined
      if (picked !== undefined) select(picked.id)
      return
    }
    if (event.key === 'Escape' && open) {
      event.preventDefault()
      close()
      return
    }
    if (event.key === 'Tab' && open) {
      close()
      return
    }
    // A printed character with the popup closed starts a new search, instead of
    // appending to the selected title shown in the input.
    if (!open && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault()
      setOpen(true)
      setQuery(event.key)
      setActive(0)
    }
  }

  const placeholder =
    workspaces.length === 0
      ? pending
        ? t('create.workspace.loading')
        : t('create.workspace.empty')
      : open
        ? t('create.workspace.search')
        : t('create.workspace.placeholder')

  return (
    <div className="tf-workspace-field">
      <div
        ref={root}
        className="tf-workspace-picker"
        data-state={value === '' ? 'placeholder' : 'selected'}
        data-open={open ? 'true' : undefined}
        data-invalid={invalid ? 'true' : undefined}
        data-disabled={disabled ? 'true' : undefined}
      >
        <input
          ref={inputRef}
          className="tf-workspace-input"
          type="text"
          role="combobox"
          value={open ? query : (selected?.title ?? '')}
          placeholder={placeholder}
          aria-label={t('create.workspace')}
          aria-required
          aria-invalid={invalid ? true : undefined}
          aria-describedby={describedBy}
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={open && activeIndex >= 0 ? optionId(activeIndex) : undefined}
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          onFocus={openList}
          onClick={() => {
            if (!open) openList()
          }}
          onChange={(event) => {
            setQuery(event.target.value)
            setActive(0)
            if (!open) setOpen(true)
          }}
          onKeyDown={onKeyDown}
        />
        <button
          className="tf-workspace-toggle"
          type="button"
          tabIndex={-1}
          aria-hidden="true"
          disabled={disabled}
          onClick={() => {
            if (open) close()
            else openList()
          }}
        >
          <Chevron />
        </button>
        {open ? (
          <ul className="tf-workspace-popup" id={listId} role="listbox" aria-label={t('create.workspace')}>
            {filtered.length === 0 ? (
              <li className="tf-workspace-empty">{t('create.workspace.noMatch')}</li>
            ) : (
              filtered.map((entry, index) => (
                <li
                  key={entry.id}
                  id={optionId(index)}
                  className="tf-workspace-option"
                  role="option"
                  aria-selected={entry.id === value}
                  data-active={index === activeIndex ? 'true' : undefined}
                  onMouseDown={(event) => {
                    event.preventDefault()
                    select(entry.id)
                  }}
                  onMouseMove={() => setActive(index)}
                >
                  <span className="tf-workspace-option-title">{entry.title}</span>
                  {entry.id === value ? (
                    <span className="tf-workspace-check" aria-hidden="true">
                      ✓
                    </span>
                  ) : null}
                </li>
              ))
            )}
          </ul>
        ) : null}
      </div>
      {quickPicks.length > 0 ? (
        <div className="tf-quick" role="group" aria-label={t('create.workspace.quick')}>
          <span className="tf-quick-title">{t('create.workspace.quick')}</span>
          <div className="tf-quick-list">
            {quickPicks.map((entry) => (
              <button
                key={entry.id}
                className="tf-quick-chip"
                type="button"
                disabled={disabled}
                data-active={entry.id === value ? 'true' : undefined}
                aria-pressed={entry.id === value}
                onClick={() => select(entry.id)}
              >
                {entry.title}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
