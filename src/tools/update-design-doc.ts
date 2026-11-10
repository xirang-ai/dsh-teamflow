/**
 * `teamflow_update_design_doc` — revise a detailed-design document.
 *
 * @module
 */
import { defineTool } from '@deepseek-ai/dsh-tools'

import { clip, type ToolEnvironment } from './shared.ts'

/** Build the detailed-design update tool bound to one Host context. */
export function updateDesignDocTool(environment: ToolEnvironment) {
  return defineTool({
    name: 'teamflow_update_design_doc',
    description:
      'Update a detailed-design document title, kind, sort order or Markdown body. Pass only the fields that change; returns the new path.',
    parameters: {
      id: { type: 'string', required: true, description: 'Document id, for example doc_... .' },
      title: { type: 'string', description: 'New title.' },
      kind: {
        type: 'string',
        description: 'New kind: flow, data, interface, page or rule.',
        enum: ['flow', 'data', 'interface', 'page', 'rule'],
      },
      content: { type: 'string', description: 'Full replacement Markdown body.' },
      sortOrder: {
        type: 'number',
        description:
          'New display position under the requirement (ascending, non-negative integer). Changing it re-orders the requirement page.',
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
          sortOrder: { type: 'number', required: true },
          contentPath: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [
        { type: 'text', text: `已更新详细设计 ${value.id}《${value.title}》。\n文档：${value.contentPath}` },
      ],
    },
    async execute(args, exec) {
      exec.signal.throwIfAborted()
      const id = args.id.trim()
      if (id.length === 0) throw new Error('teamflow: 详细设计 id 不能为空。')
      const doc = environment.database.workflow.updateDesignDoc(id, {
        ...(args.title === undefined ? {} : { title: clip(args.title, 200) }),
        ...(args.kind === undefined ? {} : { kind: args.kind }),
        ...(args.content === undefined ? {} : { content: clip(args.content, 120_000) }),
        ...(args.sortOrder === undefined ? {} : { sortOrder: args.sortOrder }),
      })
      return {
        id: doc.id,
        requirementId: doc.requirementId,
        title: doc.title,
        kind: doc.kind,
        sortOrder: doc.sortOrder,
        contentPath: doc.contentPath,
      }
    },
  })
}
