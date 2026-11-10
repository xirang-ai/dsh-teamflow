/**
 * State and layout for the requirement progress chart.
 *
 * The chart is the requirement pipeline at a glance:
 *
 *   outline (概设) → detail (详设) → story (故事) → run (执行)
 *
 * Every story gets one row, so a requirement with four stories reads as four
 * parallel branches. Pure data: no React, no DOM, no Host calls, so the layout
 * and the state rules can be unit-tested without a browser.
 *
 * @module
 */
import { runState } from './board.ts'
import type { NodeState, RequirementNode } from './board.ts'
import type { RequirementSessionKind, RunStatus, StoryStatus } from '../store/model.ts'

/** Visual state of one chart node; `muted` marks work that does not exist yet. */
export type FlowState = NodeState | 'muted'

/** Node height in chart units (48px at 100%). */
export const FLOW_NODE_HEIGHT = 46

/** Distance between two story rows; leaves a 24px gap between nodes. */
export const FLOW_ROW_STEP = 70

/** Top padding above the first row. */
export const FLOW_TOP = 12

/** Shortest chart, so one story does not look cramped. */
export const FLOW_MIN_HEIGHT = 150

/** Tallest chart; more stories than fit are scaled down, not scrolled. */
export const FLOW_MAX_HEIGHT = 380

/** Gap between stacked nodes: 70px step − 46px node. */
const FLOW_ROW_GAP = FLOW_ROW_STEP - FLOW_NODE_HEIGHT

const COLUMN_X = { outline: 0, detail: 140, story: 300, run: 508 } as const
const STAGE_WIDTH = 124
const STORY_WIDTH = 168
const RUN_WIDTH = 152

interface FlowNodeBase {
  readonly id: string
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly state: FlowState
  /** True while a related session executes; drives the flowing outline. */
  readonly running: boolean
}

/** The requirement itself (outline design) or the detailed-design stage. */
export interface FlowStageNode extends FlowNodeBase {
  readonly kind: 'outline' | 'detail'
}

/** One story branch head. */
export interface FlowStoryNode extends FlowNodeBase {
  readonly kind: 'story'
  readonly storyId: string
  readonly title: string
  readonly status: StoryStatus
}

/** The newest run of one story; `muted` when the story has not run yet. */
export interface FlowRunNode extends FlowNodeBase {
  readonly kind: 'run'
  readonly storyId: string
  readonly runId?: string
  readonly status?: RunStatus
  readonly branch?: string
  readonly sessionId?: string
}

/** Shown instead of stories when the requirement has not been split yet. */
export interface FlowPlaceholderNode extends FlowNodeBase {
  readonly kind: 'placeholder'
}

export type FlowNode =
  | FlowStageNode
  | FlowStoryNode
  | FlowRunNode
  | FlowPlaceholderNode

export interface FlowEdge {
  readonly id: string
  readonly source: string
  readonly target: string
}

export interface FlowModel {
  readonly nodes: readonly FlowNode[]
  readonly edges: readonly FlowEdge[]
  /** Canvas height for the card; the width always fills the card. */
  readonly height: number
}

/**
 * Element ids the requirement surface gives its cards.
 *
 * The chart and the markup share these ids so a node click can reveal the
 * matching card without either side guessing a selector.
 */
export const FLOW_TARGETS = {
  design: 'tf-section-design',
  docs: 'tf-section-docs',
  stories: 'tf-section-stories',
} as const

/** Element id of one story row inside the stories card. */
export function flowStoryTarget(storyId: string): string {
  return `tf-story-${storyId}`
}

/**
 * Card or row a chart node points at.
 *
 * A run belongs to its story, so both the story node and the run node land on
 * the same row; the two stage nodes land on their cards, and the "not split
 * yet" placeholder lands on the stories card where splitting starts.
 */
export function flowNodeTarget(node: FlowNode): string {
  switch (node.kind) {
    case 'outline':
      return FLOW_TARGETS.design
    case 'detail':
      return FLOW_TARGETS.docs
    case 'story':
    case 'run':
      return flowStoryTarget(node.storyId)
    case 'placeholder':
      return FLOW_TARGETS.stories
  }
}

/**
 * Build the chart for one requirement.
 *
 * `isSessionRunning` answers whether a session is executing right now; the
 * caller derives it from the Host's `useSessionStatus`. Database statuses carry
 * the settled state, live sessions carry the "right now" overlay, and the chart
 * prefers the live answer when the two disagree.
 */
