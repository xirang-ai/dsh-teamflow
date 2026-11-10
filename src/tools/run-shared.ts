/**
 * Shared lookup for the run lifecycle tools.
 *
 * The Agent knows the story or defect id from its prompt, not the run id, so
 * every tool resolves the active run from that subject. A run belongs to
 * exactly one subject (a story development or a defect fix), and the tools
 * accept exactly one of `story` / `bug`; keeping the lookup here means all
 * failure modes read the same way to the model.
 *
 * @module
 */
import { ACTIVE_RUN_STATUSES } from '../store/model.ts'
import type { Bug, Run, Story } from '../store/model.ts'
import type { WorkflowStore } from '../store/workflow.ts'

/** The subject a run belongs to, resolved from the tool arguments. */
export type RunSubject =
  | { readonly kind: 'story'; readonly story: Story }
  | { readonly kind: 'bug'; readonly bug: Bug }

/** Human label used in error messages and rendered results. */
export function subjectLabel(kind: 'story' | 'bug'): string {
  return kind === 'story' ? '故事' : '缺陷'
}

/** Resolve a story by id, rejecting an empty or unknown id with context. */
export function requireStory(workflow: WorkflowStore, raw: string): Story {
  const id = raw.trim()
  if (id.length === 0) throw new Error('teamflow: 故事参数不能为空，请传故事编号（形如 sty_xxx）。')
  const story = workflow.getStory(id)
  if (story === null) throw new Error(`teamflow: 找不到故事 ${id}，请核对编号。`)
  return story
}

/** Resolve a defect by id, rejecting an empty or unknown id with context. */
export function requireBug(workflow: WorkflowStore, raw: string): Bug {
  const id = raw.trim()
  if (id.length === 0) throw new Error('teamflow: 缺陷参数不能为空，请传缺陷编号（形如 bug_xxx）。')
  const bug = workflow.getBug(id)
  if (bug === null) throw new Error(`teamflow: 找不到缺陷 ${id}，请核对编号。`)
  return bug
}

/**
 * Resolve the subject named by `story` or `bug`.
 *
 * Exactly one id must be present. A stale prompt or a manually edited call that
 * passes both is rejected instead of silently preferring one.
 */
export function resolveSubject(
  workflow: WorkflowStore,
  args: { readonly story?: string; readonly bug?: string },
): RunSubject {
  const story = args.story?.trim() ?? ''
  const bug = args.bug?.trim() ?? ''
  if (story.length > 0 && bug.length > 0) {
    throw new Error('teamflow: story 与 bug 只能传一个，请按研发提示只传当前对象。')
  }
  if (story.length > 0) return { kind: 'story', story: requireStory(workflow, story) }
  if (bug.length > 0) return { kind: 'bug', bug: requireBug(workflow, bug) }
  throw new Error('teamflow: 请传 story 或 bug 之一，编号来自研发提示。')
}

/** Find the run that is still running or self-testing for one subject. */
export function activeRunFor(workflow: WorkflowStore, subject: RunSubject): Run {
  const filter =
    subject.kind === 'story' ? { storyId: subject.story.id } : { bugId: subject.bug.id }
  const active = workflow
    .listRuns(filter)
    .find((run) => (ACTIVE_RUN_STATUSES as readonly string[]).includes(run.status))
  if (active !== undefined) return active
  const id = subject.kind === 'story' ? subject.story.id : subject.bug.id
  const retry = subject.kind === 'story' ? '重新点击「开始研发」' : '重新点击「开始修复」'
  throw new Error(
    `teamflow: ${subjectLabel(subject.kind)} ${id} 当前没有进行中的运行。不要新建对象；请让用户在息壤工作台${retry}。`,
  )
}

/** Current status of the subject after a transition. */
export function subjectStatus(workflow: WorkflowStore, subject: RunSubject): string {
  return subject.kind === 'story'
    ? (workflow.getStory(subject.story.id)?.status ?? 'ready')
    : (workflow.getBug(subject.bug.id)?.status ?? 'reported')
}

/** Stable id of the subject, independent of its kind. */
export function subjectId(subject: RunSubject): string {
  return subject.kind === 'story' ? subject.story.id : subject.bug.id
}
