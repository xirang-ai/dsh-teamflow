/**
 * `teamflow_delete_design_doc` — permanently remove one detailed-design document.
 *
 * This is the "delete the old document, then write a new one" path the detail
 * Agent needs when a rewrite is not an in-place revision. Deletion goes through
 * the workbench's preview-then-delete path, so the Agent and the Web UI share
 * the same refusal rules: a document covered by an executing story is refused
 * with a sentence the user can act on. The body file and every
 * `design_doc_stories` coverage link are removed with the row; there is no undo.
 *
 * @module
 */
import { defineTool } from '@deepseek-ai/dsh-tools'

import type { DeleteOutcome, DeletePreviewItem } from '../store/model.ts'
import type { WorkflowStore } from '../store/workflow.ts'
import type { ToolEnvironment } from './shared.ts'

/** What one successful detailed-design deletion removed, as the model sees it. */
export interface DeletedDesignDoc {
  readonly id: string
  readonly requirementId: string
  readonly title: string
  readonly kind: string
  /** Coverage links removed from `design_doc_stories`. */
  readonly removedLinks: number
}

/** Turn a deletion preview into the refusal the Agent should relay. */
function refusal(item: DeletePreviewItem): string {
  const head = `teamflow: 不能删除详细设计 ${item.id}《${item.title}》`
  if (item.reasonCode === 'has_active_run') {
    const run = item.activeRunId === null ? '' : ` ${item.activeRunId}`
    return `${head}：覆盖它的故事仍有研发运行${run} 尚未结束；请先取消该运行再删除。`
  }
  if (item.reasonCode === 'invalid_transition') {
    return `${head}：覆盖它的故事正在执行（developing / self_testing）；只有覆盖故事都空闲时才能删除详设。`
  }
  return `${head}：${item.reason ?? '当前状态不允许删除'}。`
}

/**
 * Preview and then delete one detailed-design document.
 *
 * The preview is where a refusal becomes an actionable sentence instead of a
 * bare `ok: false`, because `deleteRecords` reports per-record failures instead
 * of throwing.
 * @param workflow - the open workbench store.
 * @param rawId - document id, trimmed before lookup.
 * @returns the removed document's identity and how many coverage links went with it.
 */
export function deleteDesignDoc(workflow: WorkflowStore, rawId: string): DeletedDesignDoc {
  const id = rawId.trim()
  if (id.length === 0) throw new Error('teamflow: 详细设计 id 不能为空。')

  // Read the row before it is gone: the requirement id and kind are not part
  // of the deletion outcome.
  const doc = workflow.getDesignDoc(id)
  if (doc === null) throw new Error(`teamflow: 详细设计 ${id} 不存在。`)

  const preview = workflow.previewDeletions([{ kind: 'design_doc', id }])
  const item = preview.items[0]
  if (item === undefined) throw new Error(`teamflow: 无法预览详细设计 ${id} 的删除。`)
  if (!item.found) throw new Error(`teamflow: 详细设计 ${id} 不存在。`)
  if (!item.deletable) throw new Error(refusal(item))

  const report = workflow.deleteRecords([{ kind: 'design_doc', id }])
  const outcome: DeleteOutcome | undefined = report.results[0]
  if (outcome === undefined) throw new Error(`teamflow: 删除详细设计 ${id} 没有返回结果。`)
  if (!outcome.ok) {
    throw new Error(`teamflow: 删除详细设计 ${id} 失败：${outcome.error?.message ?? '未知错误'}。`)
  }

  return {
    id: outcome.id,
    requirementId: doc.requirementId,
    title: outcome.title,
    kind: doc.kind,
    removedLinks: outcome.removedLinks,
  }
}

/** Build the detailed-design deletion tool bound to one Host context. */
export function deleteDesignDocTool(environment: ToolEnvironment) {
  return defineTool({
    name: 'teamflow_delete_design_doc',
    description:
      'Permanently delete one detailed-design document together with its Markdown body and every story-coverage link. Use this when the user asks to remove the old document and write a new one, or to drop a document that no longer belongs. A document covered by a story that is developing or self-testing is refused. Ask the user to confirm the title first: this cannot be undone.',
    parameters: {
      id: {
        type: 'string',
        required: true,
        description: 'Document id from teamflow_get_requirement or teamflow_get_design_doc.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', required: true },
          requirementId: { type: 'string', required: true },
          title: { type: 'string', required: true },
          kind: { type: 'string', required: true },
          removedLinks: { type: 'number', required: true },
        },
      },
      render: (_args, value) => [
        {
          type: 'text',
          text: [
            `已删除详细设计 ${value.id}《${value.title}》（${value.kind}），所属需求 ${value.requirementId}。`,
            value.removedLinks === 0
              ? '正文文件已一并删除；此操作不可恢复。'
              : `正文文件与 ${value.removedLinks} 条故事覆盖关系已一并删除；此操作不可恢复。`,
          ].join('\n'),
        },
      ],
    },
    async execute(args, exec) {
      exec.signal.throwIfAborted()
      return deleteDesignDoc(environment.database.workflow, args.id)
    },
  })
}
