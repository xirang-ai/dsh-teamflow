/**
 * `teamflow_update_story` — revise a story outside an active run.
 *
 * The store owns the state-machine guard: a story being developed or self-tested
 * is not editable; every other status is. This module only adds the tool-facing validation (non-empty id, at
 * least one changed field) and clips oversized input before it reaches SQLite.
 *
 * @module
 */
import { defineTool } from '@deepseek-ai/dsh-tools'

import type { Story, UpdateStoryInput } from '../store/model.ts'
import type { WorkflowStore } from '../store/workflow.ts'
import { clip, type ToolEnvironment } from './shared.ts'

/** Largest body accepted from the model, in characters. */
const MAX_BODY_CHARS = 120_000

/**
 * Update one story after validating that the call actually changes something.
 * @param workflow - the open workbench store.
 * @param rawId - story id, trimmed before lookup.
 * @param input - fields to change; at least one must be present.
 * @returns the updated story row.
 */
export function updateStoryRecord(
  workflow: WorkflowStore,
  rawId: string,
  input: UpdateStoryInput,
): Story {
  const id = rawId.trim()
  if (id.length === 0) throw new Error('teamflow: 故事 id 不能为空。')
  if (input.title !== undefined && input.title.trim().length === 0) {
    throw new Error('teamflow: 故事标题不能为空。')
  }
  if (
    input.title === undefined &&
    input.content === undefined &&
    input.size === undefined &&
    input.sortOrder === undefined
  ) {
    throw new Error(
      'teamflow: 至少提供 title、content、size 或 sortOrder 中的一项，否则这次更新不会改变任何内容。',
    )
  }
  return workflow.updateStory(id, input)
}

/** Build the story update tool bound to one Host context. */
export function updateStoryTool(environment: ToolEnvironment) {
  return defineTool({
    name: 'teamflow_update_story',
    description:
      'Update a story title, Markdown body (description and acceptance criteria), size or display position. Pass only the fields that change. A story being developed or self-tested is refused; ready, done, completed and cancelled stories are editable.',
    parameters: {
      story: {
        type: 'string',
        required: true,
        description: 'story id from teamflow_get_requirement, teamflow_get_story or teamflow_create_story.',
      },
      title: { type: 'string', description: 'New title.' },
      content: { type: 'string', description: 'Full replacement Markdown body of story.md.' },
      size: {
        type: 'string',
        description: 'New size: xs, s, m, l or xl.',
        enum: ['xs', 's', 'm', 'l', 'xl'],
      },
      sortOrder: {
        type: 'number',
        description:
          'New display position under the parent requirement (ascending, non-negative integer). Changing it re-orders the requirement page; status changes never do.',
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
          status: { type: 'string', required: true },
          size: { type: 'string', required: true },
          sortOrder: { type: 'number', required: true },
          contentPath: { type: 'string', required: true },
          updatedAt: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [
        {
          type: 'text',
          text: [
            `已更新故事 ${value.id}《${value.title}》：状态 ${value.status}，规模 ${value.size}，排序 ${value.sortOrder}。`,
            `文档：${value.contentPath}`,
            value.requirementId.length === 0 ? '所属需求：独立故事' : `所属需求：${value.requirementId}`,
          ].join('\n'),
        },
      ],
    },
    async execute(args, exec) {
      exec.signal.throwIfAborted()
      const story = updateStoryRecord(environment.database.workflow, args.story, {
        ...(args.title === undefined ? {} : { title: clip(args.title, 200) }),
        ...(args.content === undefined ? {} : { content: clip(args.content, MAX_BODY_CHARS) }),
        ...(args.size === undefined ? {} : { size: args.size }),
        ...(args.sortOrder === undefined ? {} : { sortOrder: args.sortOrder }),
      })
      return {
        id: story.id,
        requirementId: story.requirementId ?? '',
        title: story.title,
        status: story.status,
        size: story.size,
        sortOrder: story.sortOrder,
        contentPath: story.contentPath,
        updatedAt: story.updatedAt,
      }
    },
  })
}
