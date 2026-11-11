/**
 * Chart model tests: layout, state mapping and the live-session overlay.
 *
 * The model is pure, so these tests build view-model literals instead of going
 * through the Host or the DOM.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { DetailDoc, RequirementNode, RunNode, StoryNode } from '../src/client/board.ts'
import {
  FLOW_MAX_HEIGHT,
  FLOW_MIN_HEIGHT,
  FLOW_TARGETS,
  buildFlowModel,
  flowNodeTarget,
  flowStoryTarget,
} from '../src/client/flow-model.ts'

function doc(id: string): DetailDoc {
  return {
    id,
    title: id,
    kind: 'flow',
    updatedAt: '2026-11-09T00:00:00.000Z',
    path: `${id}.md`,
    storyIds: [],
  }
}

function run(overrides: Partial<RunNode> = {}): RunNode {
  return {
    id: 'run_1',
    subjectId: 'sty_1',
    subjectTitle: 'Story',
    status: 'running',
    branch: 'dsh/sty_1',
    at: '2026-11-09T00:00:00.000Z',
    ...overrides,
  }
}

function story(overrides: Partial<StoryNode> = {}): StoryNode {
  return {
    id: 'sty_1',
    title: 'Story',
    workspaceId: 'ws',
    state: 'ready',
    status: 'ready',
    size: 's',
    updatedAt: '2026-11-09T00:00:00.000Z',
    path: 'story.md',
    body: '',
    description: '',
    acceptance: [],
    bodyMissing: false,
    runs: [],
    sessions: [],
    ...overrides,
  }
}

function requirement(overrides: Partial<RequirementNode> = {}): RequirementNode {
  return {
    kind: 'requirement',
    id: 'req_1',
    workspaceId: 'ws',
    title: 'Requirement',
    summary: '',
    status: 'draft',
    state: 'ready',
    updatedAt: '2026-11-09T00:00:00.000Z',
    path: 'requirement.md',
    content: [],
    bodyMissing: false,
    completedAt: null,
    docs: [],
    stories: [],
    runs: [],
    sessions: [],
    ...overrides,
  }
}

const never = (): boolean => false

describe('buildFlowModel', () => {
  it('lays out one row per story and links the four columns', () => {
    const model = buildFlowModel(
      requirement({
        content: ['body'],
        stories: [story({ id: 'sty_a' }), story({ id: 'sty_b', title: 'Second' })],
      }),
      never,
    )

    const nodes = model.nodes
    assert.equal(nodes.length, 6)
    assert.deepEqual(
      model.edges.map((edge) => `${edge.source}>${edge.target}`),
      [
        'outline>detail',
        'detail>story-sty_a',
        'story-sty_a>run-sty_a',
        'detail>story-sty_b',
        'story-sty_b>run-sty_b',
      ],
    )

    const rows = nodes.filter((node) => node.kind === 'story')
    assert.equal(rows.length, 2)
    assert.ok(rows[0]!.y < rows[1]!.y)
    // Stage nodes sit between the first and last story row.
    const outline = nodes.find((node) => node.id === 'outline')
    assert.ok(outline !== undefined)
    assert.ok(outline.y > rows[0]!.y)
    assert.ok(outline.y < rows[1]!.y)
  })

  it('maps record status onto node colors, muted when nothing has run', () => {
    const model = buildFlowModel(
      requirement({
        content: ['body'],
        docs: [doc('doc_1')],
        stories: [
          story({ id: 'sty_a', status: 'developing', state: 'running', runs: [run()] }),
          story({ id: 'sty_b', state: 'ready' }),
        ],
        sessions: [
          { sessionId: 'design-1', kind: 'design', at: '2026-11-09T00:00:00.000Z' },
          { sessionId: 'detail-1', kind: 'detail', at: '2026-11-09T00:00:00.000Z' },
        ],
      }),
      never,
    )

    const byId = new Map(model.nodes.map((node) => [node.id, node]))
    assert.equal(byId.get('outline')?.state, 'done')
    assert.equal(byId.get('detail')?.state, 'done')
    assert.equal(byId.get('story-sty_a')?.state, 'running')
    assert.equal(byId.get('run-sty_a')?.state, 'running')
    assert.equal(byId.get('story-sty_b')?.state, 'ready')
    assert.equal(byId.get('run-sty_b')?.state, 'muted')
    assert.equal(byId.get('run-sty_b')?.running, false)
  })

  it('keeps a stage ready until its output exists', () => {
    const model = buildFlowModel(requirement(), never)
    const byId = new Map(model.nodes.map((node) => [node.id, node]))
    assert.equal(byId.get('outline')?.state, 'ready')
    assert.equal(byId.get('detail')?.state, 'ready')
  })

  it('shows a placeholder instead of branches before the split runs', () => {
    const model = buildFlowModel(
      requirement({
        sessions: [{ sessionId: 'split-1', kind: 'split', at: '2026-11-09T00:00:00.000Z' }],
      }),
      (sessionId) => sessionId === 'split-1',
    )
    assert.equal(model.nodes.length, 3)
    assert.deepEqual(
      model.edges.map((edge) => `${edge.source}>${edge.target}`),
      ['outline>detail', 'detail>placeholder'],
    )
    const placeholder = model.nodes.find((node) => node.id === 'placeholder')
    assert.equal(placeholder?.state, 'running')
    assert.equal(placeholder?.running, true)
  })

  it('overlays live sessions on settled database statuses', () => {
    const model = buildFlowModel(
      requirement({
        content: ['body'],
        sessions: [{ sessionId: 'design-1', kind: 'design', at: '2026-11-09T00:00:00.000Z' }],
        stories: [
          story({
            id: 'sty_a',
            status: 'done',
            state: 'done',
            sessionId: 'run-session',
            runs: [run({ id: 'run_done', status: 'succeeded', sessionId: 'run-session' })],
          }),
        ],
      }),
      (sessionId) => sessionId === 'design-1' || sessionId === 'run-session',
    )

    const byId = new Map(model.nodes.map((node) => [node.id, node]))
    assert.equal(byId.get('outline')?.state, 'running')
    assert.equal(byId.get('outline')?.running, true)
    assert.equal(byId.get('story-sty_a')?.state, 'running')
    assert.equal(byId.get('story-sty_a')?.running, true)
    assert.equal(byId.get('run-sty_a')?.state, 'running')
    assert.equal(byId.get('run-sty_a')?.running, true)
  })

  it('keeps a failed run settled: done purple, no flowing outline', () => {
    const model = buildFlowModel(
      requirement({
        stories: [
          story({
            id: 'sty_a',
            status: 'done',
            state: 'done',
            runs: [run({ status: 'failed', sessionId: 'old-session' })],
          }),
        ],
      }),
      never,
    )
    const runNode = model.nodes.find((node) => node.kind === 'run')
    assert.equal(runNode?.state, 'done')
    assert.equal(runNode?.running, false)
  })

  it('caps the canvas height and keeps a one-story chart compact', () => {
    const many = buildFlowModel(
      requirement({
        stories: Array.from({ length: 10 }, (_value, index) =>
          story({ id: `sty_${index}`, title: `Story ${index}` }),
        ),
      }),
      never,
    )
    assert.equal(many.height, FLOW_MAX_HEIGHT)

    const one = buildFlowModel(requirement({ stories: [story()] }), never)
    assert.equal(one.height, FLOW_MIN_HEIGHT)
  })
})

describe('flowNodeTarget', () => {
  const base = { id: 'n', x: 0, y: 0, width: 124, height: 46, state: 'ready' as const, running: false }

  it('sends stage nodes to their cards and the placeholder to the stories card', () => {
    assert.equal(flowNodeTarget({ ...base, kind: 'outline' }), FLOW_TARGETS.design)
    assert.equal(flowNodeTarget({ ...base, kind: 'detail' }), FLOW_TARGETS.docs)
    assert.equal(flowNodeTarget({ ...base, kind: 'placeholder' }), FLOW_TARGETS.stories)
  })

  it('sends a story and its run to the same story row', () => {
    const storyNode = {
      ...base,
      kind: 'story' as const,
      storyId: 'sty_1',
      title: 'Story',
      status: 'ready' as const,
    }
    const runNode = { ...base, kind: 'run' as const, storyId: 'sty_1' }
    assert.equal(flowStoryTarget('sty_1'), 'tf-story-sty_1')
    assert.equal(flowNodeTarget(storyNode), 'tf-story-sty_1')
    assert.equal(flowNodeTarget(runNode), 'tf-story-sty_1')
  })
})
