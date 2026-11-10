/**
 * Requirement progress chart: outline → detail → story → run, one row per story.
 *
 * The chart never pans or zooms. Clicking a node reveals the card or story row
 * it stands for further down the same page; opening sessions and documents
 * stays with those cards, so this surface only answers "how far has this
 * requirement got" at a glance.
 *
 * @module
 */
import xyflowCss from '@xyflow/react/dist/base.css'
import {
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from '@xyflow/react'
import type { Edge, Node, NodeProps } from '@xyflow/react'
import { useEffect, useMemo, useRef } from 'react'
import type { ReactElement } from 'react'

import type { RequirementNode } from './board.ts'
import type { TranslateFn, UseSessionStatus } from './context.ts'
import { EMPTY_SESSION_STATUS } from './context.ts'
import { buildFlowModel } from './flow-model.ts'
import type { FlowModel, FlowNode, FlowStageNode } from './flow-model.ts'

/** Slot prop used when the shell does not provide `useSessionStatus`. */
const useNoSessionStatus: UseSessionStatus = (selector) =>
  selector(EMPTY_SESSION_STATUS)

/** Data every chart node carries into its React component. */
type FlowNodeData = {
  readonly node: FlowNode
  readonly t: TranslateFn
  /** Reveal the card or story row this node stands for. */
  readonly onActivate?: ((node: FlowNode) => void) | undefined
}

/** One component handles every node shape; `kind` decides the copy. */
const NODE_TYPES = { tf: FlowNodeView }

/**
 * Render the chart for one requirement.
 *
 * `requirement` is already the flattened view model, so this component never
 * fetches: it derives nodes and edges and hands them to React Flow.
 */
export function RequirementFlow({
  requirement,
  t,
  useSessionStatus,
  onActivate,
}: {
  readonly requirement: RequirementNode
  readonly t: TranslateFn
  readonly useSessionStatus?: UseSessionStatus
  readonly onActivate?: (node: FlowNode) => void
}): ReactElement {
  const statuses = (useSessionStatus ?? useNoSessionStatus)((state) => state)
  const model = useMemo(
    () =>
      buildFlowModel(
        requirement,
        (sessionId) => statuses.get(sessionId)?.running === true,
      ),
    [requirement, statuses],
  )

  return (
    <>
      <style>{STYLE_TAG}</style>
      <ReactFlowProvider>
        <FlowCanvas model={model} t={t} onActivate={onActivate} />
      </ReactFlowProvider>
    </>
  )
}

function FlowCanvas({
  model,
  t,
  onActivate,
}: {
  readonly model: FlowModel
  readonly t: TranslateFn
  readonly onActivate?: ((node: FlowNode) => void) | undefined
}): ReactElement {
  const { fitView } = useReactFlow()
  const hostRef = useRef<HTMLDivElement | null>(null)

  const nodes = useMemo<Node<FlowNodeData>[]>(
    () =>
      model.nodes.map((node) => ({
        id: node.id,
        type: 'tf',
        position: { x: node.x, y: node.y },
        data: { node, t, onActivate },
        style: { width: node.width, height: node.height },
        draggable: false,
        selectable: false,
        connectable: false,
        focusable: false,
        deletable: false,
      })),
    [model, t, onActivate],
  )
  const edges = useMemo<Edge[]>(
    () =>
      model.edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: 'default',
        selectable: false,
        focusable: false,
        deletable: false,
      })),
    [model],
  )

  // Refit whenever the model or the card width changes (window resize, panel
  // switch). Zoom and pan stay disabled, so the fit is the only way to see a
  // wide or tall graph in full.
  useEffect(() => {
    const host = hostRef.current
    if (host === null) return undefined
    let frame = 0
    const fit = (): void => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        void fitView({ padding: 0.02, maxZoom: 1, duration: 0 })
      })
    }
    const observer = new ResizeObserver(fit)
    observer.observe(host)
    fit()
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [fitView, model])

  return (
    <div ref={hostRef} className="tf-flow" style={{ height: model.height }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        // React Flow turns pointer events off on nodes that have no node-level
        // handler. Without this, mouse clicks land on the pane while a
        // programmatic `.click()` still works — set a handler so the custom
        // nodes stay hit-testable.
        onNodeClick={
          onActivate
            ? (_event, node) => {
                onActivate(node.data.node)
              }
            : undefined
        }
        fitView
        fitViewOptions={{ padding: 0.02, maxZoom: 1 }}
        minZoom={0.4}
        maxZoom={1}
        nodesDraggable={false}
        nodesConnectable={false}
        nodesFocusable={false}
        edgesFocusable={false}
        elementsSelectable={false}
        panOnDrag={false}
        panOnScroll={false}
        zoomOnScroll={false}
        zoomOnPinch={false}
        zoomOnDoubleClick={false}
        preventScrolling={false}
        aria-label={t('flow.title')}
      />
    </div>
  )
}

function FlowNodeView({ data }: NodeProps<Node<FlowNodeData>>): ReactElement {
  const { node, t, onActivate } = data
  const copy = nodeCopy(node, t)
  const interactive = onActivate !== undefined
  const activate = (): void => {
    onActivate?.(node)
  }
  return (
    <div
      className="tf-flow-node"
      data-state={node.state}
      data-running={node.running ? 'true' : 'false'}
      data-clickable={interactive ? 'true' : 'false'}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-label={interactive ? `${copy.label} · ${copy.meta}` : undefined}
      title={copy.label}
      onKeyDown={
        interactive
          ? (event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return
              event.preventDefault()
              activate()
            }
          : undefined
      }
    >
      {node.running ? (
        <svg
          className="tf-flow-ring"
          viewBox={`0 0 ${node.width + 6} ${node.height + 6}`}
          aria-hidden="true"
        >
          <rect
            x="0.75"
            y="0.75"
            width={node.width + 4.5}
            height={node.height + 4.5}
            rx="12"
            ry="12"
          />
        </svg>
      ) : null}
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <div className="tf-flow-face">
        <span className="tf-flow-dot" aria-hidden="true" />
        <span className="tf-flow-text">
          <span className="tf-flow-label">{copy.label}</span>
          <span className="tf-flow-meta">{copy.meta}</span>
        </span>
      </div>
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  )
}

