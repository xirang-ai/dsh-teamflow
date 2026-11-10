/**
 * `teamflow_get_bug` — read one defect and its full report.
 *
 * The bug Agent needs this to decide whether a new report is a duplicate: the
 * board gives ids, titles and statuses, while the decision needs the recorded
 * reproduction text, expected result and actual result.
 *
 * @module
 */
import { defineTool } from '@deepseek-ai/dsh-tools'

import type { WorkflowStore } from '../store/workflow.ts'
import { clip, type ToolEnvironment } from './shared.ts'

/** Largest body the tool returns before clipping, in characters. */
const MAX_BODY_CHARS = 120_000

/** One defect as the model reads it. */
export interface BugDetail {
  readonly id: string
  readonly title: string
  readonly status: string
  readonly severity: string
  readonly resolution: string
  readonly workspaceId: string
  readonly contentPath: string
  readonly body: string
  readonly bodyMissing: boolean
  readonly createdAt: string
  readonly updatedAt: string
  readonly fixedAt?: string
  readonly completedAt?: string
}

/**
 * Read one defect plus its Markdown report.
 * @param workflow - the open workbench store.
 * @param rawId - bug id, trimmed before lookup.
 * @returns metadata and the body of `bug.md`.
 */
export function readBug(workflow: WorkflowStore, rawId: string): BugDetail {
  const id = rawId.trim()
  if (id.length === 0) throw new Error('teamflow: 缺陷 id 不能为空。')
  const bug = workflow.getBug(id)
  if (bug === null) throw new Error(`teamflow: 缺陷 ${id} 不存在，无法读取正文。`)
  const body = workflow.readContent(bug.workspaceId, bug.contentPath)
  return {
    id: bug.id,
    title: bug.title,
    status: bug.status,
    severity: bug.severity,
    resolution: bug.resolution,
    workspaceId: bug.workspaceId,
    contentPath: bug.contentPath,
    body: clip(body ?? '', MAX_BODY_CHARS),
    bodyMissing: body === null,
    createdAt: bug.createdAt,
    updatedAt: bug.updatedAt,
    ...(bug.fixedAt === null ? {} : { fixedAt: bug.fixedAt }),
    ...(bug.completedAt === null ? {} : { completedAt: bug.completedAt }),
  }
}

/** Build the defect reading tool bound to one Host context. */
export function getBugTool(environment: ToolEnvironment) {
  return defineTool({
    name: 'teamflow_get_bug',
    description:
      'Read one defect by id: title, status, severity, resolution and the full Markdown report (environment, reproduction steps, expected and actual result). Use it before deciding that a new report duplicates an existing defect, or before revising one.',
    parameters: {
      bug: {
        type: 'string',
        required: true,
        description: 'bug id from teamflow_list_records or teamflow_create_bug, for example bug_... .',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', required: true },
          title: { type: 'string', required: true },
          status: { type: 'string', required: true },
          severity: { type: 'string', required: true },
          resolution: { type: 'string', required: true },
          workspaceId: { type: 'string', required: true },
          contentPath: { type: 'string', required: true },
          body: { type: 'string', required: true },
          bodyMissing: { type: 'boolean', required: true },
          createdAt: { type: 'string', required: true },
          updatedAt: { type: 'string', required: true },
          fixedAt: { type: 'string' },
          completedAt: { type: 'string' },
        },
      },
      render: (_args, value) => [
        {
          type: 'text',
          text: [
            `缺陷 ${value.id}《${value.title}》，状态 ${value.status}，严重程度 ${value.severity}`,
            `文档：${value.contentPath}`,
            value.resolution.trim().length === 0 ? '' : `结论：${value.resolution}`,
            '',
            value.bodyMissing
              ? `（正文文件不存在：${value.contentPath}。请确认文件是否被移动或删除，不要把它当成空内容。）`
              : value.body.trim().length > 0
                ? value.body
                : '（缺陷正文为空，请先向用户确认复现信息。）',
          ]
            .filter((line) => line !== '')
            .join('\n'),
        },
      ],
    },
    async execute(args, exec) {
      exec.signal.throwIfAborted()
      return readBug(environment.database.workflow, args.bug)
    },
  })
}
