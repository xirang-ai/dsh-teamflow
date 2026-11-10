/**
 * The split "执行" control: main button plus a tier menu.
 *
 * Every entry point that starts a run renders this one component, so the three
 * buttons cannot drift apart in label, behaviour or accessibility. The
 * component owns exactly one piece of judgment — which tier the menu is
 * pointing at — and it never remembers that past a successful start: the main
 * button always starts {@link DEFAULT_PERMISSION_TIER}, and the menu always
 * opens on it unless a failed attempt kept a different choice for the retry.
 *
 * @module
 */
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, ReactElement, ReactNode } from 'react'

import {
  DEFAULT_PERMISSION_TIER,
  PERMISSION_TIERS,
  permissionTierDefinition,
  type PermissionTier,
} from '../permission-tier.ts'
import type { TranslateFn } from './context.ts'

/** How one attempted start ended, in terms the control can show in place. */
export type RunStartOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string }

/** Props of {@link RunTierControl}. */
export interface RunTierControlProps {
  readonly t: TranslateFn
  /** Main button text; entry points pass the action label they used before. */
  readonly label: string
  readonly icon?: ReactNode
  readonly tone?: 'primary' | 'soft' | 'live' | 'ghost'
  /** Extra disabling from the page (read-only surfaces, busy parents). */
  readonly disabled?: boolean
  /**
   * Start (or retry) with one tier. Resolves when the attempt settled; a
   * rejection is shown like a failure result.
   */
  readonly onStart: (tier: PermissionTier) => Promise<RunStartOutcome>
}

