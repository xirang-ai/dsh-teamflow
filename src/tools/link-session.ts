/**
 * `teamflow_link_session` — confirm the discussion prepared for this conversation.
 *
 * The browser creates the session and registers a pending binding before the
 * first message, so the Agent must not need a record id. The session id is the
 * durable identity of the conversation; linking is idempotent. Requirements,
 * stories and defects share this tool; `teamflow_link_requirement_session`
 * stays as a compatibility alias with the same implementation.
 *
 * @module
 */
import { defineTool } from '@deepseek-ai/dsh-tools'

import type { DiscussionSubjectType } from '../store/model.ts'
import type { ToolEnvironment } from './shared.ts'

/** Where the Agent should read the record after linking. */
function nextStep(subjectType: string): string {
  if (subjectType === 'story') return 'teamflow_get_story'
  if (subjectType === 'bug') return 'teamflow_get_bug'
  return 'teamflow_get_requirement'
}

/** Build the generic session-linking tool bound to one Host context. */
export function linkSessionTool(environment: ToolEnvironment) {
  return defineTool({
    name: 'teamflow_link_session',
    description:
      'Confirm that this conversation belongs to the requirement, story or defect it was started from. Call it once at the very beginning of a discussion; it takes no arguments and returns the subject type, id, title and confirmation time.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          subjectType: { type: 'string', required: true },
          subjectId: { type: 'string', required: true },
          title: { type: 'string', required: true },
          sessionId: { type: 'string', required: true },
          kind: { type: 'string', required: true },
          linkedAt: { type: 'string', required: true },
          alreadyLinked: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => [
        {
          type: 'text',
          text: [
            `已把本会话登记到${subjectLabel(value.subjectType)} ${value.subjectId}《${value.title}》。`,
            `接下来调用 ${nextStep(value.subjectType)} 读取正文，再结合用户补充继续讨论。`,
          ].join('\n'),
        },
      ],
    },
    async execute(_args, exec) {
      exec.signal.throwIfAborted()
      const sessionId = exec.agent?.session.header.id?.trim() ?? ''
      if (sessionId.length === 0) {
        throw new Error('teamflow: 无法从当前会话取得 session id，不能登记讨论会话。')
      }
      const before = environment.database.workflow.getDiscussionSession(sessionId)
      const session = environment.database.workflow.linkDiscussionSession(sessionId)
      const title = subjectTitle(environment, session.subjectType, session.subjectId)
      return {
        subjectType: session.subjectType,
        subjectId: session.subjectId,
        title,
        sessionId: session.sessionId,
        kind: session.kind,
        linkedAt: session.linkedAt ?? session.preparedAt ?? session.createdAt,
        alreadyLinked: before?.linkedAt != null,
      }
    },
  })
}

function subjectLabel(subjectType: string): string {
  if (subjectType === 'story') return '故事'
  if (subjectType === 'bug') return '缺陷'
  return '需求'
}

/** Record title, falling back to the id so a dangling row still reports something readable. */
function subjectTitle(
  environment: ToolEnvironment,
  subjectType: DiscussionSubjectType,
  subjectId: string,
): string {
  const workflow = environment.database.workflow
  if (subjectType === 'story') return workflow.getStory(subjectId)?.title ?? subjectId
  if (subjectType === 'bug') return workflow.getBug(subjectId)?.title ?? subjectId
  return workflow.getRequirement(subjectId)?.title ?? subjectId
}
