/**
 * 文档落盘：正文不进 SQLite，只记工作区内的相对路径。
 *
 * 目录结构（相对工作区根）：
 *
 *   .xirang-ai/dsh-teamflow/
 *     requirements/<req_id>/requirement.md 需求 + 概要设计正文
 *     requirements/<req_id>/docs/<doc_id>.md 详细设计文档（一份需求可以有很多份）
 *     stories/<sty_id>/story.md            故事说明 + 验收标准
 *     bugs/<bug_id>/bug.md                 缺陷正文（描述、复现、期望、实际、环境）
 *
 * 所有写操作走「临时文件 + rename」，避免中途崩溃留下半截文档。
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, isAbsolute, join, posix, resolve, sep, win32 } from 'node:path'

import { describeError } from '../errors.ts'

/** 文档根目录名，工作区内的隐藏目录。 */
export const DOC_ROOT = '.xirang-ai/dsh-teamflow'

/** 文档种类：决定落盘路径。 */
export type DocKind = 'requirement' | 'designDoc' | 'story' | 'bug'

/**
 * 计算一份文档在工作区内的相对路径。
 *
 * @param kind - 文档种类
 * @param ids - 该种类需要的标识（designDoc 需要需求 id 与文档 id）
 * @returns 以 `/` 分隔的相对路径，直接可存库
 */
export function docPath(kind: DocKind, ids: { id: string; requirementId?: string }): string {
  const id = requireId(ids.id)
  switch (kind) {
    case 'requirement':
      return `${DOC_ROOT}/requirements/${id}/requirement.md`
    case 'story':
      return `${DOC_ROOT}/stories/${id}/story.md`
    case 'bug':
      return `${DOC_ROOT}/bugs/${id}/bug.md`
    case 'designDoc':
      return `${DOC_ROOT}/requirements/${requireId(ids.requirementId)}/docs/${id}.md`
  }
}

/**
 * 把相对路径拼到工作区根上；只接受插件自己生成的、以 `/` 分隔的工作区相对路径。
 *
 * 拒绝 POSIX 绝对路径、Windows 盘符/UNC/反斜杠路径与任何 `..`，最后再做一次
 * 词法 containment 校验，确保结果仍落在 `root` 之内。
 */
export function resolveDocPath(root: string, relative: string): string {
  if (relative.length === 0) throw new Error('teamflow: document path is empty')
  if (relative.includes('\0') || relative.includes('\\')) {
    throw new Error(`teamflow: document path must be workspace-relative, got "${relative}"`)
  }
  if (isAbsolute(relative) || win32.isAbsolute(relative) || /^[A-Za-z]:/.test(relative)) {
    throw new Error(`teamflow: document path must be workspace-relative, got "${relative}"`)
  }
  const segments = relative.split('/')
  if (segments.some((part) => part === '..' || part === '.' || part.length === 0)) {
    throw new Error(`teamflow: document path must not traverse, got "${relative}"`)
  }
  const base = resolve(root)
  const absolute = resolve(base, ...segments)
  if (absolute !== base && !absolute.startsWith(`${base}${sep}`)) {
    throw new Error(`teamflow: document path escapes the workspace, got "${relative}"`)
  }
  return absolute
}

/** 工作区路径 + 相对路径的展示形式（日志与工具结果用，始终 `/`）。 */
export function displayPath(relative: string): string {
  return relative.split(sep).join(posix.sep)
}

/**
 * 首次为一个工作区准备文档目录：建目录、写 `.gitignore`、必要时把 `.xirang-ai/`
 * 追加进工作区自己的 `.gitignore`。
 *
 * @param root - 工作区根目录（绝对路径）
 * @returns 实际创建的目录（相对路径），便于工具结果里说明
 */
export function ensureDocTree(root: string): string[] {
  const dirs = [
    `${DOC_ROOT}/requirements`,
    `${DOC_ROOT}/stories`,
    `${DOC_ROOT}/bugs`,
  ]
  const created: string[] = []
  for (const dir of dirs) {
    const absolute = resolveDocPath(root, dir)
    if (!existsSync(absolute)) {
      mkdirSync(absolute, { recursive: true })
      created.push(dir)
    }
  }

  const localIgnore = resolveDocPath(root, `${DOC_ROOT}/.gitignore`)
  if (!existsSync(localIgnore)) {
    writeFileSync(localIgnore, '*\n', 'utf8')
  }

  appendWorkspaceGitignore(root)
  return created
}

/**
 * 读取文档正文，区分三种结果：
 *
 * - 文件不存在 → `null`（新建实体还没写正文是正常状态）
 * - 文件存在但为空 → `''`
 * - 其他读取失败（权限、目录占位、编码错误等）→ 抛出带路径与原因的错误
 *
 * 调用方必须自己决定 `null` 与 `''` 的产品语义，不要合并成同一种“空”。
 */
export function readDoc(root: string, relative: string): string | null {
  const absolute = resolveDocPath(root, relative)
  try {
    return readFileSync(absolute, 'utf8')
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return null
    throw new Error(`teamflow: cannot read document "${displayPath(relative)}": ${describeError(error)}`, {
      cause: error,
    })
  }
}

