/**
 * Resolve the label a linked conversation is shown under.
 *
 * The workbench stores only the session id on a requirement link, run or bug.
 * The Host's session list owns the durable human-facing title, so every place
 * that used to print the id asks this helper instead. The id remains the last
 * resort: a session deleted from the list, or a Host that exposes no list, has
 * no title left to show.
 *
 * @module
 */
import type { SessionListLike, UseSessions } from './context.ts'
import { EMPTY_SESSION_LIST } from './context.ts'

/**
 * Stand-in for the Host's `useSessions` when a slot is rendered without it.
 *
 * The selector still runs so callers keep one unconditional hook-call shape;
 * there are simply no rows to read a title from.
 */
export const useEmptySessions: UseSessions = (selector) => selector(EMPTY_SESSION_LIST)

/**
 * Pick the conversation title for one session id.
 *
 * @param list - current Host session-list snapshot; `undefined` when the Host
 *   does not hand its standard `useSessions` hook to this slot.
 * @param sessionId - linked conversation id.
 * @returns the Host's human-facing title, or the id when no title is known.
 */
export function sessionDisplayTitle(
  list: SessionListLike | undefined,
  sessionId: string,
): string {
  const title = list?.byId[sessionId]?.displayTitle
  return title !== undefined && title.trim() !== '' ? title : sessionId
}
