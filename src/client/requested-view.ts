/**
 * The one-shot requests the workbench panel receives from outside itself.
 *
 * Two routes publish here, and both of them mean "the Host just selected this
 * panel", which is exactly why they share one store: a second mechanism would
 * let one route overwrite the other.
 *
 * - The conversation tab's 【在息壤工作台中打开】 exit names the record the panel
 *   should show.
 * - The sidebar entry's click asks for the clean list, whether the panel was
 *   showing a record or the same entry was already selected. The Host's own
 *   selection observable cannot report the second case: the layout store writes
 *   `activePanelId` through Immer, an unchanged value produces the same state
 *   object, and the store only notifies when that identity moves. The click
 *   itself is observed on the sidebar row instead (see `./icon.tsx`).
 *
 * The naming cannot travel as a plain value on a registration's `inject` face:
 * the Host resolves a root-scoped entry's `inject` once and caches the result
 * for that entry's whole lifetime, so a value read there can never change after
 * the panel's first mount. What it can carry is a bare observable in the
 * reserved `hooks` compartment (official slots.md, "Developer-provided
 * injection"), which the Host turns into a hook prop the component reads on
 * every change.
 *
 * The store is therefore the hand-off: a request is published, the panel acts
 * on it, then `consume` clears it so the request is one-shot and a later
 * remount does not replay a stale one.
 *
 * @module
 */
import type { DetailTarget } from './session-link.ts'

/**
 * One request to show a record.
 *
 * `seq` makes requests distinguishable by identity: clicking the same record
 * twice publishes two different snapshots, so the panel's effect runs again
 * instead of comparing two structurally equal targets.
 */
export interface RecordRequest {
  /** What the request asks for: one record. */
  readonly kind: 'record'
  /** Record the conversation tab is showing. */
  readonly target: DetailTarget
  /** Monotonic request counter, unique per store. */
  readonly seq: number
}

/** One request to come back to the clean list. */
export interface HomeRequest {
  /** What the request asks for: the list, with no record and no filter frame. */
  readonly kind: 'home'
  /** Monotonic request counter, shared with the record requests. */
  readonly seq: number
}

/** A pending request, or `null` when nothing is pending. */
export type PanelRequest = RecordRequest | HomeRequest

/** The observable the panel reads, converted by the Host into a hook prop. */
export interface RequestedViewStore {
  /** Current request, or `null` when nothing is pending. */
  getSnapshot(): PanelRequest | null
  /** Subscribe to changes; returns the unsubscribe function. */
  subscribe(listener: () => void): () => void
  /** Ask the panel to show `target`. */
  request(target: DetailTarget): void
  /** Ask the panel to return to the clean list. */
  requestHome(): void
  /** Clear the pending request once the panel has acted on it. */
  consume(): void
}

/**
 * The Host-converted hook: a selector over the store snapshot.
 *
 * Mirrors `UseSessions` in `./context.ts` — same selector + optional equality
 * shape, and the same reason for it: the component picks the slice it needs
 * and re-renders only when that slice changes.
 */
export type UseRequestedView = <Selected>(
  selector: (state: PanelRequest | null) => Selected,
  equal?: (left: Selected, right: Selected) => boolean,
) => Selected

/**
 * Create the hand-off store owned by one plugin load.
 * @returns store with a stable snapshot identity between changes.
 */
export function createRequestedViewStore(): RequestedViewStore {
  let current: PanelRequest | null = null
  let seq = 0
  const listeners = new Set<() => void>()

  // One place mutates the snapshot, so subscribers never see a value they were
  // not notified about and never get notified about a value that did not move.
  const publish = (next: PanelRequest | null): void => {
    if (next === current) return
    current = next
    for (const listener of [...listeners]) listener()
  }

  return {
    getSnapshot: () => current,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    request: (target) => {
      seq += 1
      // Copy so a caller mutating its own object cannot rewrite a published
      // snapshot behind the subscribers' back.
      publish({ kind: 'record', target: { ...target }, seq })
    },
    requestHome: () => {
      seq += 1
      publish({ kind: 'home', seq })
    },
    consume: () => publish(null),
  }
}

/**
 * Stand-in for the Host-provided `useRequestedView` when the slot renders
 * without it (a plain unit render, or a Host that hands no inject face).
 *
 * The selector still runs so callers keep one unconditional hook-call shape;
 * there is simply never a pending request.
 */
export const useEmptyRequestedView: UseRequestedView = (selector) => selector(null)
