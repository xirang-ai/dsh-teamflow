/**
 * `teamflow_link_requirement_session` — confirm the requirement discussion
 * prepared for this conversation.
 *
 * The browser creates the session and registers a pending binding before the
 * first message, so the Agent must not need the requirement id. The session id
 * is the durable identity of the conversation; linking is idempotent.
 *
 * @module
 */
import { defineTool } from '@deepseek-ai/dsh-tools'

import type { ToolEnvironment } from './shared.ts'

/** Build the session-linking tool bound to one Host context. */
export function linkRequirementSessionTool(environment: ToolEnvironment) {
  return defineTool({
    name: 'teamflow_link_requirement_session',
    description:
      'Confirm that this conversation belongs to the requirement it was started from. Call it once at the very beginning of a requirement discussion; it takes no arguments and returns the requirement id, title and confirmation time.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          requirementId: { type: 'string', required: true },
          title: { type: 'string', required: true },
          sessionId: { type: 'string', required: true },
          linkedAt: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [
        {
          type: 'text',
          text: [
            `已把本会话登记到需求 ${value.requirementId}《${value.title}》。`,
            '接下来调用 teamflow_get_requirement 读取需求与概设正文（详设讨论还会读取文档清单），再结合用户补充继续讨论。',
          ].join('\n'),
        },
      ],
    },
    async execute(_args, exec) {
      exec.signal.throwIfAborted()
      const sessionId = exec.agent?.session.header.id?.trim() ?? ''
      if (sessionId.length === 0) {
        throw new Error('teamflow: 无法从当前会话取得 session id，不能登记需求会话。')
      }
      const session = environment.database.workflow.linkRequirementSession(sessionId)
      const requirement = environment.database.workflow.getRequirement(session.requirementId)
      if (requirement === null) {
        throw new Error(`teamflow: 需求 ${session.requirementId} 不存在，无法登记会话。`)
      }
      return {
        requirementId: requirement.id,
        title: requirement.title,
        sessionId: session.sessionId,
        linkedAt: session.linkedAt ?? session.preparedAt ?? session.createdAt,
      }
    },
  })
}
