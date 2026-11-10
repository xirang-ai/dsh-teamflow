/**
 * Document storage tests: bodies live in the workspace, the database only
 * remembers the address. Everything here runs against a real SQLite file and a
 * real temporary directory — no mocks.
 */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, it } from 'node:test'

import { openTeamflowDatabase, type TeamflowDatabase } from '../src/store/db.ts'
import { DOC_ROOT, docPath, ensureDocTree, readDoc, resolveDocPath } from '../src/store/docs.ts'

const directories: string[] = []
const handles: TeamflowDatabase[] = []

function workspace(): string {
  const dir = mkdtempSync(join(tmpdir(), 'teamflow-docs-'))
  directories.push(dir)
  return dir
}

function open(root: string): TeamflowDatabase {
  const dataDir = join(root, '.dsh')
  const handle = openTeamflowDatabase({
    dataDir,
    docsRoot: join(root, 'workspace'),
    version: '0.1.0',
    log: { info: () => {}, warn: () => {}, error: () => {} },
  })
  handles.push(handle)
  return handle
}

afterEach(() => {
  while (handles.length > 0) handles.pop()?.close()
  while (directories.length > 0) {
    const dir = directories.pop()
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  }
})

describe('document storage', () => {
  it('writes each document into the workspace and keeps only the path in SQLite', () => {
    const root = workspace()
    const handle = open(root)
    const workflow = handle.workflow
    const docs = join(root, 'workspace')

    const requirement = workflow.createRequirement({
      workspaceId: 'ws-tetris',
      title: '排行榜',
      summary: '展示前 10 名',
      content: '# 排行榜\n\n首页展示前 10 名。',
    })
    assert.equal(requirement.contentPath, docPath('requirement', { id: requirement.id }))
    assert.equal(
      readFileSync(join(docs, requirement.contentPath), 'utf8'),
      '# 排行榜\n\n首页展示前 10 名。\n',
    )

    workflow.updateRequirement(requirement.id, { content: '# 排行榜\n\n列表 + 分页，首页展示前 10 名。' })
    const doc = workflow.createDesignDoc({
      requirementId: requirement.id,
      title: '分页时序',
      kind: 'flow',
      content: '请求 → 渲染。',
    })
    const story = workflow.createStory({
      requirementId: requirement.id,
      title: '展示列表',
      content: '## 验收标准\n\n前 10 名倒序。',
    })

    assert.ok(existsSync(join(docs, requirement.contentPath)))
    assert.ok(existsSync(join(docs, doc.contentPath)))
    assert.ok(existsSync(join(docs, story.contentPath)))

    // The address round-trips through the database, the body does not.
    const row = handle.db.prepare('SELECT content_path FROM stories WHERE id = ?').get(story.id)
    assert.equal(String(row?.['content_path']), story.contentPath)
    const columns = handle.db
      .prepare('PRAGMA table_info(stories)')
      .all()
      .map((column) => String(column['name']))
    assert.ok(!columns.includes('description'))
    assert.ok(!columns.includes('acceptance_criteria'))
    assert.ok(!columns.includes('priority'))
    // sort_order is back as the explicit display position (schema v15).
    assert.ok(columns.includes('sort_order'))
  })

  it('rewrites the file when the body is updated and reads it back', () => {
    const root = workspace()
    const handle = open(root)
    const workflow = handle.workflow
    const docs = join(root, 'workspace')

    const story = workflow.createStory({ workspaceId: 'ws-p', title: '按钮错位', content: '旧内容' })
    workflow.updateStory(story.id, { content: '## 验收标准\n\n320px 下不重叠。' })
    assert.equal(
      readFileSync(join(docs, story.contentPath), 'utf8'),
      '## 验收标准\n\n320px 下不重叠。\n',
    )
    assert.equal(workflow.readContent('ws-p', story.contentPath), '## 验收标准\n\n320px 下不重叠。\n')

    workflow.writeContent('ws-p', story.contentPath, '外部改写\n')
    assert.equal(readFileSync(join(docs, story.contentPath), 'utf8'), '外部改写\n')
  })

  it('creates the document tree, its own ignore file and the workspace ignore entry', () => {
    const root = workspace()
    ensureDocTree(root)
    for (const dir of ['requirements', 'stories', 'bugs']) {
      assert.ok(existsSync(join(root, DOC_ROOT, dir)), `${dir} should exist`)
    }
    assert.equal(readFileSync(join(root, DOC_ROOT, '.gitignore'), 'utf8'), '*\n')
    assert.equal(readFileSync(join(root, '.gitignore'), 'utf8'), '.xirang-ai/\n')

    // Registering twice must not duplicate the ignore entry.
    ensureDocTree(root)
    assert.equal(readFileSync(join(root, '.gitignore'), 'utf8'), '.xirang-ai/\n')
  })

  it('appends to an existing workspace ignore file without dropping its rules', () => {
    const root = workspace()
    writeFileSync(join(root, '.gitignore'), 'node_modules/\ndist', 'utf8')
    ensureDocTree(root)
    assert.equal(readFileSync(join(root, '.gitignore'), 'utf8'), 'node_modules/\ndist\n.xirang-ai/\n')
  })

  it('refuses to write outside the workspace', () => {
    assert.throws(() => resolveDocPath('/tmp/ws', '../escape.md'), /must not traverse/)
    assert.throws(() => resolveDocPath('/tmp/ws', '/etc/passwd'), /workspace-relative/)
    assert.throws(() => resolveDocPath('/tmp/ws', 'C:/Windows/win.ini'), /workspace-relative/)
    assert.throws(() => resolveDocPath('/tmp/ws', 'C:\\Windows\\win.ini'), /workspace-relative/)
    assert.throws(() => resolveDocPath('/tmp/ws', '\\\\server\\share\\x.md'), /workspace-relative/)
    assert.throws(() => resolveDocPath('/tmp/ws', '..\\escape.md'), /workspace-relative/)
    assert.throws(() => resolveDocPath('/tmp/ws', 'a/../b.md'), /must not traverse/)
    assert.throws(() => resolveDocPath('/tmp/ws', 'a//b.md'), /must not traverse/)
    assert.throws(() => resolveDocPath('/tmp/ws', 'a\\0b.md'), /workspace-relative/)
  })

  it('tells a missing body apart from an empty body and an I/O failure', () => {
    const root = workspace()
    assert.equal(readDoc(root, 'missing.md'), null)

    writeFileSync(join(root, 'empty.md'), '', 'utf8')
    assert.equal(readDoc(root, 'empty.md'), '')

    mkdirSync(join(root, 'directory.md'))
    assert.throws(
      () => readDoc(root, 'directory.md'),
      /teamflow: cannot read document "directory\.md"/,
    )
  })

  it('keeps null and the empty string distinct through WorkflowStore.readContent', () => {
    const root = workspace()
    const handle = open(root)
    const workflow = handle.workflow
    const docs = join(root, 'workspace')

    const empty = workflow.createRequirement({
      workspaceId: 'ws-tetris',
      title: '空正文',
      content: '',
    })
    assert.equal(workflow.readContent(empty.workspaceId, empty.contentPath), '')

    const blank = workflow.createRequirement({ workspaceId: 'ws-tetris', title: '未写正文' })
    // Creating a record always materializes its file; an omitted body is an
    // empty document, not a missing one.
    assert.equal(workflow.readContent(blank.workspaceId, blank.contentPath), '')

    rmSync(join(docs, empty.contentPath))
    assert.equal(workflow.readContent(empty.workspaceId, empty.contentPath), null)
  })

  it('spawns the tree when a workspace is registered', () => {
    const root = workspace()
    const handle = open(root)
    const workdir = join(root, 'proj')
    handle.workflow.registerWorkspace('ws-proj', workdir)
    assert.ok(existsSync(join(workdir, DOC_ROOT, 'stories')))
    assert.equal(handle.workflow.workspacePath('ws-proj'), workdir)
  })
})
