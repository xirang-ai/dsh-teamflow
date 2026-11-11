/**
 * View models for the workbench panel.
 *
 * The Host speaks in rows (`WorkbenchSnapshot`); the panel thinks in trees: a
 * requirement owns its detailed-design documents, stories and runs, a defect
 * owns runs. This module is the single place that translation happens, and it
 * stays pure — same snapshot in, same tree out — so the panel can be unit
 * tested without a browser, a clock or a database.
 *
 * @module
 */
import type { WorkbenchSnapshot } from '../remote/contract.ts'
import type {
  BugSeverity,
  BugStatus,
  DocKind,
  RequirementStatus,
  RunStatus,
  StorySize,
  StoryStatus,
} from '../store/model.ts'

/**
 * Compact local instant for row metadata.
 *
 * The wire carries ISO-8601 UTC; a row shows the reader's wall clock instead.
 * Values that do not parse pass through unchanged, so a malformed row is
 * visible rather than blank.
 */
export function formatWhen(iso: string): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return iso
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`
}

/** Where a unit of work sits from the panel's point of view. */
export type NodeState = 'running' | 'ready' | 'done'

/** One detailed-design document, metadata only until the reader loads its body. */
export interface DetailDoc {
  readonly id: string
  readonly title: string
  readonly kind: DocKind
  readonly updatedAt: string
  /** Workspace-relative markdown path, used by the file tree and link jumps. */
  readonly path: string
  readonly storyIds: readonly string[]
}

/** One run, flattened for both the requirement tree and the defect surface. */
export interface RunNode {
  readonly id: string
  /** story or defect this run worked on, whichever exists. */
  readonly subjectId: string
  readonly subjectTitle: string
  readonly status: RunStatus
  readonly branch: string
  /** ISO timestamp the run was created. */
  readonly at: string
  readonly sessionId?: string
}

/** One story as the tree shows it. */
export interface StoryNode {
  readonly id: string
  readonly title: string
  /** Workspace that owns the story; a story always lives somewhere. */
  readonly workspaceId: string
  readonly state: NodeState
  readonly status: StoryStatus
  readonly size: StorySize
  readonly updatedAt: string
  /** Workspace-relative markdown path, used to resolve links to this story. */
  readonly path: string
  /** Detailed-design document covering this story, when one links it. */
  readonly docId?: string
  /** Latest development run's conversation. */
  readonly sessionId?: string
  /** Conversation that created the story, when the Host recorded one. */
  readonly createSessionId?: string
  /** Full `story.md` markdown, rendered as-is by the story surface. */
  readonly body: string
  /** Body paragraph extracted from the story markdown. */
  readonly description: string
  readonly acceptance: readonly string[]
  /** True when story.md does not exist; an empty file is `false`. */
  readonly bodyMissing: boolean
  readonly lastRun?: { readonly status: RunStatus; readonly at: string }
  /** Every run for this story, newest first. */
  readonly runs: readonly RunNode[]
  /** Confirmed discussions of this story, newest first. */
  readonly sessions: readonly DiscussionSessionNode[]
}

/** One defect as the list and its surface show it. */
export interface BugNode {
  readonly id: string
  readonly title: string
  readonly severity: BugSeverity
  readonly status: BugStatus
  readonly state: NodeState
  readonly workspaceId: string
  readonly content: readonly string[]
  /** True when bug.md does not exist; an empty file is `false`. */
  readonly bodyMissing: boolean
  readonly updatedAt: string
  /** Latest fix run's conversation. */
  readonly sessionId?: string
  /** Conversation that created the defect, when the Host recorded one. */
  readonly createSessionId?: string
  readonly runs: readonly RunNode[]
  /** Confirmed discussions of this defect, newest first. */
  readonly sessions: readonly DiscussionSessionNode[]
}

/**
 * One conversation attached to a requirement, story or defect.
 *
 * `create` rows record the conversation that produced the requirement;
 * `design`, `detail` and `split` rows are requirement discussions, and
 * `discuss` rows are story or defect discussions. All of them appear only once
 * the Agent has confirmed the browser-prepared binding.
 */
export interface DiscussionSessionNode {
  readonly sessionId: string
  /** `create` / `design` / `detail` / `split` for requirements, `discuss` otherwise. */
  readonly kind: string
  /** ISO timestamp worth showing: linking time for discussions, creation for create rows. */
  readonly at: string
}

/**
 * One requirement with everything it owns.
 *
 * There is no separate outline-design node: the requirement *is* the outline,
 * and the surface shows its body, its detailed-design documents and its
 * stories together.
 */
export interface RequirementNode {
  readonly kind: 'requirement'
  readonly id: string
  readonly workspaceId: string
  readonly title: string
  readonly summary: string
  readonly status: RequirementStatus
  readonly state: NodeState
  readonly updatedAt: string
  /** Workspace-relative path of requirement.md, the shared root of the document tree. */
  readonly path: string
  readonly content: readonly string[]
  /** True when requirement.md does not exist; an empty file is `false`. */
  readonly bodyMissing: boolean
  /** ISO timestamp the requirement was completed, when it has been. */
  readonly completedAt: string | null
  /** Session of the most recent confirmed design discussion. */
  readonly sessionId?: string
  readonly branch?: string
  readonly docs: readonly DetailDoc[]
  readonly stories: readonly StoryNode[]
  readonly runs: readonly RunNode[]
  /** Sessions attached to this requirement, newest first. */
  readonly sessions: readonly DiscussionSessionNode[]
}

/** A story with no requirement parent, listed next to the requirements. */
export interface StandaloneStory {
  readonly kind: 'story'
  readonly id: string
  readonly workspaceId: string
  readonly story: StoryNode
}

/** Anything the default list can show. */
export type ListItem = RequirementNode | StandaloneStory

/**
 * The whole panel, in the order the Host returned.
 *
 * One exception: a requirement's documents and stories are re-ordered by their
 * explicit `sortOrder` (see {@link compareSortOrder}), because that order is a
 * product decision stored with the row, while the rest of the panel keeps the
 * Host's running-first order.
 */
export interface Board {
  readonly requirements: readonly RequirementNode[]
  readonly standalone: readonly StandaloneStory[]
  readonly bugs: readonly BugNode[]
}

/** Wire sessions → panel rows, newest first as the Host returned them. */
function discussionNodes(
  sessions: readonly {
    readonly sessionId: string
    readonly kind: string
    readonly preparedAt: string | null
    readonly linkedAt: string | null
    readonly createdAt: string
  }[],
): readonly DiscussionSessionNode[] {
  return sessions.map((session) => ({
    sessionId: session.sessionId,
    kind: session.kind,
    at: session.linkedAt ?? session.preparedAt ?? session.createdAt,
  }))
}

/** Empty board, used before the first frame arrives and after a failure. */
export const EMPTY_BOARD: Board = { requirements: [], standalone: [], bugs: [] }

const STORY_RUNNING: readonly StoryStatus[] = ['developing', 'self_testing']
const STORY_DONE: readonly StoryStatus[] = ['done', 'completed', 'cancelled']

/** A completed or archived requirement is done; children refine this. */
export function requirementState(status: RequirementStatus): NodeState {
  return status === 'completed' || status === 'archived' ? 'done' : 'ready'
}

/**
 * Lanes the unstarted list is split into.
 *
 * Running work comes first, then ready work that is waiting to start, then
 * requirements still being talked through. Defects are rendered as their own
 * lane above all three because they are the most urgent thing on the board.
 */
export type ListLane = 'running' | 'ready' | 'discussing' | 'done'

/** Display order of the lanes, independent of defects. */
export const LANE_ORDER: readonly ListLane[] = ['running', 'ready', 'discussing', 'done']

/** Statuses whose requirement is still being discussed. Only `draft` is open. */
const REQUIREMENT_DISCUSSING: readonly RequirementStatus[] = ['draft']

/**
 * Which lane a requirement belongs to when none of its stories is running.
 *
 * A draft requirement is still being talked through — possibly with stories
 * already split out of it. A completed or archived one is done.
 */
export function requirementLane(status: RequirementStatus): ListLane {
  if (status === 'completed' || status === 'archived') return 'done'
  return REQUIREMENT_DISCUSSING.includes(status) ? 'discussing' : 'ready'
}

/** Map one story status onto the three states the list filters by. */
export function storyState(status: StoryStatus): NodeState {
  if (STORY_RUNNING.includes(status)) return 'running'
  if (STORY_DONE.includes(status)) return 'done'
  return 'ready'
}

/**
 * Map one defect status onto the same three states.
 *
 * `fixed` stays `ready`: the code is done but the user has not confirmed the
 * problem is solved, so it is still work the team owes.
 */
export function bugState(status: BugStatus): NodeState {
  if (status === 'fixing') return 'running'
  if (status === 'completed' || status === 'wontfix') return 'done'
  return 'ready'
}

/** A run is still moving while it is `running` or `self_testing`. */
export function runState(status: RunStatus): NodeState {
  return status === 'running' || status === 'self_testing' ? 'running' : 'done'
}

/** The fields the detail lists order by; both snapshot rows carry them. */
export interface SortOrderedRow {
  readonly id: string
  readonly sortOrder: number
  readonly createdAt: string
}

/**
 * Total order for one requirement's documents or stories.
 *
 * The explicit position wins; equal or missing positions fall back to creation
 * time and then the id, so two rows never swap places between refreshes.
 */
export function compareSortOrder(left: SortOrderedRow, right: SortOrderedRow): number {
  if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder
  if (left.createdAt !== right.createdAt) return left.createdAt < right.createdAt ? -1 : 1
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0
}

/** Sort one requirement's list in place by {@link compareSortOrder}. */
function sortByExplicitOrder<T extends { readonly id: string }>(
  list: T[],
  rows: ReadonlyMap<string, SortOrderedRow>,
): void {
  list.sort((left, right) => {
    const leftRow = rows.get(left.id)
    const rightRow = rows.get(right.id)
    if (leftRow === undefined || rightRow === undefined) return 0
    return compareSortOrder(leftRow, rightRow)
  })
}

/**
 * Split a markdown body into display lines.
 *
 * Blank lines are dropped: the reader renders every remaining line as one block,
 * so keeping them would add empty paragraphs without carrying any structure.
 */
function lines(body: string): readonly string[] {
  return body
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
}

/** Match a heading that starts the acceptance section of a story body. */
const ACCEPTANCE_HEADING = /^#{1,6}\s*(?:验收标准|acceptance criteria|acceptance)\s*$/i
/** Match one list item, ordered or bulleted, in that section. */
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/

/**
 * Split a story body into its prose and its acceptance list.
 *
 * The body is written by the product role as free markdown, so the reader is
 * forgiving: everything before the acceptance heading is the description, and
 * every list item after it is one criterion. A body without the heading keeps
 * its list items as criteria and shows the rest as description.
 */
export function parseStoryBody(body: string): { description: string; acceptance: readonly string[] } {
  const description: string[] = []
  const acceptance: string[] = []
  let inAcceptance = false
  for (const line of lines(body)) {
    if (ACCEPTANCE_HEADING.test(line)) {
      inAcceptance = true
      continue
    }
    const item = LIST_ITEM.exec(line)
    if (item !== null) {
      const text = item[1]?.trim() ?? ''
      if (text.length > 0) acceptance.push(text)
      continue
    }
    if (!inAcceptance) {
      const text = line.replace(/^#{1,6}\s*/, '').trim()
      if (text.length > 0) description.push(text)
    }
  }
  return { description: description.join('\n'), acceptance }
}

/** Latest run of a group, by creation time; ties keep the Host's order. */
function latestRun(runs: readonly RunNode[]): RunNode | undefined {
  return runs[0]
}

/**
 * Translate one Host snapshot into the panel's tree.
 * @param snapshot - rows read from the store, already in panel order.
 * @returns requirements with their documents/stories, standalone stories and defects.
 */
export function buildBoard(snapshot: WorkbenchSnapshot): Board {
  const docsByRequirement = new Map<string, DetailDoc[]>()
  for (const doc of snapshot.docs) {
    const list = docsByRequirement.get(doc.requirementId)
    const node: DetailDoc = {
      id: doc.id,
      title: doc.title,
      kind: doc.kind,
      updatedAt: doc.updatedAt,
      path: doc.path,
      storyIds: doc.storyIds,
    }
    if (list === undefined) docsByRequirement.set(doc.requirementId, [node])
    else list.push(node)
  }
  const docByStory = new Map<string, string>()
  for (const doc of snapshot.docs) {
    for (const storyId of doc.storyIds) {
      if (!docByStory.has(storyId)) docByStory.set(storyId, doc.id)
    }
  }

  const runsByStory = new Map<string, RunNode[]>()
  const runsByBug = new Map<string, RunNode[]>()
  const storyTitles = new Map(snapshot.stories.map((row) => [row.id, row.title]))
  const bugTitles = new Map(snapshot.bugs.map((row) => [row.id, row.title]))
  for (const run of snapshot.runs) {
    const subjectId = run.storyId ?? run.bugId
    if (subjectId === null) continue
    const node: RunNode = {
      id: run.id,
      subjectId,
      subjectTitle: (run.storyId === null ? bugTitles.get(subjectId) : storyTitles.get(subjectId)) ?? subjectId,
      status: run.status,
      branch: run.branch,
      at: run.startedAt ?? run.finishedAt ?? '',
      ...(run.sessionId === null ? {} : { sessionId: run.sessionId }),
    }
    const table = run.storyId === null ? runsByBug : runsByStory
    const list = table.get(subjectId)
    if (list === undefined) table.set(subjectId, [node])
    else list.push(node)
  }

  const storiesByRequirement = new Map<string, StoryNode[]>()
  const standalone: StandaloneStory[] = []
  for (const story of snapshot.stories) {
    const runs = runsByStory.get(story.id) ?? []
    const last = latestRun(runs)
    const parsed = parseStoryBody(story.body)
    const node: StoryNode = {
      id: story.id,
      title: story.title,
      workspaceId: story.workspaceId,
      state: storyState(story.status),
      status: story.status,
      size: story.size,
      updatedAt: story.updatedAt,
      path: story.path,
      ...(docByStory.has(story.id) ? { docId: docByStory.get(story.id) } : {}),
      ...(last?.sessionId === undefined ? {} : { sessionId: last.sessionId }),
      ...(story.createSessionId === null ? {} : { createSessionId: story.createSessionId }),
      body: story.body,
      description: parsed.description,
      acceptance: parsed.acceptance,
      bodyMissing: story.bodyMissing,
      ...(last === undefined ? {} : { lastRun: { status: last.status, at: last.at } }),
      runs,
      sessions: discussionNodes(story.sessions),
    }
    if (story.requirementId === null) {
      standalone.push({ kind: 'story', id: story.id, workspaceId: node.workspaceId, story: node })
      continue
    }
    const list = storiesByRequirement.get(story.requirementId)
    if (list === undefined) storiesByRequirement.set(story.requirementId, [node])
    else list.push(node)
  }

  // A requirement's two detail lists render by the explicit sort field, not by
  // arrival order: a status change moves nothing, and a new row is appended by
  // the Host with max + 1.
  const storyRows = new Map(snapshot.stories.map((row) => [row.id, row]))
  const docRows = new Map(snapshot.docs.map((row) => [row.id, row]))
  for (const list of storiesByRequirement.values()) sortByExplicitOrder(list, storyRows)
  for (const list of docsByRequirement.values()) sortByExplicitOrder(list, docRows)

  const requirements = snapshot.requirements.map((requirement): RequirementNode => {
    const stories = storiesByRequirement.get(requirement.id) ?? []
    const runs = stories.flatMap((story) => runsByStory.get(story.id) ?? [])
    const running = stories.some((story) => story.state === 'running')
    const finished = stories.length > 0 && stories.every((story) => story.status === 'completed')
    // 已完成的需求被重新拉起来做故事时，列表仍显示“执行中”，
    // 否则进行中的工作会被一个旧的完成状态盖住。
    const state: NodeState =
      requirement.status === 'archived'
        ? 'done'
        : running
          ? 'running'
          : requirement.status === 'completed' || finished
            ? 'done'
            : 'ready'
    const branch = runs.find((run) => run.branch.length > 0)?.branch
    const sessions = discussionNodes(
      snapshot.requirementSessions.filter((session) => session.requirementId === requirement.id),
    )
    const latestDesign = sessions.find((session) => session.kind === 'design')

    return {
      kind: 'requirement',
      id: requirement.id,
      workspaceId: requirement.workspaceId,
      title: requirement.title,
      summary: requirement.summary,
      status: requirement.status,
      state,
      updatedAt: requirement.updatedAt,
      path: requirement.path,
      content: lines(requirement.body),
      bodyMissing: requirement.bodyMissing,
      completedAt: requirement.completedAt,
      ...(latestDesign === undefined ? {} : { sessionId: latestDesign.sessionId }),
      ...(branch === undefined ? {} : { branch }),
      docs: docsByRequirement.get(requirement.id) ?? [],
      stories,
      runs,
      sessions,
    }
  })

  const bugs = snapshot.bugs.map((bug): BugNode => {
    const runs = runsByBug.get(bug.id) ?? []
    const last = latestRun(runs)
    return {
      id: bug.id,
      title: bug.title,
      severity: bug.severity,
      status: bug.status,
      state: bugState(bug.status),
      workspaceId: bug.workspaceId,
      content: lines(bug.body),
      bodyMissing: bug.bodyMissing,
      updatedAt: bug.updatedAt,
      ...(last?.sessionId === undefined ? {} : { sessionId: last.sessionId }),
      ...(bug.createSessionId === null ? {} : { createSessionId: bug.createSessionId }),
      runs,
      sessions: discussionNodes(bug.sessions),
    }
  })

  return { requirements, standalone, bugs }
}