export function buildFlowModel(
  requirement: RequirementNode,
  isSessionRunning: (sessionId: string) => boolean,
): FlowModel {
  const stories = requirement.stories
  const contentHeight =
    stories.length === 0
      ? FLOW_NODE_HEIGHT
      : stories.length * FLOW_ROW_STEP - FLOW_ROW_GAP
  const height = Math.min(
    FLOW_MAX_HEIGHT,
    Math.max(FLOW_MIN_HEIGHT, contentHeight + FLOW_TOP * 2),
  )
  const stageY = Math.round(FLOW_TOP + contentHeight / 2 - FLOW_NODE_HEIGHT / 2)

  const isRunning = (sessionId: string | undefined): boolean =>
    sessionId !== undefined && isSessionRunning(sessionId)

  const designSession =
    latestSession(requirement, 'design') ?? requirement.sessionId
  const detailSession = latestSession(requirement, 'detail')
  const splitSession = latestSession(requirement, 'split')

  const outlineRunning = isRunning(designSession)
  const detailRunning = isRunning(detailSession)
  const outlineDone =
    requirement.status === 'completed' ||
    requirement.status === 'archived' ||
    requirement.content.length > 0
  const detailDone = requirement.docs.length > 0

  const nodes: FlowNode[] = [
    {
      kind: 'outline',
      id: 'outline',
      x: COLUMN_X.outline,
      y: stageY,
      width: STAGE_WIDTH,
      height: FLOW_NODE_HEIGHT,
      state: stageState(outlineRunning, outlineDone),
      running: outlineRunning,
    },
    {
      kind: 'detail',
      id: 'detail',
      x: COLUMN_X.detail,
      y: stageY,
      width: STAGE_WIDTH,
      height: FLOW_NODE_HEIGHT,
      state: stageState(detailRunning, detailDone),
      running: detailRunning,
    },
  ]
  const edges: FlowEdge[] = [
    { id: 'outline-detail', source: 'outline', target: 'detail' },
  ]

  if (stories.length === 0) {
    const splitting = isRunning(splitSession)
    nodes.push({
      kind: 'placeholder',
      id: 'placeholder',
      x: COLUMN_X.story,
      y: FLOW_TOP,
      width: STORY_WIDTH,
      height: FLOW_NODE_HEIGHT,
      state: splitting ? 'running' : 'muted',
      running: splitting,
    })
    edges.push({
      id: 'detail-placeholder',
      source: 'detail',
      target: 'placeholder',
    })
    return { nodes, edges, height }
  }

  stories.forEach((story, index) => {
    const storyNodeId = `story-${story.id}`
    const runNodeId = `run-${story.id}`
    const y = FLOW_TOP + index * FLOW_ROW_STEP

    const liveRunning =
      isRunning(story.sessionId) || story.runs.some((run) => isRunning(run.sessionId))
    const storyRunning = story.state === 'running' || liveRunning

    nodes.push({
      kind: 'story',
      id: storyNodeId,
      storyId: story.id,
      title: story.title,
      status: story.status,
      x: COLUMN_X.story,
      y,
      width: STORY_WIDTH,
      height: FLOW_NODE_HEIGHT,
      state: storyRunning ? 'running' : story.state,
      running: storyRunning,
    })
    edges.push({
      id: `detail-${storyNodeId}`,
      source: 'detail',
      target: storyNodeId,
    })

    const run = story.runs[0]
    const runRunning =
      run !== undefined &&
      (runState(run.status) === 'running' || isRunning(run.sessionId))
    nodes.push({
      kind: 'run',
      id: runNodeId,
      storyId: story.id,
      runId: run?.id,
      status: run?.status,
      branch: run?.branch,
      sessionId: run?.sessionId,
      x: COLUMN_X.run,
      y,
      width: RUN_WIDTH,
      height: FLOW_NODE_HEIGHT,
      state: run === undefined ? 'muted' : runRunning ? 'running' : 'done',
      running: runRunning,
    })
    edges.push({
      id: `${storyNodeId}-${runNodeId}`,
      source: storyNodeId,
      target: runNodeId,
    })
  })

  return { nodes, edges, height }
}

/** Newest session of one kind; the list is ordered newest first. */
function latestSession(
  requirement: RequirementNode,
  kind: RequirementSessionKind,
): string | undefined {
  return requirement.sessions.find((session) => session.kind === kind)?.sessionId
}

function stageState(running: boolean, done: boolean): FlowState {
  if (running) return 'running'
  return done ? 'done' : 'ready'
}
