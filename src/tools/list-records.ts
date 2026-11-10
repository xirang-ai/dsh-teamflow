/**
 * `teamflow_list_records` — read the board before creating a child item.
 *
 * The interviewer needs this to turn a user's "挂在登录需求下" into an id
 * without guessing. Results are capped per kind and the cap is reported.
 * Defects are ordered open-first so the bug Agent checks existing reports
 * (including finished ones) before filing a duplicate.
 *
 * @module
 */
import { defineTool } from '@deepseek-ai/dsh-tools'

import { clip, type ToolEnvironment } from './shared.ts'

interface RecordRow {
  id: string
  title: string
  status: string
  updatedAt: string
}

/** Build the read tool bound to one Host context. */
export function listRecordsTool(environment: ToolEnvironment) {
  return defineTool({
    name: 'teamflow_list_records',
    description:
      'List existing requirements, stories and bugs in one Xirang workspace. Use it to resolve a parent id or title before creating a design/story. For defects it returns open items first, then finished ones, so an agent can detect a duplicate and merge into the existing report instead of creating another. Results are capped; truncated is true when more rows exist.',
    parameters: {
      workspace: {
        type: 'string',
        description: 'Workspace id, title or path; omit to use the session workspace.',
      },
      limit: {
        type: 'number',
        description: 'Maximum rows per kind, 1–50. Defaults to 20.',
      },
      bugStatus: {
        type: 'string',
        description:
          'Only list defects in this status; omit to list all, open first. reported/fixing are open, fixed is executed, completed/wontfix are closed.',
        enum: ['reported', 'fixing', 'fixed', 'completed', 'wontfix'],
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          workspaceId: { type: 'string', required: true },
          workspaceTitle: { type: 'string', required: true },
          requirements: { type: 'array', required: true, items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  id: { type: 'string', required: true },
                  title: { type: 'string', required: true },
                  status: { type: 'string', required: true },
                  updatedAt: { type: 'string', required: true },
                },
              } },
          stories: { type: 'array', required: true, items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  id: { type: 'string', required: true },
                  title: { type: 'string', required: true },
                  status: { type: 'string', required: true },
                  updatedAt: { type: 'string', required: true },
                },
              } },
          bugs: { type: 'array', required: true, items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  id: { type: 'string', required: true },
                  title: { type: 'string', required: true },
                  status: { type: 'string', required: true },
                  updatedAt: { type: 'string', required: true },
                },
              } },
          truncated: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => {
        const line = (row: RecordRow): string => `- ${row.id}｜${row.status}｜${row.title}（更新 ${row.updatedAt}）`
        const section = (title: string, rows: readonly RecordRow[]): string[] =>
          rows.length === 0 ? [`${title}：无`] : [`${title}：`, ...rows.map(line)]
        return [
          {
            type: 'text',
            text: [
              `工作区：${value.workspaceTitle}（${value.workspaceId}）`,
              ...section('需求', value.requirements),
              ...section('故事', value.stories),
              ...section('缺陷', value.bugs),
              value.truncated ? '已达到返回上限，还有更多记录没有列出。' : '以上是全部记录。',
            ].join('\n'),
          },
        ]
      },
    },
    async execute(args, exec) {
      exec.signal.throwIfAborted()
      const workspace = environment.resolveWorkspace(args.workspace, exec.agent?.session.header.cwd)
      const requested = args.limit ?? 20
      const limit = Math.max(1, Math.min(50, Math.trunc(requested)))
      const workflow = environment.database.workflow
      const requirements = workflow.listRequirements({ workspaceId: workspace.id })
      const stories = workflow.listStories({ workspaceId: workspace.id })
      const bugs = workflow
        .listBugs({ workspaceId: workspace.id })
        .filter((bug) => args.bugStatus === undefined || bug.status === args.bugStatus)
        .sort((left, right) => {
          const rank = (status: string): number =>
            status === 'reported' || status === 'fixing' ? 0 : status === 'fixed' ? 1 : 2
          return rank(left.status) - rank(right.status) || right.updatedAt.localeCompare(left.updatedAt)
        })
      const shape = (row: { id: string; title: string; status: string; updatedAt: string }): RecordRow => ({
        id: row.id,
        title: clip(row.title, 120),
        status: row.status,
        updatedAt: row.updatedAt,
      })
      return {
        workspaceId: workspace.id,
        workspaceTitle: workspace.title,
        requirements: requirements.slice(0, limit).map(shape),
        stories: stories.slice(0, limit).map(shape),
        bugs: bugs.slice(0, limit).map(shape),
        truncated:
          requirements.length > limit || stories.length > limit || bugs.length > limit,
      }
    },
  })
}
