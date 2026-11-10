/**
 * `teamflow_list_workspaces` — the escape hatch when a session has no
 * workspace directory (or several candidates).
 *
 * @module
 */
import { defineTool } from '@deepseek-ai/dsh-tools'

import type { ToolEnvironment } from './shared.ts'

/** Build the workspace-list tool bound to one Host context. */
export function listWorkspacesTool(environment: ToolEnvironment) {
  return defineTool({
    name: 'teamflow_list_workspaces',
    description:
      'List the Xirang workspaces the Host knows, with their ids, titles and directories. Use it when a create call reports that the workspace is ambiguous, then pass the chosen id as the workspace argument.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          workspaces: { type: 'array', required: true, items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  id: { type: 'string', required: true },
                  title: { type: 'string', required: true },
                  path: { type: 'string', required: true },
                },
              } },
          total: { type: 'number', required: true },
        },
      },
      render: (_args, value) => [
        {
          type: 'text',
          text:
            value.workspaces.length === 0
              ? '当前没有可用工作区。请让用户先在 DSH 中打开一个工作区。'
              : [
                  `共有 ${value.total} 个工作区：`,
                  ...value.workspaces.map((item) => `- ${item.id}｜${item.title}｜${item.path}`),
                  '创建工作项时把需要的 id 作为 workspace 参数传入。',
                ].join('\n'),
        },
      ],
    },
    async execute(_args, exec) {
      exec.signal.throwIfAborted()
      const workspaces = environment.workspaces().map((item) => ({ ...item }))
      return { workspaces, total: workspaces.length }
    },
  })
}
