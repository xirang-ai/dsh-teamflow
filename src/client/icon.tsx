/**
 * Sidebar glyph for the workbench panel.
 *
 * Drawn inline on the Host's 16×16 icon grid with `currentColor` strokes, so it
 * inherits the sidebar's active/inactive color and needs no icon package.
 *
 * The glyph also reports the click that selected (or re-selected) this entry.
 * The Host only publishes selection *changes*: its layout store writes
 * `activePanelId` through Immer, so writing the same id again produces the same
 * state object and no subscriber is notified. A click on the already-selected
 * row therefore has to be observed where the user made it — on the row button
 * that contains this glyph. The button is the Host's, but listening to it is a
 * read-only observation of our own entry (the glyph lives inside it), not a
 * change to the Host, and it covers the wide row's label as well as the glyph
 * because either child bubbles through the same button.
 *
 * @module
 */
import { useEffect, useRef } from 'react'
import type { ReactElement } from 'react'

/** Props the sidebar passes to every panel glyph. */
export interface WorkbenchIconProps {
  /** Rendered edge length; the sidebar uses 16 when wide, 18 when collapsed. */
  readonly size?: number
  /** Whether the panel is the selected one; the glyph only follows color. */
  readonly active?: boolean
  /**
   * Called whenever this entry is clicked, chosen again while already selected
   * included. Absent only in plain renders without an inject face.
   */
  readonly requestHome?: () => void
}

/**
 * Three connected nodes: the roles the workbench coordinates.
 * @param props - edge length from the sidebar, plus the click report.
 * @returns the glyph.
 */
export function WorkbenchIcon({ size = 16, requestHome }: WorkbenchIconProps): ReactElement {
  const glyph = useRef<SVGSVGElement>(null)
  // The click listener is bound once, so it reads the callback through a ref
  // instead of depending on a prop identity that may change between renders.
  const report = useRef(requestHome)
  useEffect(() => {
    report.current = requestHome
  }, [requestHome])

  useEffect(() => {
    const node = glyph.current
    if (node === null) return
    // The row button wraps the glyph and the label; fall back to the glyph
    // itself if a future Host stops wrapping it, so a click on the icon still
    // reaches the page.
    const target: Element = node.closest('button') ?? node
    const listener = (): void => {
      report.current?.()
    }
    target.addEventListener('click', listener)
    return () => {
      target.removeEventListener('click', listener)
    }
  }, [])

  return (
    <svg
      ref={glyph}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="8" cy="3.4" r="1.9" />
      <circle cx="3.6" cy="12.2" r="1.9" />
      <circle cx="12.4" cy="12.2" r="1.9" />
      <path d="M8 5.3v2.4M8 7.7H3.6v2.6M8 7.7h4.4v2.6" />
    </svg>
  )
}
