/**
 * `teamflow_create_requirement` — persist a requirement the interviewer just
 * collected. The tool owns the write; the agent's job is the conversation.
 *
 * @module
 */
import { defineTool } from '@deepseek-ai/dsh-tools'

import { clip, firstParagraph, type ToolEnvironment } from './shared.ts'

/** Build the requirement-writing tool bound to one Host context. */
export function createRequirementTool(environment: ToolEnvironment) {
  return defineTool({
    name: 'teamflow_create_requirement',
    description:
      'Create a requirement record in the Xirang workbench and write its Markdown body into the workspace. Use it only after the interviewer has collected the background, scope and acceptance criteria; it returns the new id, status and document path.',
    parameters: {
      workspace: {
        type: 'string',
        description:
          'Workspace id, title or absolute path. Omit to use the session workspace; pass it when the session directory is not the target workspace.',
      },
      title: { type: 'string', required: true, description: 'Short requirement title.' },
      summary: {
        type: 'string',
        description: 'One-paragraph conclusion shown on the board. Defaults to the first paragraph of content.',
      },
      content: {
        type: 'string',
        description: 'Full requirement body in Markdown: background, goals, scope, non-goals, acceptance criteria, constraints.',
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
          workspaceId: { type: 'string', required: true },
          workspaceTitle: { type: 'string', required: true },
          contentPath: { type: 'string', required: true },
          createdAt: { type: 'string', required: true },
          sessionId: { type: 'string' },
        },
      },
      render: (_args, value) => [
        {
          type: 'text',
          text: [
            `已创建需求 ${value.id}《${value.title}》，状态 ${value.status}。`,
            `工作区：${value.workspaceTitle}（${value.workspaceId}）`,
            `文档：${value.contentPath}`,
            '请把编号、标题、状态和文档路径展示给用户，并询问是否继续补充概要设计或拆分故事。',
          ].join('\n'),
        },
      ],
    },
    async execute(args, exec) {
      exec.signal.throwIfAborted()
      const workspace = environment.resolveWorkspace(args.workspace, exec.agent?.session.header.cwd)
      const title = clip(args.title, 200)
      if (title.length === 0) throw new Error('teamflow: 需求标题不能为空。')
      const content = args.content === undefined ? '' : clip(args.content, 120_000)
      const summary =
        args.summary !== undefined && args.summary.trim().length > 0
          ? clip(args.summary, 4_000)
          : firstParagraph(content)
      environment.touch(workspace)
      const sessionId = exec.agent?.session.header.id?.trim() ?? ''
      const requirement = environment.database.workflow.createRequirement({
        workspaceId: workspace.id,
        title,
        summary,
        content,
        ...(sessionId.length === 0 ? {} : { sessionId }),
      })
      return {
        id: requirement.id,
        title: requirement.title,
        status: requirement.status,
        workspaceId: requirement.workspaceId,
        workspaceTitle: workspace.title,
        contentPath: requirement.contentPath,
        createdAt: requirement.createdAt,
        ...(sessionId.length === 0 ? {} : { sessionId }),
      }
    },
  })
}
