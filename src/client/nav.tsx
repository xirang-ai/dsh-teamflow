/**
 * The panel's own navigation bar: one Back control and the location trail.
 *
 * It sits above the scrolling area rather than inside it. A breadcrumb drawn
 * inside the surface scrolls away exactly when the user is deepest in a
 * document and most likely to reach for the browser's Back button — so the way
 * out disappears at the worst moment. Keeping the bar outside the scroller
 * makes it permanent without sticky positioning, and lets the document side
 * panel keep its own `top: 0` stickiness.
 *
 * The component stays a pure function of props: the page owns the view state
 * and passes callbacks, so the bar can be replayed like the rest of the panel.
 *
 * @module
 */
import type { ReactElement, RefObject } from 'react'

import type { TranslateFn } from './context.ts'
import { ChevronLeft, ChevronRight, HomeGlyph } from './icons.tsx'

/** One step of the trail. The final entry is the page being shown. */
export interface NavCrumb {
  readonly label: string
  /** Omitted for the current page and for levels that have no view of their own. */
  readonly onClick?: () => void
  /** Marks the panel root, rendered with the home glyph. */
  readonly home?: boolean
}

/** Props injected by the workbench page. */
export interface NavBarProps {
  readonly t: TranslateFn
  readonly crumbs: readonly NavCrumb[]
  /** Kind badge shown before the current title, e.g. "Outline design". */
  readonly currentKind?: string
  readonly onBack: () => void
  /** True while a form owns the view and must not be abandoned. */
  readonly backDisabled?: boolean
  /** Lets the page focus Back after the view changes. */
  readonly backRef?: RefObject<HTMLButtonElement>
}

/**
 * Render the panel navigation bar.
 * @param props - translator, trail, and the back capability.
 * @returns the navigation landmark.
 */
export function NavBar({
  t,
  crumbs,
  currentKind,
  onBack,
  backDisabled = false,
  backRef,
}: NavBarProps): ReactElement {
  return (
    <nav className="tf-navbar" aria-label={t('crumb.nav')}>
      <div className="tf-inner tf-nav-inner">
        <button
          ref={backRef}
          className="tf-back"
          type="button"
          onClick={onBack}
          disabled={backDisabled}
          title={t('crumb.backHint')}
          aria-keyshortcuts="Alt+ArrowLeft Meta+ArrowLeft"
        >
          <ChevronLeft />
          {t('crumb.back')}
        </button>
        <span className="tf-nav-rule" aria-hidden="true" />
        <ol className="tf-crumbs">
          {crumbs.map((crumb, index) => {
            const current = index === crumbs.length - 1
            return (
              <li key={`${index}:${crumb.label}`} className="tf-crumb-item">
                {index === 0 ? null : (
                  <span className="tf-crumb-sep" aria-hidden="true">
                    <ChevronRight />
                  </span>
                )}
                {current ? (
                  <span className="tf-crumb-current" aria-current="page" title={crumb.label}>
                    {currentKind === undefined ? null : (
                      <span className="tf-crumb-kind">{currentKind}</span>
                    )}
                    <span className="tf-crumb-text">{crumb.label}</span>
                  </span>
                ) : crumb.onClick === undefined ? (
                  <span className="tf-crumb-plain" title={crumb.label}>
                    {crumb.home === true ? <HomeGlyph /> : null}
                    <span className="tf-crumb-text">{crumb.label}</span>
                  </span>
                ) : (
                  <button
                    className="tf-crumb-link"
                    type="button"
                    onClick={crumb.onClick}
                    title={crumb.label}
                  >
                    {crumb.home === true ? <HomeGlyph /> : null}
                    <span className="tf-crumb-text">{crumb.label}</span>
                  </button>
                )}
              </li>
            )
          })}
        </ol>
      </div>
    </nav>
  )
}