/** Label and secondary line for one node, in the current locale. */
function nodeCopy(node: FlowNode, t: TranslateFn): { label: string; meta: string } {
  switch (node.kind) {
    case 'outline':
      return { label: t('detail.design'), meta: stageMeta(node, t) }
    case 'detail':
      return { label: t('detail.docs'), meta: stageMeta(node, t) }
    case 'story':
      return { label: node.title, meta: t(`story.status.${node.status}`) }
    case 'run':
      return {
        label: node.running
          ? t('flow.inProgress')
          : node.status === undefined
            ? t('state.ready')
            : t(`run.status.${node.status}`),
        meta: node.branch ?? t('flow.stage.run'),
      }
    case 'placeholder':
      return {
        label: node.running ? t('flow.splitting') : t('flow.notSplit'),
        meta: t('detail.stories'),
      }
  }
}

function stageMeta(node: FlowStageNode, t: TranslateFn): string {
  if (node.running) return t('flow.inProgress')
  return node.state === 'done' ? t('state.done') : t('state.ready')
}

/**
 * Chart styles. Kept next to the component so the visual rules travel with the
 * markup; the React Flow base sheet is prepended to the same `<style>` tag.
 */
const FLOW_STYLES = String.raw`
.tf-flow {
  position: relative;
  width: 100%;
}
.tf-flow .react-flow {
  background: transparent;
}
.tf-flow .react-flow__node {
  cursor: default;
  font-family: inherit;
}
.tf-flow .react-flow__handle {
  width: 1px;
  height: 1px;
  min-width: 0;
  min-height: 0;
  border: 0;
  opacity: 0;
  pointer-events: none;
}
.tf-flow .react-flow__edge-path {
  stroke: var(--dsw-alias-border-l2, #d5d9e2);
  stroke-width: 1.2;
}
.tf-flow .react-flow__attribution {
  display: none;
}
.tf-flow-node {
  --tf-flow-tone: var(--dsw-alias-label-caption, #8b93a7);
  position: relative;
  width: 100%;
  height: 100%;
}
.tf-flow-node[data-clickable='true'] {
  cursor: pointer;
}
.tf-flow-node[data-clickable='true']:hover .tf-flow-face {
  border-color: color-mix(
    in srgb,
    var(--tf-flow-tone) 45%,
    var(--dsw-alias-border-l2, #d5d9e2)
  );
}
.tf-flow-node:focus-visible {
  outline: 2px solid var(--dsw-alias-link, #4176e6);
  outline-offset: 4px;
  border-radius: 12px;
}
.tf-flow-node[data-state='running'] {
  --tf-flow-tone: var(--dsw-alias-state-success-primary, #22c55e);
}
.tf-flow-node[data-state='ready'] {
  --tf-flow-tone: var(--dsw-alias-link, #4176e6);
}
.tf-flow-node[data-state='done'] {
  --tf-flow-tone: var(--dsw-alias-state-done-primary, #7c3aed);
}
.tf-flow-face {
  display: flex;
  align-items: center;
  gap: 7px;
  box-sizing: border-box;
  height: 100%;
  padding: 0 10px;
  border: 1px solid
    color-mix(in srgb, var(--tf-flow-tone) 26%, var(--dsw-alias-border-l2, #d5d9e2));
  border-radius: 10px;
  background: color-mix(
    in srgb,
    var(--tf-flow-tone) 7%,
    var(--dsw-alias-bg-layer-1, #fff)
  );
}
.tf-flow-node[data-state='muted'] .tf-flow-face {
  border-style: dashed;
  background: var(--dsw-alias-interactive-bg-hover, #f2f4f8);
}
.tf-flow-dot {
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--tf-flow-tone);
  box-shadow: 0 0 0 3px
    color-mix(in srgb, var(--tf-flow-tone) 14%, transparent);
}
.tf-flow-node[data-state='muted'] .tf-flow-dot {
  box-shadow: none;
}
.tf-flow-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  line-height: 1.3;
}
.tf-flow-label,
.tf-flow-meta {
  display: block;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.tf-flow-label {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary, #1d2333);
}
.tf-flow-node[data-state='muted'] .tf-flow-label {
  color: var(--dsw-alias-label-secondary, #5b6478);
}
.tf-flow-meta {
  font-size: 10px;
  color: var(--tf-flow-tone);
}
.tf-flow-ring {
  position: absolute;
  inset: -3px;
  width: calc(100% + 6px);
  height: calc(100% + 6px);
  overflow: visible;
  pointer-events: none;
}
.tf-flow-ring rect {
  fill: none;
  stroke: var(--tf-flow-tone);
  stroke-width: 1.5;
  stroke-dasharray: 8 6;
  vector-effect: non-scaling-stroke;
  animation: tf-flow-march 1.4s linear infinite;
}
@keyframes tf-flow-march {
  from {
    stroke-dashoffset: 0;
  }
  to {
    stroke-dashoffset: -28px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .tf-flow-ring rect {
    animation: none;
  }
}
`

const STYLE_TAG = `${xyflowCss}\n${FLOW_STYLES}`
