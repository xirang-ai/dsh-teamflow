/**
 * `teamflow_create_bug` — persist a defect report collected by the bug
 * interviewer.
 *
 * @module
 */
import { defineTool } from '@deepseek-ai/dsh-tools'

import type { BugSeverity } from '../store/model.ts'
import { clip, type ToolEnvironment } from './shared.ts'

const SEVERITIES: readonly BugSeverity[] = ['blocker', 'critical', 'major', 'minor', 'trivial']

/** Build the defect-writing tool bound to one Host context. */
export function createBugTool(environment: ToolEnvironment) {
  return defineTool({
    name: 'teamflow_create_bug',
    description:
      'Create a bug report in the Xirang workbench. Use it after collecting reproduction steps, expected and actual behavior, environment and severity; returns the new id, severity and document path.',
    parameters: {
      workspace: {
        type: 'string',
        description: 'Workspace id, title or path; omit to use the session workspace.',
      },
      title: { type: 'string', required: true, description: 'Short, observable defect title.' },
      content: {
        type: 'string',
        description:
          'Markdown body: environment/version, reproduction steps, expected result, actual result, impact and any logs.',
      },
      severity: {
        type: 'string',
        enum: SEVERITIES,
        description: 'Severity; defaults to major when the user has not chosen one.',
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
          severity: { type: 'string', required: true },
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
            `已创建缺陷 ${value.id}《${value.title}》，状态 ${value.status}，严重程度 ${value.severity}。`,
            `工作区：${value.workspaceTitle}（${value.workspaceId}）`,
            `文档：${value.contentPath}`,
            '请把编号、标题、严重程度和文档路径展示给用户。若这是合并到已有缺陷的记录，说明合并在哪个编号下；否则说明可以直接开始修复。',
          ].join('\n'),
        },
      ],
    },
    async execute(args, exec) {
      exec.signal.throwIfAborted()
      const workspace = environment.resolveWorkspace(args.workspace, exec.agent?.session.header.cwd)
      const title = clip(args.title, 200)
      if (title.length === 0) throw new Error('teamflow: 缺陷标题不能为空。')
      environment.touch(workspace)
      const sessionId = exec.agent?.session.header.id?.trim() ?? ''
      const bug = environment.database.workflow.createBug({
        workspaceId: workspace.id,
        title,
        content: args.content === undefined ? '' : clip(args.content, 120_000),
        severity: args.severity,
        ...(sessionId.length === 0 ? {} : { sessionId }),
      })
      return {
        id: bug.id,
        title: bug.title,
        status: bug.status,
        severity: bug.severity,
        workspaceId: bug.workspaceId,
        workspaceTitle: workspace.title,
        contentPath: bug.contentPath,
        createdAt: bug.createdAt,
      }
    },
  })
}
