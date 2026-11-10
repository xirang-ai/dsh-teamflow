/**
 * `teamflow_create_story` — persist a deliverable story, optionally under an
 * existing requirement.
 *
 * @module
 */
import { defineTool } from '@deepseek-ai/dsh-tools'

import type { StorySize } from '../store/model.ts'
import { clip, type ToolEnvironment } from './shared.ts'

const SIZES: readonly StorySize[] = ['xs', 's', 'm', 'l', 'xl']

/** Build the story-writing tool bound to one Host context. */
export function createStoryTool(environment: ToolEnvironment) {
  return defineTool({
    name: 'teamflow_create_story',
    description:
      'Create a story in the Xirang workbench. Pass requirement to attach it to an existing requirement, or omit it for a standalone story in the session workspace. Returns the id, parent requirement and document path.',
    parameters: {
      workspace: {
        type: 'string',
        description: 'Workspace id, title or path; needed for a standalone story when the session directory is ambiguous.',
      },
      requirement: {
        type: 'string',
        description:
          'Parent requirement id (req_...) or exact title. Omit for a standalone story.',
      },
      title: { type: 'string', required: true, description: 'story title, phrased as a deliverable.' },
      content: {
        type: 'string',
        description: 'Markdown body: value, acceptance criteria in Given/When/Then, dependencies and risks.',
      },
      size: {
        type: 'string',
        enum: SIZES,
        description: 'T-shirt size; defaults to m when the user has no preference.',
      },
      sortOrder: {
        type: 'number',
        description:
          'Display position under the parent requirement (ascending, non-negative integer). Omit to append after the current last story; only pass a value when the user asks for a position.',
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
          size: { type: 'string', required: true },
          sortOrder: { type: 'number', required: true },
          requirementId: { type: 'string', required: true },
          workspaceId: { type: 'string', required: true },
          workspaceTitle: { type: 'string', required: true },
          contentPath: { type: 'string', required: true },
          createdAt: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [
        {
          type: 'text',
          text: [
            `已创建故事 ${value.id}《${value.title}》，状态 ${value.status}，规模 ${value.size}，排序 ${value.sortOrder}。`,
            `工作区：${value.workspaceTitle}（${value.workspaceId}）`,
            value.requirementId.length > 0
              ? `所属需求：${value.requirementId}`
              : '独立故事（未挂到需求）',
            `文档：${value.contentPath}`,
            '请把编号、标题、状态、规模和父级关系展示给用户，并说明下一步可以开始研发。',
          ].join('\n'),
        },
      ],
    },
    async execute(args, exec) {
      exec.signal.throwIfAborted()

      const workflow = environment.database.workflow
      const workspace = environment.resolveWorkspace(args.workspace, exec.agent?.session.header.cwd)

      let requirementId: string | undefined
      if (args.requirement !== undefined && args.requirement.trim().length > 0) {
        const wanted = args.requirement.trim()
        const byId = workflow.getRequirement(wanted)
        const match =
          byId ??
          workflow
            .listRequirements({ workspaceId: workspace.id })
            .find((item) => item.title === wanted)
        if (match === null || match === undefined) {
          throw new Error(`teamflow: 没有找到需求「${wanted}」，请先创建需求或改用 id。`)
        }
        requirementId = match.id
      }

      const title = clip(args.title, 200)
      if (title.length === 0) throw new Error('teamflow: 故事标题不能为空。')
      environment.touch(workspace)
      const sessionId = exec.agent?.session.header.id?.trim() ?? ''
      const story = workflow.createStory({
        workspaceId: requirementId === undefined ? workspace.id : undefined,
        requirementId,
        title,
        content: args.content === undefined ? '' : clip(args.content, 120_000),
        size: args.size,
        ...(args.sortOrder === undefined ? {} : { sortOrder: args.sortOrder }),
        ...(sessionId.length === 0 ? {} : { sessionId }),
      })
      return {
        id: story.id,
        title: story.title,
        status: story.status,
        size: story.size,
        sortOrder: story.sortOrder,
        requirementId: story.requirementId ?? '',
        workspaceId: story.workspaceId,
        workspaceTitle: workspace.title,
        contentPath: story.contentPath,
        createdAt: story.createdAt,
      }
    },
  })
}
