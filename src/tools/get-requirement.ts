/**
 * `teamflow_get_requirement` — read the requirement bound to this conversation.
 *
 * The discussion prompt deliberately carries neither the requirement id nor the
 * body. This tool resolves it through the current session's binding and returns
 * the Markdown the Agent should discuss, plus the stories and detailed-design
 * documents already attached, so a long requirement does not bloat the first
 * user message.
 *
 * @module
 */
import { defineTool } from '@deepseek-ai/dsh-tools'

import { clip, type ToolEnvironment } from './shared.ts'

/** Build the requirement-reading tool bound to one Host context. */
export function getRequirementTool(environment: ToolEnvironment) {
  return defineTool({
    name: 'teamflow_get_requirement',
    description:
      'Read the requirement (whose body is also the outline design) that this conversation is linked to. Call it after teamflow_link_requirement_session, before discussing or revising the requirement; it takes no arguments and returns metadata, the Markdown body, the detailed-design documents and the stories.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          requirementId: { type: 'string', required: true },
          title: { type: 'string', required: true },
          summary: { type: 'string', required: true },
          status: { type: 'string', required: true },
          workspaceId: { type: 'string', required: true },
          contentPath: { type: 'string', required: true },
          body: { type: 'string', required: true },
          bodyMissing: { type: 'boolean', required: true },
          completedAt: { type: 'string' },
          stories: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                title: { type: 'string', required: true },
                status: { type: 'string', required: true },
                sortOrder: { type: 'number', required: true },
              },
            },
          },
          docs: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                title: { type: 'string', required: true },
                kind: { type: 'string', required: true },
                sortOrder: { type: 'number', required: true },
                path: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => {
        // The model only sees this rendering, so the ids and titles of the
        // detailed-design documents must be spelled out here: without them the
        // Agent cannot call teamflow_update_design_doc / teamflow_get_design_doc
        // on an existing document.
        const maxListed = 40
        const lines = [
          `需求 ${value.requirementId}《${value.title}》，状态 ${value.status}`,
          `文档：${value.contentPath}`,
          `详设文档：${value.docs.length} 份`,
          ...value.docs
            .slice(0, maxListed)
            .map((doc) => `- ${doc.id}《${doc.title}》（${doc.kind}）：${doc.path}`),
        ]
        if (value.docs.length > maxListed) {
          lines.push(`（另有 ${value.docs.length - maxListed} 份详设未列出，结果已截断。）`)
        }
        lines.push(`故事：${value.stories.length} 个`)
        lines.push(
          ...value.stories
            .slice(0, maxListed)
            .map((story) => `- ${story.id}《${story.title}》：${story.status}`),
        )
        if (value.stories.length > maxListed) {
          lines.push(`（另有 ${value.stories.length - maxListed} 个故事未列出，结果已截断。）`)
        }
        lines.push(
          '',
          value.bodyMissing
            ? `（正文文件不存在：${value.contentPath}。请确认文件是否被移动或删除，不要把它当成空内容。）`
            : value.body.trim().length > 0
              ? value.body
              : '（需求正文为空，请先向用户确认要讨论的内容。）',
        )
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute(_args, exec) {
      exec.signal.throwIfAborted()
      const sessionId = exec.agent?.session.header.id?.trim() ?? ''
      if (sessionId.length === 0) {
        throw new Error('teamflow: 无法从当前会话取得 session id，不能读取需求。')
      }
      const session = environment.database.workflow.getRequirementSession(sessionId)
      if (session === null) {
        throw new Error(
          'teamflow: 本会话还没有关联需求。请从需求页点击「在新的会话中继续讨论」重新发起。',
        )
      }
      const requirement = environment.database.workflow.getRequirement(session.requirementId)
      if (requirement === null) {
        throw new Error(`teamflow: 需求 ${session.requirementId} 不存在，无法读取正文。`)
      }
      const docs = environment.database.workflow.listDesignDocs(requirement.id)
      const stories = environment.database.workflow.listStories({ requirementId: requirement.id })
      const body = environment.database.workflow.readContent(requirement.contentPath)
      return {
        requirementId: requirement.id,
        title: requirement.title,
        summary: requirement.summary,
        status: requirement.status,
        workspaceId: requirement.workspaceId,
        contentPath: requirement.contentPath,
        body: clip(body ?? '', 120_000),
        bodyMissing: body === null,
        ...(requirement.completedAt === null ? {} : { completedAt: requirement.completedAt }),
        stories: stories.map((story) => ({
          id: story.id,
          title: story.title,
          status: story.status,
          sortOrder: story.sortOrder,
        })),
        docs: docs.map((doc) => ({
          id: doc.id,
          title: doc.title,
          kind: doc.kind,
          sortOrder: doc.sortOrder,
          path: doc.contentPath,
        })),
      }
    },
  })
}
