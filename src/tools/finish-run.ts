/**
 * `teamflow_finish_run` — close the active run with a self-test verdict.
 *
 * This is the write that moves a story to done (passed) or back to ready
 * (failed), and a defect to fixed or back to reported, so the result is
 * rendered with both statuses instead of a bare ok. A run belongs to either a
 * story or a defect, so the tool accepts exactly one of `story` / `bug`.
 *
 * @module
 */
import { defineTool } from '@deepseek-ai/dsh-tools'

import { activeRunFor, resolveSubject, subjectId, subjectLabel, subjectStatus } from './run-shared.ts'
import { clip, type ToolEnvironment } from './shared.ts'

const VERDICTS = ['passed', 'failed'] as const

/** Build the run-finishing tool bound to one Host context. */
export function finishRunTool(environment: ToolEnvironment) {
  return defineTool({
    name: 'teamflow_finish_run',
    description:
      'Finish the active run of one story or defect and write the self-test result back to the workbench. Pass exactly one of story / bug, using the id from the development prompt. passed moves a story to done or a defect to fixed; failed returns it to ready / reported for another attempt. A run that is still coding first moves through the self-test phase, so teamflow_begin_self_test is optional when you already have the verdict. Returns the run and subject statuses.',
    parameters: {
      story: {
        type: 'string',
        description: 'story id from the development prompt, e.g. sty_abc123. Pass this or bug, not both.',
      },
      bug: {
        type: 'string',
        description: 'defect id from the fix prompt, e.g. bug_abc123. Pass this or story, not both.',
      },
      selfTestStatus: {
        type: 'string',
        enum: VERDICTS,
        required: true,
        description: 'passed only when the verification actually ran and passed; otherwise failed.',
      },
      summary: {
        type: 'string',
        required: true,
        description: 'What changed and which checks were run, including their result. Keep it under a few sentences.',
      },
      selfTestNotes: {
        type: 'string',
        description: 'Failure reason, remaining issue or verification that could not be run.',
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
          selfTestStatus: { type: 'string', required: true },
          summary: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [
        {
          type: 'text',
          text: [
            `运行 ${value.runId} 已结束：自测 ${value.selfTestStatus}，${subjectLabel(value.subjectKind === 'bug' ? 'bug' : 'story')} ${value.subjectId} 状态 ${value.subjectStatus}。`,
            value.summary.length > 0 ? `摘要：${value.summary}` : '摘要为空。',
            value.selfTestStatus === 'failed'
              ? '对象已回到待处理队列；用户可以在工作台重新开始，或先处理失败原因。'
              : '执行已记录。成功只代表执行完毕，不代表任务完成；是否完成由用户在页面上确认。请把改动和验证结果简要汇报给用户。',
          ].join('\n'),
        },
      ],
    },
    async execute(args, exec) {
      exec.signal.throwIfAborted()
      const workflow = environment.database.workflow
      const subject = resolveSubject(workflow, args)
      const active = activeRunFor(workflow, subject)
      // A model that skipped teamflow_begin_self_test still has a real verdict.
      // Move the run through self_testing so finishRun's state machine holds.
      if (active.status === 'running') workflow.beginSelfTest(active.id)
      const summary = clip(args.summary, 4_000)
      if (summary.length === 0) throw new Error('teamflow: summary 不能为空，请写清改动与验证结果。')
      const run = workflow.finishRun({
        runId: active.id,
        selfTestStatus: args.selfTestStatus,
        summary,
        ...(args.selfTestNotes === undefined
          ? {}
          : { selfTestNotes: clip(args.selfTestNotes, 4_000) }),
      })
      return {
        runId: run.id,
        subjectKind: subject.kind,
        subjectId: subjectId(subject),
        runStatus: run.status,
        subjectStatus: subjectStatus(workflow, subject),
        selfTestStatus: run.selfTestStatus,
        summary: run.summary,
      }
    },
  })
}
