/**
 * `teamflow_create_design_doc` — add one detailed-design document under a
 * requirement.
 *
 * Detailed designs are the documents below the outline: page flows, data
 * models, interfaces, rules. They live in the requirement's `docs/` directory
 * and may be linked to the stories they cover.
 *
 * @module
 */
import { defineTool } from '@deepseek-ai/dsh-tools'

import { clip, type ToolEnvironment } from './shared.ts'

/** Build the detailed-design creation tool bound to one Host context. */
export function createDesignDocTool(environment: ToolEnvironment) {
  return defineTool({
    name: 'teamflow_create_design_doc',
    description:
      'Create a detailed-design document under a requirement (flow, data model, interface, page or rule) and write its Markdown body. Use it when the outline is not detailed enough for implementation; returns the document id and path.',
    parameters: {
      requirement: { type: 'string', required: true, description: 'Owning requirement id, for example req_... .' },
      title: { type: 'string', required: true, description: 'Document title shown in the file tree.' },
      kind: {
        type: 'string',
        description: 'One of flow, data, interface, page, rule. Defaults to flow.',
        enum: ['flow', 'data', 'interface', 'page', 'rule'],
      },
      content: { type: 'string', description: 'Full Markdown body of the detailed design.' },
      sortOrder: {
        type: 'number',
        description:
          'Display position under the requirement (ascending, non-negative integer). Omit to append after the current last document; only pass a value when the user asks for a position.',
      },
      storyIds: {
        type: 'array',
        items: { type: 'string' },
        description: 'stories this document covers; every id must belong to the same requirement.',
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
        {
          type: 'text',
          text: `已创建详细设计 ${value.id}《${value.title}》（${value.kind}）。\n文档：${value.contentPath}`,
        },
      ],
    },
    async execute(args, exec) {
      exec.signal.throwIfAborted()
      const requirementId = args.requirement.trim()
      if (requirementId.length === 0) throw new Error('teamflow: 需求 id 不能为空。')
      const title = clip(args.title, 200)
      if (title.length === 0) throw new Error('teamflow: 详细设计标题不能为空。')
      const doc = environment.database.workflow.createDesignDoc({
        requirementId,
        title,
        ...(args.kind === undefined ? {} : { kind: args.kind }),
        ...(args.content === undefined ? {} : { content: clip(args.content, 120_000) }),
        ...(args.sortOrder === undefined ? {} : { sortOrder: args.sortOrder }),
        ...(args.storyIds === undefined ? {} : { storyIds: args.storyIds }),
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
