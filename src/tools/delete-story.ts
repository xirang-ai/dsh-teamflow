/**
 * `teamflow_delete_story` — permanently remove one story.
 *
 * Deletion reuses the workbench's preview-then-delete path so the tool and the
 * Web UI enforce exactly the same state-machine rules: an active development
 * run blocks the delete, and the preview is what makes the refusal
 * explainable instead of a bare SQLite failure. `story.md`, the run history
 * and the design-document links are removed with the row; there is no undo.
 *
 * @module
 */
import { defineTool } from '@deepseek-ai/dsh-tools'

import type { DeleteOutcome, DeletePreviewItem } from '../store/model.ts'
import type { WorkflowStore } from '../store/workflow.ts'
import type { ToolEnvironment } from './shared.ts'

/** What one successful story deletion removed, as the model sees it. */
export interface DeletedStory {
  readonly id: string
  readonly title: string
  readonly status: string
  readonly removedRuns: number
}

/** Turn a deletion preview into the refusal the Agent should relay. */
function refusal(item: DeletePreviewItem): string {
  const head = `teamflow: 不能删除故事 ${item.id}《${item.title}》`
  if (item.reasonCode === 'invalid_transition') {
    return `${head}：当前状态是 ${item.status}，Agent 可能正在执行它；只有没有活动研发的故事才能删除。`
  }
  if (item.reasonCode === 'has_active_run') {
    const run = item.activeRunId === null ? '' : ` ${item.activeRunId}`
    return `${head}：研发运行${run} 尚未结束；请先取消该运行再删除。`
  }
  return `${head}：${item.reason ?? '当前状态不允许删除'}。`
}

/**
 * Preview and then delete one story.
 *
 * The preview is not just a UI nicety: `deleteRecords` reports per-record
 * failures instead of throwing, so the preview is where a refusal becomes a
 * useful sentence rather than a silent `ok: false`.
 * @param workflow - the open workbench store.
 * @param rawId - story id, trimmed before lookup.
 * @returns the deleted story's identity and how many run rows went with it.
 */
export function deleteStory(workflow: WorkflowStore, rawId: string): DeletedStory {
  const id = rawId.trim()
  if (id.length === 0) throw new Error('teamflow: 故事 id 不能为空。')

  const preview = workflow.previewDeletions([{ kind: 'story', id }])
  const item = preview.items[0]
  if (item === undefined) throw new Error(`teamflow: 无法预览故事 ${id} 的删除。`)
  if (!item.found) throw new Error(`teamflow: 故事 ${id} 不存在。`)
  if (!item.deletable) throw new Error(refusal(item))

  const report = workflow.deleteRecords([{ kind: 'story', id }])
  const outcome: DeleteOutcome | undefined = report.results[0]
  if (outcome === undefined) throw new Error(`teamflow: 删除故事 ${id} 没有返回结果。`)
  if (!outcome.ok) {
    throw new Error(`teamflow: 删除故事 ${id} 失败：${outcome.error?.message ?? '未知错误'}。`)
  }

  return { id: outcome.id, title: outcome.title, status: item.status, removedRuns: outcome.removedRuns }
}

/** Build the story deletion tool bound to one Host context. */
export function deleteStoryTool(environment: ToolEnvironment) {
  return defineTool({
    name: 'teamflow_delete_story',
    description:
      'Permanently delete one story together with its story.md, run history and design-document links. Only stories without an active development run can be deleted; developing and self_testing stories are refused. Ask the user to confirm the title and status first: this cannot be undone.',
    parameters: {
      story: {
        type: 'string',
        required: true,
        description: 'story id from teamflow_get_requirement or teamflow_get_story.',
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
          removedRuns: { type: 'number', required: true },
        },
      },
      render: (_args, value) => [
        {
          type: 'text',
          text: [
            `已删除故事 ${value.id}《${value.title}》（原状态 ${value.status}）。`,
            `story.md、详细设计覆盖关系与 ${value.removedRuns} 条研发运行记录已一并删除；此操作不可恢复。`,
          ].join('\n'),
        },
      ],
    },
    async execute(args, exec) {
      exec.signal.throwIfAborted()
      return deleteStory(environment.database.workflow, args.story)
    },
  })
}