/** 读取 fs 错误码；不是带 `code` 的对象时返回 `null`。 */
function errorCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null
  const code: unknown = Reflect.get(error, 'code')
  return typeof code === 'string' ? code : null
}

/** 以原子方式写入正文，自动建父目录。 */
export function writeDoc(root: string, relative: string, body: string): void {
  const absolute = resolveDocPath(root, relative)
  mkdirSync(dirname(absolute), { recursive: true })
  const temp = `${absolute}.tmp-${process.pid}`
  writeFileSync(temp, normalise(body), 'utf8')
  renameSync(temp, absolute)
}

/** 删除一份文档（实体被删或迁移到新路径时）。 */
export function removeDoc(root: string, relative: string): void {
  const absolute = resolveDocPath(root, relative)
  rmSync(absolute, { force: true })
}

/** 已挪出正式路径、等待随数据库事务一起确认删除的文档。 */
export interface StagedDoc {
  /** 原来的工作区相对路径；事务失败时据此还原。 */
  readonly relative: string
  /** 临时绝对路径，与正式文件同目录，保证 rename 是原子的。 */
  readonly staged: string
}

let stagedSequence = 0

/**
 * 把一份文档挪到同目录的临时名字下。
 *
 * 物理删除记录和删除文件跨两种介质，无法放进同一个事务。先把文件 `rename`
 * 到临时名，再在 SQLite 事务里删记录：事务失败就把文件改回来，事务成功才真正
 * `unlink`。这样任何时刻都不会出现「记录已经没了、正式路径上的文件还在」的悬挂态。
 *
 * @param root - 工作区根目录
 * @param relative - 文档的工作区相对路径
 * @returns 暂存信息；文件本来就不存在时返回 `null`
 */
export function stageDocDeletion(root: string, relative: string): StagedDoc | null {
  const absolute = resolveDocPath(root, relative)
  if (!existsSync(absolute)) return null
  stagedSequence += 1
  const staged = `${absolute}.deleting-${process.pid}-${stagedSequence}`
  renameSync(absolute, staged)
  return { relative, staged }
}

/** 事务失败时把暂存文件改回正式路径；临时文件已不在则视为已还原。 */
export function restoreStagedDoc(root: string, staged: StagedDoc): void {
  if (!existsSync(staged.staged)) return
  renameSync(staged.staged, resolveDocPath(root, staged.relative))
}

/**
 * 事务提交后真正删除暂存文件。
 * @returns 是否删除成功；调用方负责把失败写进日志（正式路径已经干净）。
 */
export function dropStagedDoc(staged: StagedDoc): boolean {
  try {
    rmSync(staged.staged, { force: true })
    return true
  } catch {
    return false
  }
}

/**
 * 自下而上删掉文档所在的空目录，直到文档根目录为止。
 *
 * 只删空目录：目录里还有别的东西时立刻停下，避免误删用户手工放进来的文件。
 */
export function pruneEmptyDirectories(root: string, relative: string): void {
  const boundary = resolveDocPath(root, DOC_ROOT)
  let directory = dirname(resolveDocPath(root, relative))
  // Stop before the shared `requirements/`, `stories/`, `bugs/` roots: those
  // belong to the workspace tree, not to the record being deleted.
  while (directory !== boundary && dirname(directory) !== boundary && directory.startsWith(`${boundary}${sep}`)) {
    try {
      if (readdirSync(directory).length > 0) return
      rmdirSync(directory)
    } catch {
      // ENOTEMPTY / ENOENT / 权限不足都意味着这里不该继续向上删；保留下次再试。
      return
    }
    directory = dirname(directory)
  }
}

/** 正文统一成「去掉行尾空白、以单个换行结尾」的形态，避免 diff 噪音。 */
export function normalise(body: string): string {
  const trimmed = body.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trimEnd()
  return trimmed.length === 0 ? '' : `${trimmed}\n`
}

/** 校验 id 片段只含安全字符，防止路径注入。 */
function requireId(id: string | undefined): string {
  if (id === undefined || !/^[A-Za-z0-9_-]+$/.test(id)) {
    throw new Error(`teamflow: invalid document id ${JSON.stringify(id)}`)
  }
  return id
}

/** 把 `.xirang-ai/` 追加到工作区 `.gitignore`；没有该文件就创建一个只含这一行的。 */
function appendWorkspaceGitignore(root: string): void {
  const ignore = join(root, '.gitignore')
  const entry = '.xirang-ai/'
  if (!existsSync(ignore)) {
    writeFileSync(ignore, `${entry}\n`, 'utf8')
    return
  }
  const current = readFileSync(ignore, 'utf8')
  const lines = current.split('\n').map((line) => line.trim())
  if (lines.includes(entry) || lines.includes('.xirang-ai')) return
  const suffix = current.endsWith('\n') || current.length === 0 ? '' : '\n'
  writeFileSync(ignore, `${current}${suffix}${entry}\n`, 'utf8')
}
