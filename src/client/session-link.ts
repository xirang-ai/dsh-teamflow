/**
 * The conversation-side 环节 mapping.
 *
 * A conversation is attached to at most one teamflow 环节: a requirement (and
 * the outline / detailed design discussions that work on its body and
 * documents), a development run working on a story, or a fix run working on a
 * defect. This module is the single place that turns that attachment into a
 * detail page, and it stays pure — snapshot in, decision out — so the Web and
 * desktop shells consume exactly the same table and the same rules.
 *
 * The table is keyed by the stored attachment kinds (`requirement_sessions.kind`
 * and `runs.kind`) rather than by page names, because that is what the database
 * and the wire actually carry. Adding a 环节 later means adding one row here;
 * a kind with no row falls through to the placeholder state instead of growing
 * a new branch.
 *
 * @module
 */
import type { WorkbenchSnapshot } from '../remote/contract.ts'

/** The workbench detail page a 环节 renders on. */
export type DetailPage = 'requirement' | 'story' | 'bug'

/**
 * One detail page the read-only tab can render.
 *
 * It is also the payload of a workbench deep link, so the exit keeps naming the
 * same target on both sides of the link.
 */
export type DetailTarget =
  | { readonly kind: 'requirement'; readonly id: string }
  | { readonly kind: 'story'; readonly id: string; readonly requirementId: string | null }
  | { readonly kind: 'bug'; readonly id: string }

/**
 * 环节 kind → detail page.
 *
 * - 需求（`create`）、概要设计（`design`）、详细设计（`detail`）和故事拆分
 *   （`split`）都挂在需求上，统一展示需求详情页：需求正文本身就是概要设计，
 *   详设与故事拆分也以该需求为上下文。
 * - 开发（`story_dev`）展示故事详情页。
 * - 缺陷修复（`bug_fix`）展示缺陷详情页。
 * - 从会话直接创建的条目没有 `requirement_sessions` / `runs` 行，来源会话
 *   存在记录行上（`stories.create_session_id` / `bugs.create_session_id`），
 *   这里用合成 kind（`story_create` / `bug_create`）走同一张表。
 *
 * `null` means the 环节 is known but has no detail page yet (placeholder
 * state); an unknown key is handled the same way.
 */
export const SESSION_TOPIC_PAGES: Readonly<Record<string, DetailPage | null>> = {
  create: 'requirement',
  design: 'requirement',
  detail: 'requirement',
  split: 'requirement',
  story_dev: 'story',
  story_create: 'story',
  bug_fix: 'bug',
  bug_create: 'bug',
}

/** One 环节 a conversation is attached to. */
export interface SessionTopic {
  /** Stored 环节 kind, for example `design` or `story_dev`. */
  readonly kind: string
  /** Detail page to render; `null` when the mapping table has no page yet. */
  readonly page: DetailPage | null
  /** Page subject; `null` when the kind has no page or its row is incomplete. */
  readonly target: DetailTarget | null
}

/** Look up the page of one stored 环节 kind. */
function pageOf(kind: string): DetailPage | null {
  return SESSION_TOPIC_PAGES[kind] ?? null
}

/**
 * Resolve the 环节 a conversation is attached to.
 *
 * Runs are checked first: a conversation that is executing a story or fixing a
 * defect is doing work, and that is the context the user wants to see even if
 * the same conversation also created a requirement earlier. Requirement links
 * come next; a conversation that only created a story or a defect resolves
 * through that row's origin column. `null` means the conversation is not
 * attached to any 环节 (empty state).
 *
 * @param snapshot - one frame of the workbench.
 * @param sessionId - conversation being viewed; `undefined` while none is bound.
 * @returns the attached 环节, or `null` when there is no link.
 */
export function resolveSessionTopic(
  snapshot: WorkbenchSnapshot,
  sessionId: string | undefined,
): SessionTopic | null {
  if (sessionId === undefined || sessionId === '') return null

  // `runs` arrive newest first, so the first match is the latest attempt.
  const run = snapshot.runs.find((entry) => entry.sessionId === sessionId)
  if (run !== undefined) {
    const page = pageOf(run.kind)
    if (page === 'story' && run.storyId !== null) {
      const story = snapshot.stories.find((entry) => entry.id === run.storyId)
      return {
        kind: run.kind,
        page,
        target: { kind: 'story', id: run.storyId, requirementId: story?.requirementId ?? null },
      }
    }
    if (page === 'bug' && run.bugId !== null) {
      return { kind: run.kind, page, target: { kind: 'bug', id: run.bugId } }
    }
    return { kind: run.kind, page, target: null }
  }

  // Requirement links arrive already filtered by the Host: a `create` row
  // records the conversation that produced the requirement, and discussion rows
  // only appear once the Agent confirmed them (`linked_at` is set). A discussion
  // still waiting for that confirmation is therefore reported as "no link" and
  // shows the empty state instead of a page the Agent has not admitted to.
  const link = snapshot.requirementSessions.find((entry) => entry.sessionId === sessionId)
  if (link !== undefined) {
    const page = pageOf(link.kind)
    return {
      kind: link.kind,
      page,
      target: page === 'requirement' ? { kind: 'requirement', id: link.requirementId } : null,
    }
  }

  // A story or defect created straight from a conversation records that
  // conversation on the row itself: there is no separate link table, and the
  // Host already filtered out rows without an origin. Checking stories first
  // keeps the same precedence the requirement link has over runs — the record
  // that owns the origin is the page the user wants.
  const createdStory = snapshot.stories.find((entry) => entry.createSessionId === sessionId)
  if (createdStory !== undefined) {
    return {
      kind: 'story_create',
      page: 'story',
      target: { kind: 'story', id: createdStory.id, requirementId: createdStory.requirementId },
    }
  }
  const createdBug = snapshot.bugs.find((entry) => entry.createSessionId === sessionId)
  if (createdBug !== undefined) {
    return { kind: 'bug_create', page: 'bug', target: { kind: 'bug', id: createdBug.id } }
  }

  return null
}

/** What the conversation tab shows, decided from one snapshot read. */
export type SessionTabView =
  | { readonly kind: 'empty' }
  | { readonly kind: 'placeholder'; readonly topicKind: string }
  | { readonly kind: 'missing' }
  | { readonly kind: 'detail'; readonly target: DetailTarget }

/**
 * Decide the tab's state: empty (no link), placeholder (a 环节 without a detail
 * page), missing (linked, but the record is not in the frame) or detail.
 *
 * The record lookup is what separates a deleted work item from a stalled read:
 * the link still names it, the frame no longer has it.
 *
 * @param snapshot - one frame of the workbench.
 * @param sessionId - conversation being viewed.
 * @returns the state to render.
 */
export function resolveSessionTab(
  snapshot: WorkbenchSnapshot,
  sessionId: string | undefined,
): SessionTabView {
  const topic = resolveSessionTopic(snapshot, sessionId)
  if (topic === null) return { kind: 'empty' }
  if (topic.page === null) return { kind: 'placeholder', topicKind: topic.kind }
  const target = topic.target
  if (target === null) return { kind: 'missing' }
  if (target.kind === 'requirement') {
    const found = snapshot.requirements.some((entry) => entry.id === target.id)
    return found ? { kind: 'detail', target } : { kind: 'missing' }
  }
  if (target.kind === 'story') {
    const found = snapshot.stories.some((entry) => entry.id === target.id)
    return found ? { kind: 'detail', target } : { kind: 'missing' }
  }
  const found = snapshot.bugs.some((entry) => entry.id === target.id)
  return found ? { kind: 'detail', target } : { kind: 'missing' }
}
