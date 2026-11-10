/**
 * `teamflow_update_bug` — revise a defect report, including merging a duplicate.
 *
 * When the bug Agent finds that a new report describes the same problem as an
 * existing defect, the agreed record is the existing one: this tool lets the
 * Agent extend its title or body with the new evidence instead of creating a
 * second row. A defect being fixed is refused by the state machine.
 *
 * @module
 */
import { defineTool } from '@deepseek-ai/dsh-tools'

import type { Bug, UpdateBugInput } from '../store/model.ts'
import type { WorkflowStore } from '../store/workflow.ts'
import { clip, type ToolEnvironment } from './shared.ts'

/** Largest body accepted from the model, in characters. */
const MAX_BODY_CHARS = 120_000

/**
 * Update one defect after validating that the call changes something.
 * @param workflow - the open workbench store.
 * @param rawId - bug id, trimmed before lookup.
 * @param input - fields to change; at least one must be present.
 * @returns the updated defect row.
 */
export function updateBugRecord(
  workflow: WorkflowStore,
  rawId: string,
  input: UpdateBugInput,
): Bug {
  const id = rawId.trim()
  if (id.length === 0) throw new Error('teamflow: 缺陷 id 不能为空。')
  if (input.title !== undefined && input.title.trim().length === 0) {
    throw new Error('teamflow: 缺陷标题不能为空。')
  }
  if (input.title === undefined && input.content === undefined && input.severity === undefined) {
    throw new Error('teamflow: 至少提供 title、content 或 severity 中的一项，否则这次更新不会改变任何内容。')
  }
  return workflow.updateBug(id, input)
}

/** Build the defect update tool bound to one Host context. */
export function updateBugTool(environment: ToolEnvironment) {
  return defineTool({
    name: 'teamflow_update_bug',
    description:
      'Update a defect title, severity or full Markdown report. Use it to merge a duplicate report into the existing defect: append the new reproduction evidence to the body instead of creating another bug. A defect being fixed is refused; all other statuses are editable.',
    parameters: {
      bug: {
        type: 'string',
        required: true,
        description: 'bug id from teamflow_list_records or teamflow_get_bug.',
      },
      title: { type: 'string', description: 'New title.' },
      content: { type: 'string', description: 'Full replacement Markdown body of bug.md.' },
      severity: {
        type: 'string',
        description: 'New severity.',
        enum: ['blocker', 'critical', 'major', 'minor', 'trivial'],
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
          contentPath: { type: 'string', required: true },
          updatedAt: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [
        {
          type: 'text',
          text: [
            `已更新缺陷 ${value.id}《${value.title}》：状态 ${value.status}，严重程度 ${value.severity}。`,
            `文档：${value.contentPath}`,
          ].join('\n'),
        },
      ],
    },
    async execute(args, exec) {
      exec.signal.throwIfAborted()
      const bug = updateBugRecord(environment.database.workflow, args.bug, {
        ...(args.title === undefined ? {} : { title: clip(args.title, 200) }),
        ...(args.content === undefined ? {} : { content: clip(args.content, MAX_BODY_CHARS) }),
        ...(args.severity === undefined ? {} : { severity: args.severity }),
      })
      return {
        id: bug.id,
        title: bug.title,
        status: bug.status,
        severity: bug.severity,
        contentPath: bug.contentPath,
        updatedAt: bug.updatedAt,
      }
    },
  })
}
