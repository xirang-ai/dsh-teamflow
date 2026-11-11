/**
 * `teamflow_get_story` — read one story and the detailed designs of the
 * requirement it belongs to.
 *
 * `teamflow_get_requirement` returns the story list but only ids, titles and
 * statuses: the body of `story.md` (description plus acceptance criteria) is
 * not inlined, because a requirement can own many stories. This is the
 * per-story read the splitting Agent calls before revising or deleting one,
 * and it also carries the parent requirement's detailed-design ids so the
 * Agent can read the design without a session binding.
 *
 * @module
 */
import { defineTool } from '@deepseek-ai/dsh-tools'

import type { WorkflowStore } from '../store/workflow.ts'
import { clip, type ToolEnvironment } from './shared.ts'

/** One detailed-design document as seen from a story. */
export interface StoryDesignDocRef {
  readonly id: string
  readonly title: string
  readonly kind: string
  readonly path: string
  /** True when the document explicitly declares that it covers this story. */
  readonly coversStory: boolean
}

/** One story as the model reads it. */
export interface StoryDetail {
  readonly id: string
  readonly title: string
  readonly status: string
  readonly size: string
  /** Display position under the parent requirement, ascending. */
  readonly sortOrder: number
  readonly workspaceId: string
  /** Empty for a standalone story. */
  readonly requirementId: string
  /** Empty for a standalone story. */
  readonly requirementTitle: string
  /** Empty for a standalone story. */
  readonly requirementStatus: string
  readonly contentPath: string
  readonly body: string
  /** True when the body file does not exist; `body` is then `''`. */
  readonly bodyMissing: boolean
  /** Detailed designs of the parent requirement; empty for a standalone story. */
  readonly designDocs: StoryDesignDocRef[]
  readonly createdAt: string
  readonly updatedAt: string
  /** Execution finished (last run succeeded); not completion. */
  readonly doneAt?: string
  /** User-confirmed completion. */
  readonly completedAt?: string
}

/** Largest body the tool returns before clipping, in characters. */
const MAX_BODY_CHARS = 120_000

/**
 * Read one story plus the detailed designs of its parent requirement.
 *
 * Pure store logic behind `teamflow_get_story`, so the missing-row cases are
 * unit-testable without a Host context.
 * @param workflow - the open workbench store.
 * @param rawId - story id, trimmed before lookup.
 * @returns the story metadata, its Markdown body and the parent design list.
 */
export function readStory(workflow: WorkflowStore, rawId: string): StoryDetail {
  const id = rawId.trim()
  if (id.length === 0) throw new Error('teamflow: 故事 id 不能为空。')
  const story = workflow.getStory(id)
  if (story === null) throw new Error(`teamflow: 故事 ${id} 不存在，无法读取正文。`)

  const requirement = story.requirementId === null ? null : workflow.getRequirement(story.requirementId)
  if (story.requirementId !== null && requirement === null) {
    throw new Error(`teamflow: 故事 ${id} 所属的需求 ${story.requirementId} 不存在。`)
  }

  const linked =
    requirement === null
      ? new Set<string>()
      : new Set(workflow.listStoryDesignDocs(story.id).map((doc) => doc.id))
  const designDocs =
    requirement === null
      ? []
      : workflow.listDesignDocs(requirement.id).map((doc) => ({
          id: doc.id,
          title: doc.title,
          kind: doc.kind,
          path: doc.contentPath,
          coversStory: linked.has(doc.id),
        }))

  const body = workflow.readContent(story.contentPath)

  return {
    id: story.id,
    title: story.title,
    status: story.status,
    size: story.size,
    sortOrder: story.sortOrder,
    workspaceId: story.workspaceId,
    requirementId: requirement?.id ?? '',
    requirementTitle: requirement?.title ?? '',
    requirementStatus: requirement?.status ?? '',
    contentPath: story.contentPath,
    body: clip(body ?? '', MAX_BODY_CHARS),
    bodyMissing: body === null,
    designDocs,
    createdAt: story.createdAt,
    updatedAt: story.updatedAt,
    ...(story.doneAt === null ? {} : { doneAt: story.doneAt }),
    ...(story.completedAt === null ? {} : { completedAt: story.completedAt }),
  }
}

/** Build the story reading tool bound to one Host context. */
export function getStoryTool(environment: ToolEnvironment) {
  return defineTool({
    name: 'teamflow_get_story',
    description:
      'Read one story by id: title, status, size, the full Markdown body (description and acceptance criteria), and the detailed-design documents of its parent requirement. Use it before revising or deleting a story, or when the user asks what an existing story says.',
    parameters: {
      story: {
        type: 'string',
        required: true,
        description: 'story id from teamflow_get_requirement or teamflow_create_story, for example sty_... .',
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
          workspaceId: { type: 'string', required: true },
          requirementId: { type: 'string', required: true },
          requirementTitle: { type: 'string', required: true },
          requirementStatus: { type: 'string', required: true },
          contentPath: { type: 'string', required: true },
          body: { type: 'string', required: true },
          bodyMissing: { type: 'boolean', required: true },
          designDocs: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                title: { type: 'string', required: true },
                kind: { type: 'string', required: true },
                path: { type: 'string', required: true },
                coversStory: { type: 'boolean', required: true },
              },
            },
          },
          createdAt: { type: 'string', required: true },
          updatedAt: { type: 'string', required: true },
          doneAt: { type: 'string' },
          completedAt: { type: 'string' },
        },
      },
      render: (_args, value) => {
        const maxListed = 40
        const lines = [
          `故事 ${value.id}《${value.title}》，状态 ${value.status}，规模 ${value.size}，排序 ${value.sortOrder}`,
          value.requirementId.length === 0
            ? '所属需求：独立故事（未挂需求）'
            : `所属需求：${value.requirementId}《${value.requirementTitle}》（${value.requirementStatus}）`,
          `文档：${value.contentPath}`,
          `详细设计：${value.designDocs.length} 份`,
          ...value.designDocs
            .slice(0, maxListed)
            .map(
              (doc) =>
                `- ${doc.id}《${doc.title}》（${doc.kind}）：${doc.path}${doc.coversStory ? '（覆盖本故事）' : ''}`,
            ),
        ]
        if (value.designDocs.length > maxListed) {
          lines.push(`（另有 ${value.designDocs.length - maxListed} 份详设未列出，结果已截断。）`)
        }
        lines.push(
          '',
          value.bodyMissing
            ? `（正文文件不存在：${value.contentPath}。请确认文件是否被移动或删除，不要把它当成空内容。）`
            : value.body.trim().length > 0
              ? value.body
              : '（故事正文为空，可以先和用户确认描述与验收标准。）',
        )
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute(args, exec) {
      exec.signal.throwIfAborted()
      return readStory(environment.database.workflow, args.story)
    },
  })
}
