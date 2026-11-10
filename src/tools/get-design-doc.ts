/**
 * `teamflow_get_design_doc` — read one detailed-design document by id.
 *
 * `teamflow_get_requirement` returns the document list (id, title, kind, path)
 * but not the bodies: a requirement may own many documents, and inlining all of
 * them would turn every discussion opener into a context bomb. This tool is the
 * per-document read the Agent calls once it knows which document the user wants
 * to discuss.
 *
 * @module
 */
import { defineTool } from '@deepseek-ai/dsh-tools'

import type { WorkflowStore } from '../store/workflow.ts'
import { clip, type ToolEnvironment } from './shared.ts'

/** One detailed-design document as the model reads it. */
export interface DesignDocDetail {
  readonly id: string
  readonly requirementId: string
  readonly title: string
  readonly kind: string
  readonly sortOrder: number
  readonly contentPath: string
  readonly body: string
  /** True when the body file does not exist; `body` is then `''`. */
  readonly bodyMissing: boolean
}

/** Largest body the tool returns before clipping, in characters. */
const MAX_BODY_CHARS = 120_000

/**
 * Read one detailed-design document and its body.
 *
 * Pure store logic behind `teamflow_get_design_doc`, so the workspace path and
 * the missing-row cases are unit-testable without a Host context.
 * @param workflow - the open workbench store.
 * @param rawId - document id, trimmed before lookup.
 * @returns the document metadata plus its Markdown body, clipped to a safe size.
 */
export function readDesignDoc(workflow: WorkflowStore, rawId: string): DesignDocDetail {
  const id = rawId.trim()
  if (id.length === 0) throw new Error('teamflow: 详细设计 id 不能为空。')
  const doc = workflow.getDesignDoc(id)
  if (doc === null) throw new Error(`teamflow: 详细设计 ${id} 不存在，无法读取正文。`)
  const requirement = workflow.getRequirement(doc.requirementId)
  if (requirement === null) {
    throw new Error(`teamflow: 详细设计 ${id} 所属的需求 ${doc.requirementId} 不存在。`)
  }
  const body = workflow.readContent(requirement.workspaceId, doc.contentPath)
  return {
    id: doc.id,
    requirementId: doc.requirementId,
    title: doc.title,
    kind: doc.kind,
    sortOrder: doc.sortOrder,
    contentPath: doc.contentPath,
    body: clip(body ?? '', MAX_BODY_CHARS),
    bodyMissing: body === null,
  }
}

/** Build the detailed-design reading tool bound to one Host context. */
export function getDesignDocTool(environment: ToolEnvironment) {
  return defineTool({
    name: 'teamflow_get_design_doc',
    description:
      'Read one detailed-design document (title, kind, path and full Markdown body) by its id. Call teamflow_get_requirement first to list the document ids; use this before discussing or revising that document.',
    parameters: {
      id: {
        type: 'string',
        required: true,
        description: 'Document id from teamflow_get_requirement, for example doc_... .',
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
          kind: { type: 'string', required: true },
          sortOrder: { type: 'number', required: true },
          contentPath: { type: 'string', required: true },
          body: { type: 'string', required: true },
          bodyMissing: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => [
        {
          type: 'text',
          text: [
            `详细设计 ${value.id}《${value.title}》（${value.kind}），所属需求 ${value.requirementId}`,
            `文档：${value.contentPath}`,
            '',
            value.bodyMissing
              ? `（正文文件不存在：${value.contentPath}。请确认文件是否被移动或删除，不要把它当成空内容。）`
              : value.body.trim().length > 0
                ? value.body
                : '（文档正文为空，可以先和用户确认要写什么。）',
          ].join('\n'),
        },
      ],
    },
    async execute(args, exec) {
      exec.signal.throwIfAborted()
      return readDesignDoc(environment.database.workflow, args.id)
    },
  })
}
