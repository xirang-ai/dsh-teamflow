/**
 * `teamflow_begin_self_test` — move the active run into self-testing.
 *
 * The store refuses to finish a run that never entered this stage, so the tool
 * exists separately from {@link teamflow_finish_run} rather than folding both
 * transitions into one call: the board can show "自测中" while the Agent is
 * actually running the checks. A run belongs to either a story or a defect, so
 * the tool accepts exactly one of `story` / `bug`.
 *
 * @module
 */
import { defineTool } from '@deepseek-ai/dsh-tools'

import { activeRunFor, resolveSubject, subjectId, subjectLabel, subjectStatus } from './run-shared.ts'
import type { ToolEnvironment } from './shared.ts'

/** Build the self-test transition tool bound to one Host context. */
export function beginSelfTestTool(environment: ToolEnvironment) {
  return defineTool({
    name: 'teamflow_begin_self_test',
    description:
      'Mark the active development or fix run as self-testing. Pass exactly one of story / bug, using the id from the development prompt. Call it after the implementation is complete and before running the verification. Calling it twice is harmless. Returns the run id and the new statuses.',
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
          text: [
            `${subjectLabel(value.subjectKind === 'bug' ? 'bug' : 'story')} ${value.subjectId} 已进入自测中（运行 ${value.runId}，状态 ${value.runStatus}）。`,
            '现在运行验证；结束后调用 teamflow_finish_run，传入同一个编号（story 或 bug）和 passed / failed。',
          ].join('\n'),
        },
      ],
    },
    async execute(args, exec) {
      exec.signal.throwIfAborted()
      const workflow = environment.database.workflow
      const subject = resolveSubject(workflow, args)
      const active = activeRunFor(workflow, subject)
      // Retried calls are normal after a dropped tool result; the store would
      // reject `self_testing -> self_testing`, so answer with the current row.
      const run = active.status === 'self_testing' ? active : workflow.beginSelfTest(active.id)
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