/** Repeatable per-control id prefix for the menu wiring. */
function useControlId(): string {
  return `tf-tier-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
}

/**
 * The unified run entry: 「执行」 with a separated arrow that opens the menu.
 * @param props - labels, state from the page, and the start callback.
 * @returns the split button, its menu and an in-place failure line.
 */
export function RunTierControl({
  t,
  label,
  icon,
  tone = 'soft',
  disabled = false,
  onStart,
}: RunTierControlProps): ReactElement {
  const id = useControlId()
  const [open, setOpen] = useState(false)
  const [starting, setStarting] = useState(false)
  /** Tier the menu points at; `normal` unless a failed attempt kept another. */
  const [selected, setSelected] = useState<PermissionTier>(DEFAULT_PERMISSION_TIER)
  const [highlight, setHighlight] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [placement, setPlacement] = useState<'down' | 'up'>('down')

  const rootRef = useRef<HTMLDivElement | null>(null)
  const mainRef = useRef<HTMLButtonElement | null>(null)
  const arrowRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)

  const busy = starting
  const locked = busy || disabled

  const start = useCallback(
    async (tier: PermissionTier) => {
      // One start per settle: the button and the menu share this guard, so a
      // second click cannot create a second conversation.
      if (starting || disabled) return
      setOpen(false)
      setError(null)
      setStarting(true)
      try {
        const outcome = await onStart(tier)
        if (outcome.ok) {
          // A finished attempt leaves no remembered choice behind.
          setSelected(DEFAULT_PERMISSION_TIER)
          setHighlight(0)
        } else {
          setSelected(tier)
          setError(outcome.message)
        }
      } catch (failure) {
        setSelected(tier)
        setError(failure instanceof Error ? failure.message : String(failure))
      } finally {
        setStarting(false)
      }
    },
    [disabled, onStart, starting],
  )

  /** Open the menu near the control, flipping up when the viewport is short. */
  const showMenu = useCallback(() => {
    if (locked) return
    const root = rootRef.current
    if (root !== null && typeof window !== 'undefined') {
      const rect = root.getBoundingClientRect()
      const needed = 10 + PERMISSION_TIERS.length * 52
      setPlacement(window.innerHeight - rect.bottom < needed && rect.top > needed ? 'up' : 'down')
    }
    setHighlight(Math.max(0, PERMISSION_TIERS.indexOf(selected)))
    setOpen(true)
  }, [locked, selected])

  /** Close and put focus back on the main button (never on `body`). */
  const close = useCallback(() => {
    setOpen(false)
    mainRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!open) return undefined
    menuRef.current?.focus()
    const onPointerDown = (event: MouseEvent): void => {
      const root = rootRef.current
      if (root === null) return
      if (event.target instanceof Node && !root.contains(event.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open])

  const onMenuKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        const step = event.key === 'ArrowDown' ? 1 : -1
        setHighlight((current) => (current + step + PERMISSION_TIERS.length) % PERMISSION_TIERS.length)
        return
      }
      if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault()
        setHighlight(event.key === 'Home' ? 0 : PERMISSION_TIERS.length - 1)
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        close()
        return
      }
      if (event.key === 'Tab') {
        // Let the browser move focus on; just drop the menu first.
        setOpen(false)
        return
      }
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        const tier = PERMISSION_TIERS[highlight]
        if (tier !== undefined) void start(tier)
      }
    },
    [close, highlight, start],
  )

  const onArrowKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLButtonElement>) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowRight' || event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        event.stopPropagation()
        showMenu()
      }
    },
    [showMenu],
  )

  const mainLabel = busy ? t('run.starting') : label
  const activeTier = PERMISSION_TIERS[highlight] ?? DEFAULT_PERMISSION_TIER

  return (
    <div className="tf-tier" ref={rootRef} data-tone={tone} data-open={open ? 'true' : 'false'}>
      <div className="tf-tier-split">
        <button
          ref={mainRef}
          className="tf-btn tf-tier-main"
          data-tone={tone}
          type="button"
          disabled={locked}
          aria-haspopup="menu"
          aria-busy={busy ? 'true' : undefined}
          onClick={() => void start(DEFAULT_PERMISSION_TIER)}
          onKeyDown={(event) => {
            // The row around this button is clickable; a key here is ours.
            event.stopPropagation()
          }}
        >
          {icon}
          {mainLabel}
        </button>
        <span className="tf-tier-divider" aria-hidden="true" />
        <button
          ref={arrowRef}
          className="tf-btn tf-tier-arrow"
          data-tone={tone}
          type="button"
          disabled={locked}
          aria-label={t('run.tierMenu')}
          aria-haspopup="menu"
          aria-expanded={open ? 'true' : 'false'}
          aria-controls={`${id}-menu`}
          onClick={(event) => {
            event.stopPropagation()
            if (open) setOpen(false)
            else showMenu()
          }}
          onKeyDown={(event) => {
            event.stopPropagation()
            onArrowKeyDown(event)
          }}
        >
          <ChevronDown />
        </button>
      </div>
      {open ? (
        <div
          id={`${id}-menu`}
          ref={menuRef}
          className="tf-tier-menu"
          data-placement={placement}
          role="menu"
          tabIndex={-1}
          aria-label={t('run.tierMenu')}
          aria-activedescendant={`${id}-item-${activeTier}`}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={onMenuKeyDown}
        >
          {PERMISSION_TIERS.map((tier, index) => {
            const definition = permissionTierDefinition(tier)
            const name = t(definition.nameKey)
            return (
              <button
                key={tier}
                id={`${id}-item-${tier}`}
                className="tf-tier-item"
                data-highlight={index === highlight ? 'true' : 'false'}
                data-selected={tier === selected ? 'true' : 'false'}
                type="button"
                role="menuitem"
                tabIndex={-1}
                aria-describedby={`${id}-desc-${tier}`}
                aria-checked={tier === selected ? 'true' : 'false'}
                onMouseEnter={() => setHighlight(index)}
                onClick={(event) => {
                  event.stopPropagation()
                  void start(tier)
                }}
              >
                <span className="tf-tier-check" aria-hidden="true">
                  {tier === selected ? '✓' : ''}
                </span>
                <span className="tf-tier-text">
                  <span className="tf-tier-name">{name}</span>
                  <span className="tf-tier-desc" id={`${id}-desc-${tier}`}>
                    {t(definition.descriptionKey)}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      ) : null}
      {error === null ? null : (
        <div className="tf-tier-error" role="alert">
          {error}
        </div>
      )}
    </div>
  )
}

/** Menu arrow glyph; rotated by CSS while the menu is open. */
function ChevronDown(): ReactElement {
  return (
    <svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
