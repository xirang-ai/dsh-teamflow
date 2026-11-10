/**
 * `teamflow_cancel_run` — abandon the active run without a verdict.
 *
 * Cancelling is for a run the Agent and the user agree to stop, not for a
 * failed self-test: a failed verdict goes through `teamflow_finish_run` so the
 * summary and notes stay on the record. A run belongs to either a story or a
 * defect, so the tool accepts exactly one of `story` / `bug`.
 *
 * @module
 */
import { defineTool } from '@deepseek-ai/dsh-tools'

import { activeRunFor, resolveSubject, subjectId, subjectStatus } from './run-shared.ts'
import type { ToolEnvironment } from './shared.ts'

/** Build the run-cancelling tool bound to one Host context. */
export function cancelRunTool(environment: ToolEnvironment) {
  return defineTool({
    name: 'teamflow_cancel_run',
    description:
      'Abandon the active development or fix run and return the subject to ready / reported without a self-test verdict. Pass exactly one of story / bug. Use it only when the work is genuinely stopped; a failed verification must use teamflow_finish_run instead.',
    parameters: {
      story: {
        type: 'string',
        description: 'story id from the development prompt, e.g. sty_abc123. Pass this or bug, not both.',
      },
      bug: {
        type: 'string',
        description: 'defect id from the fix prompt, e.g. bug_abc123. Pass this or story, not both.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          runId: { type: 'string', required: true },
          subjectKind: { type: 'string', required: true },
          subjectId: { type: 'string', required: true },
          runStatus: { type: 'string', required: true },
          subjectStatus: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [
        {
          type: 'text',
          text: `运行 ${value.runId} 已取消，${value.subjectKind === 'bug' ? '缺陷' : '故事'} ${value.subjectId} 回到 ${value.subjectStatus}。请向用户说明取消原因。`,
        },
      ],
    },
    async execute(args, exec) {
      exec.signal.throwIfAborted()
      const workflow = environment.database.workflow
      const subject = resolveSubject(workflow, args)
      const active = activeRunFor(workflow, subject)
      const run = workflow.cancelRun(active.id)
      return {
        runId: run.id,
        subjectKind: subject.kind,
        subjectId: subjectId(subject),
        runStatus: run.status,
        subjectStatus: subjectStatus(workflow, subject),
      }
    },
  })
}
