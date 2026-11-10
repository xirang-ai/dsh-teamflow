/**
 * Shared plumbing for the teamflow tools.
 *
 * The tools are mounted inside each interviewer preset, not by the main Host
 * plugin, so they must find the workbench database and the session's
 * workspace on their own. Everything here is resolved per call: a preset can
 * outlive a Host reload, and a tool must never capture a database handle that
 * has been closed.
 *
 * @module
 */
import { realpathSync } from 'node:fs'
import { basename, resolve, sep } from 'node:path'

import type { Context } from '@deepseek-ai/cordis'

import type { TeamflowDatabase } from '../store/db.ts'

/** A workspace as the tools expose it to the model. */
export interface WorkspaceRef {
  readonly id: string
  readonly title: string
  readonly path: string
}

/** Per-call services the tool bodies share. */
export interface ToolEnvironment {
  /** The live workbench database; throws a contextual error when absent. */
  readonly database: TeamflowDatabase
  /** Every workspace the Host registry and the database know about. */
  workspaces(): readonly WorkspaceRef[]
  /** Resolve the workspace for one call, or throw with the available list. */
  resolveWorkspace(hint: string | undefined, cwd: string | undefined): WorkspaceRef
  /** Persist the directory before the first document write. */
  touch(workspace: WorkspaceRef): void
}

/** Resolve a path to its physical form, falling back to the lexical path. */
export function canonicalPath(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return resolve(path)
  }
}

/** True when `child` is `parent` or lives below it. */
function isInside(child: string, parent: string): boolean {
  if (child === parent) return true
  const prefix = parent.endsWith(sep) ? parent : `${parent}${sep}`
  return child.startsWith(prefix)
}

/** Trim a model-supplied string to a context-safe size, marking the cut. */
export function clip(text: string, max: number): string {
  const value = text.trim()
  if (value.length <= max) return value
  return `${value.slice(0, max)}\n\n…（内容超过 ${max} 字符，已截断）`
}

/** First non-empty line, used as a fallback summary. */
export function firstParagraph(text: string, max = 280): string {
  const value = text.trim()
  if (value.length === 0) return ''
  const paragraph = value.split(/\n\s*\n/)[0] ?? value
  return clip(paragraph.replace(/\s+/g, ' '), max)
}

/**
 * Build the per-call environment around one Host context.
 *
 * The returned functions resolve `ctx.teamflow` and the optional workspace
 * registry lazily; registering a tool happens long before either is needed.
 */
export function createToolEnvironment(ctx: Context): ToolEnvironment {
  const database = (): TeamflowDatabase => {
    const live = ctx.teamflow
    if (live === undefined) {
      throw new Error('teamflow: 工作台数据库尚未就绪，请稍后重试。')
    }
    return live
  }

  const workspaces = (): readonly WorkspaceRef[] => {
    const byId = new Map<string, WorkspaceRef>()
    const seenPaths = new Set<string>()

    const add = (id: string, path: string, title: string | undefined): void => {
      const cleanId = id.trim()
      const cleanPath = path.trim()
      if (cleanId.length === 0 || cleanPath.length === 0) return
      const canonical = canonicalPath(cleanPath)
      if (byId.has(cleanId) || seenPaths.has(canonical)) return
      seenPaths.add(canonical)
      byId.set(cleanId, {
        id: cleanId,
        title: (title ?? '').trim() || basename(canonical),
        path: canonical,
      })
    }

    for (const item of ctx.workspaceRegistry?.list?.() ?? []) {
      add(item.id, item.path, item.title)
    }

    try {
      const rows = database().db.prepare('SELECT workspace_id, path FROM workspaces ORDER BY updated_at DESC').all()
      for (const row of rows) add(String(row['workspace_id']), String(row['path']), undefined)
    } catch (error) {
      // A database opened before migrations ran has no `workspaces` table
      // yet; the registry rows collected above still resolve. Every other
      // failure is real and must reach the caller.
      if (!(error instanceof Error) || !/no such table/i.test(error.message)) throw error
    }

    return [...byId.values()]
  }

  const describeAvailable = (): string => {
    const items = workspaces()
    if (items.length === 0) return '当前没有可用工作区，请让用户在 DSH 中先打开一个工作区。'
    const shown = items.slice(0, 8).map((item) => `${item.id}（${item.title}）`)
    const suffix = items.length > shown.length ? ` 等 ${items.length} 个` : ''
    return `可用工作区：${shown.join('、')}${suffix}。`
  }

  const resolveWorkspace = (hint: string | undefined, cwd: string | undefined): WorkspaceRef => {
    const items = workspaces()
    const wanted = hint?.trim() ?? ''
    if (wanted.length > 0) {
      const byId = items.find((item) => item.id === wanted)
      if (byId !== undefined) return byId
      const canonical = canonicalPath(wanted)
      const byPath = items.find((item) => item.path === canonical)
      if (byPath !== undefined) return byPath
      const lowered = wanted.toLowerCase()
      const byTitle = items.find((item) => item.title.toLowerCase() === lowered)
      if (byTitle !== undefined) return byTitle
      throw new Error(`teamflow: 未找到工作区「${wanted}」。${describeAvailable()}`)
    }

    if (cwd !== undefined && cwd.trim().length > 0) {
      const canonical = canonicalPath(cwd.trim())
      let best: WorkspaceRef | undefined
      for (const item of items) {
        if (!isInside(canonical, item.path)) continue
        if (best === undefined || item.path.length > best.path.length) best = item
      }
      if (best !== undefined) return best
    }

    const only = items[0]
    if (items.length === 1 && only !== undefined) return only
    throw new Error(`teamflow: 无法从当前会话确定工作区，请显式传入 workspace 参数。${describeAvailable()}`)
  }

  return {
    get database() {
      return database()
    },
    workspaces,
    resolveWorkspace,
    touch: (workspace) => {
      database().workflow.registerWorkspace(workspace.id, workspace.path)
    },
  }
}

/** Render one canonical value as a single JSON text block. */
export function jsonResult(value: unknown): readonly { readonly type: 'text'; readonly text: string }[] {
  return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
}
