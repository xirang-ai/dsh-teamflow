/**
 * Which workspaces the Create page offers as quick picks.
 *
 * The page never pre-selects a workspace (creating in the wrong one is
 * expensive), but repeating the previous workspace is the common case, so it
 * keeps a short list of the ones the user picked most recently and shows them
 * under the field for one click. Only ids are stored: the titles are read from
 * the Host list on every render, so a rename or a deleted workspace cannot leak
 * a stale label, and a workspace that disappeared simply drops out.
 *
 * `localStorage` is a hint, never the source of truth: an unavailable or
 * malformed value falls back to the Host list order, and the quick picks are
 * never used to choose a workspace on the user's behalf.
 *
 * @module
 */
import type { WorkspaceOption } from './context.ts'

/** How many quick picks the Create page shows. */
export const QUICK_LIMIT = 5

/** How many ids are remembered between visits (a few extra for deletions). */
export const RECENT_LIMIT = 10

/** Storage key of the remembered ids. */
const STORAGE_KEY = 'teamflow.recent-workspaces'

/** Narrow untrusted storage content to a deduplicated list of ids. */
export function parseRecent(raw: string | null): readonly string[] {
  if (raw === null || raw === '') return []
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(value)) return []
  const ids: string[] = []
  for (const entry of value) {
    if (typeof entry !== 'string' || entry.length === 0 || ids.includes(entry)) continue
    ids.push(entry)
    if (ids.length === RECENT_LIMIT) break
  }
  return ids
}

/** Put one id in front, dropping its earlier position and trimming the tail. */
export function withRecent(recent: readonly string[], id: string): readonly string[] {
  if (id.length === 0) return recent
  return [id, ...recent.filter((entry) => entry !== id)].slice(0, RECENT_LIMIT)
}

/** Read the remembered ids; storage can be unavailable or hold junk. */
export function readRecentWorkspaces(): readonly string[] {
  try {
    if (typeof localStorage === 'undefined') return []
    return parseRecent(localStorage.getItem(STORAGE_KEY))
  } catch {
    return []
  }
}

/** Write the remembered ids; storage can be unavailable or full. */
export function writeRecentWorkspaces(recent: readonly string[]): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, JSON.stringify(recent))
  } catch {
    // Storage can be unavailable (private mode, quota); the quick picks are optional.
  }
}

/** Remember one pick and return the new list. */
export function rememberWorkspace(id: string, recent: readonly string[]): readonly string[] {
  const next = withRecent(recent, id)
  writeRecentWorkspaces(next)
  return next
}

/**
 * Drop remembered ids the Host list no longer has.
 *
 * The caller must only pass a list the Host has confirmed (`phase: 'ready'`):
 * an empty list that is merely still loading would wipe every remembered id.
 * Returns the same array when nothing changed, so an effect can compare
 * identity instead of deep-equality and skip a needless write.
 */
export function pruneRecent(
  recent: readonly string[],
  workspaces: readonly WorkspaceOption[],
): readonly string[] {
  const existing = new Set(workspaces.map((entry) => entry.id))
  const kept = recent.filter((id) => existing.has(id))
  return kept.length === recent.length ? recent : kept
}

/**
 * Order the quick picks: recently chosen workspaces first, then the Host list
 * order fills the rest, so the row is never empty while workspaces exist.
 */
export function orderQuickPicks(
  workspaces: readonly WorkspaceOption[],
  recent: readonly string[],
  limit: number = QUICK_LIMIT,
): readonly WorkspaceOption[] {
  const byId = new Map(workspaces.map((entry) => [entry.id, entry]))
  const picked: WorkspaceOption[] = []
  for (const id of recent) {
    const hit = byId.get(id)
    if (hit === undefined) continue
    if (picked.some((item) => item.id === hit.id)) continue
    picked.push(hit)
    if (picked.length === limit) return picked
  }
  for (const entry of workspaces) {
    if (picked.length === limit) break
    if (picked.some((item) => item.id === entry.id)) continue
    picked.push(entry)
  }
  return picked
}

/** Keep the workspaces whose title contains the typed text, ignoring case. */
export function filterWorkspaces(
  workspaces: readonly WorkspaceOption[],
  query: string,
): readonly WorkspaceOption[] {
  const needle = query.trim().toLowerCase()
  if (needle.length === 0) return workspaces
  return workspaces.filter((entry) => entry.title.toLowerCase().includes(needle))
}
