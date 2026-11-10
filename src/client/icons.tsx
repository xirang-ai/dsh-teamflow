/**
 * Glyphs used by the workbench panel.
 *
 * Inline 16×16 SVGs on `currentColor`, matching the sidebar glyph: the panel
 * ships no icon dependency and every icon inherits its surrounding text color.
 *
 * @module
 */
import type { ReactElement, ReactNode, SVGProps } from 'react'

type GlyphProps = SVGProps<SVGSVGElement>

/** Shared frame so each glyph only declares its paths. */
function Glyph({ children, ...rest }: GlyphProps & { children: ReactNode }): ReactElement {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  )
}

/** Right-hand chevron for "open this". */
export function ChevronRight(props: GlyphProps): ReactElement {
  return (
    <Glyph {...props}>
      <path d="M6 3.5 10.5 8 6 12.5" />
    </Glyph>
  )
}

/** Left-hand chevron for "go back". */
export function ChevronLeft(props: GlyphProps): ReactElement {
  return (
    <Glyph {...props}>
      <path d="M10 3.5 5.5 8 10 12.5" />
    </Glyph>
  )
}

/** House: the panel root in the breadcrumb trail. */
export function HomeGlyph(props: GlyphProps): ReactElement {
  return (
    <Glyph {...props}>
      <path d="M2.8 7.3 8 3.1l5.2 4.2" />
      <path d="M4.4 6.3v6.2h7.2V6.3" />
      <path d="M6.7 12.5V9.3h2.6v3.2" />
    </Glyph>
  )
}

/** Conversation bubble: open the linked session. */
export function ChatGlyph(props: GlyphProps): ReactElement {
  return (
    <Glyph {...props}>
      <path d="M13 8.4c0 2.3-2.2 4.1-5 4.1-.6 0-1.2-.1-1.7-.2L3.4 13.3l.6-2.2A3.9 3.9 0 0 1 3 8.4C3 6.1 5.2 4.3 8 4.3s5 1.8 5 4.1Z" />
    </Glyph>
  )
}

/** Play triangle: start a run. */
export function PlayGlyph(props: GlyphProps): ReactElement {
  return (
    <Glyph {...props}>
      <path d="M5.5 3.8 12 8l-6.5 4.2z" fill="currentColor" stroke="none" />
    </Glyph>
  )
}

/** Clock: a finished run in history. */
export function HistoryGlyph(props: GlyphProps): ReactElement {
  return (
    <Glyph {...props}>
      <circle cx="8" cy="8" r="5.3" />
      <path d="M8 5.2V8l2 1.3" />
    </Glyph>
  )
}

/** Stacked rows: choose a child story. */
export function ListGlyph(props: GlyphProps): ReactElement {
  return (
    <Glyph {...props}>
      <path d="M3 5h10M3 8h10M3 11h6" />
    </Glyph>
  )
}

/** Folder outline for the design file tree. */
export function FolderGlyph(props: GlyphProps): ReactElement {
  return (
    <Glyph {...props}>
      <path d="M2.6 4.6h4l1.3 1.5h5.5v5.6a.8.8 0 0 1-.8.8H3.4a.8.8 0 0 1-.8-.8z" />
    </Glyph>
  )
}

/** Document outline for one markdown file. */
export function FileGlyph(props: GlyphProps): ReactElement {
  return (
    <Glyph {...props}>
      <path d="M4 2.8h5l3 3v7.4H4z" />
      <path d="M9 2.8v3h3M6 8h4M6 10.2h3" />
    </Glyph>
  )
}

/** Info dot used by the toast. */
export function InfoGlyph(props: GlyphProps): ReactElement {
  return (
    <Glyph {...props}>
      <circle cx="8" cy="8" r="5.6" />
      <path d="M8 7.2v3.4M8 5.4v.2" />
    </Glyph>
  )
}

/** Triangle used by the failure dialog. */
export function AlertGlyph(props: GlyphProps): ReactElement {
  return (
    <Glyph {...props}>
      <path d="M8 3.3 13.2 12H2.8z" />
      <path d="M8 6.6v2.6M8 10.8v.2" />
    </Glyph>
  )
}

/** Refresh arrow. */
export function RefreshGlyph(props: GlyphProps): ReactElement {
  return (
    <Glyph {...props}>
      <path d="M12.4 6.2A4.6 4.6 0 1 0 12.4 10" />
      <path d="M12.7 3.4v3H9.7" />
    </Glyph>
  )
}

/** Plus sign: create a new work item. */
export function PlusGlyph(props: GlyphProps): ReactElement {
  return (
    <Glyph {...props}>
      <path d="M8 3.5v9M3.5 8h9" />
    </Glyph>
  )
}

/** Trash can: remove a record for good. */
export function TrashGlyph(props: GlyphProps): ReactElement {
  return (
    <Glyph {...props}>
      <path d="M3.2 4.8h9.6M6.4 4.8V3.6h3.2v1.2M5 4.8l.5 7.4h5l.5-7.4M6.9 7v3M9.1 7v3" />
    </Glyph>
  )
}
