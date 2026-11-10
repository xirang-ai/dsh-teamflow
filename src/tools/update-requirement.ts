/**
 * `teamflow_update_requirement` — revise a requirement and its outline body.
 *
 * The requirement and its outline design share one document, so writing the
 * outline is the same operation as updating the requirement. Archived
 * requirements are refused by the store.
 *
 * @module
 */
import { defineTool } from '@deepseek-ai/dsh-tools'

import { clip, type ToolEnvironment } from './shared.ts'

/** Build the requirement-writing tool bound to one Host context. */
export function updateRequirementTool(environment: ToolEnvironment) {
  return defineTool({
    name: 'teamflow_update_requirement',
    description:
      'Update a requirement title, summary or Markdown body (the body is also the outline design shown to the team). Use it when the user agrees on changes; pass only the fields that change. Returns the new status and document path.',
    parameters: {
      id: { type: 'string', required: true, description: 'Requirement id, for example req_... .' },
      title: { type: 'string', description: 'New short title.' },
      summary: { type: 'string', description: 'New one-paragraph conclusion shown on the board.' },
      content: {
        type: 'string',
        description: 'Full replacement Markdown body: goals, scope, non-goals, constraints, outline design.',
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
          contentPath: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [
        {
          type: 'text',
          text: [
            `已更新需求 ${value.id}《${value.title}》，当前状态 ${value.status}。`,
            `文档：${value.contentPath}`,
            '请把改动摘要展示给用户。',
          ].join('\n'),
        },
      ],
    },
    async execute(args, exec) {
      exec.signal.throwIfAborted()
      const id = args.id.trim()
      if (id.length === 0) throw new Error('teamflow: 需求 id 不能为空。')
      const requirement = environment.database.workflow.updateRequirement(id, {
        ...(args.title === undefined ? {} : { title: clip(args.title, 200) }),
        ...(args.summary === undefined ? {} : { summary: clip(args.summary, 4_000) }),
        ...(args.content === undefined ? {} : { content: clip(args.content, 120_000) }),
      })
      return {
        id: requirement.id,
        title: requirement.title,
        status: requirement.status,
        contentPath: requirement.contentPath,
      }
    },
  })
}
