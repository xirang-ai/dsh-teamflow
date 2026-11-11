/**
 * Document storage tests: bodies live below the plugin's document root, the
 * database only remembers the root-relative address, and the user's workspace
 * is never touched. Everything here runs against a real SQLite file and real
 * temporary directories — no mocks.
 */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, it } from 'node:test'

import { openTeamflowDatabase, type TeamflowDatabase } from '../src/store/db.ts'
import { docPath, ensureDocTree, readDoc, resolveDocPath } from '../src/store/docs.ts'

const directories: string[] = []
const handles: TeamflowDatabase[] = []

function workspace(): string {
  const dir = mkdtempSync(join(tmpdir(), 'teamflow-docs-'))
  directories.push(dir)
  return dir
}

function open(dataDir: string, docsDir?: string): TeamflowDatabase {
  const handle = openTeamflowDatabase({
    dataDir,
    ...(docsDir === undefined ? {} : { docsDir }),
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
  it('writes every body under <dataDir>/docs and leaves the workspace clean by default', () => {
    const root = workspace()
    const dataDir = join(root, 'data')
    const workdir = join(root, 'proj')
    mkdirSync(workdir)
    writeFileSync(join(workdir, '.gitignore'), 'node_modules/\n', 'utf8')
    const handle = open(dataDir)
    const workflow = handle.workflow
    const docs = join(dataDir, 'docs')

    assert.equal(handle.report.docsDir, docs)
    workflow.registerWorkspace('ws-tetris', workdir)

    const requirement = workflow.createRequirement({
      workspaceId: 'ws-tetris',
      title: '排行榜',
      summary: '展示前 10 名',
      content: '# 排行榜\n\n首页展示前 10 名。',
    })
    assert.equal(requirement.contentPath, `requirements/${requirement.id}/requirement.md`)
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
    const bug = workflow.createBug({
      workspaceId: 'ws-tetris',
      title: '分页按钮错位',
      content: '## 复现\n\n点第二页。',
    })

    assert.equal(doc.contentPath, `requirements/${requirement.id}/docs/${doc.id}.md`)
    assert.equal(story.contentPath, `stories/${story.id}/story.md`)
    assert.equal(bug.contentPath, `bugs/${bug.id}/bug.md`)
    for (const path of [requirement.contentPath, doc.contentPath, story.contentPath, bug.contentPath]) {
      assert.ok(existsSync(join(docs, path)), `${path} should exist below the document root`)
    }

    // The workspace stays exactly as the user left it: no hidden tree, no
    // rewritten `.gitignore`.
    assert.ok(!existsSync(join(workdir, '.xirang-ai')))
    assert.equal(readFileSync(join(workdir, '.gitignore'), 'utf8'), 'node_modules/\n')

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

  it('honours a custom document root and reads back through it', () => {
    const root = workspace()
    const docs = join(root, 'teamflow-docs')
    const handle = open(join(root, '.dsh'), docs)
    const workflow = handle.workflow

    const story = workflow.createStory({ workspaceId: 'ws-p', title: '按钮错位', content: '旧内容' })
    assert.ok(existsSync(join(docs, story.contentPath)))

    workflow.updateStory(story.id, { content: '## 验收标准\n\n320px 下不重叠。' })
    assert.equal(
      readFileSync(join(docs, story.contentPath), 'utf8'),
      '## 验收标准\n\n320px 下不重叠。\n',
    )
    assert.equal(workflow.readContent(story.contentPath), '## 验收标准\n\n320px 下不重叠。\n')

    workflow.writeContent(story.contentPath, '外部改写\n')
    assert.equal(readFileSync(join(docs, story.contentPath), 'utf8'), '外部改写\n')
  })

  it('prepares only the shared document tree, never a workspace ignore file', () => {
    const root = workspace()
    ensureDocTree(root)
    for (const dir of ['requirements', 'stories', 'bugs']) {
      assert.ok(existsSync(join(root, dir)), `${dir} should exist`)
    }
    assert.ok(!existsSync(join(root, '.gitignore')))
    assert.ok(!existsSync(join(root, '.xirang-ai')))

    // Running it again is a no-op rather than an error.
    assert.deepEqual(ensureDocTree(root), [])
  })

  it('refuses to resolve outside the document root', () => {
    assert.throws(() => resolveDocPath('/tmp/docs', '../escape.md'), /must not traverse/)
    assert.throws(() => resolveDocPath('/tmp/docs', '/etc/passwd'), /document root/)
    assert.throws(() => resolveDocPath('/tmp/docs', 'C:/Windows/win.ini'), /document root/)
    assert.throws(() => resolveDocPath('/tmp/docs', 'C:\\Windows\\win.ini'), /document root/)
    assert.throws(() => resolveDocPath('/tmp/docs', '\\\\server\\share\\x.md'), /document root/)
    assert.throws(() => resolveDocPath('/tmp/docs', '..\\escape.md'), /document root/)
    assert.throws(() => resolveDocPath('/tmp/docs', 'a/../b.md'), /must not traverse/)
    assert.throws(() => resolveDocPath('/tmp/docs', 'a//b.md'), /must not traverse/)
    assert.throws(() => resolveDocPath('/tmp/docs', 'a\\0b.md'), /document root/)
    assert.equal(resolveDocPath('/tmp/docs', 'stories/sty_1/story.md'), '/tmp/docs/stories/sty_1/story.md')
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
    const docs = join(root, 'docs')
    const handle = open(join(root, '.dsh'), docs)
    const workflow = handle.workflow

    const empty = workflow.createRequirement({
      workspaceId: 'ws-tetris',
      title: '空正文',
      content: '',
    })
    assert.equal(workflow.readContent(empty.contentPath), '')

    const blank = workflow.createRequirement({ workspaceId: 'ws-tetris', title: '未写正文' })
    // Creating a record always materializes its file; an omitted body is an
    // empty document, not a missing one.
    assert.equal(workflow.readContent(blank.contentPath), '')

    rmSync(join(docs, empty.contentPath))
    assert.equal(workflow.readContent(empty.contentPath), null)
  })

  it('records a workspace path without creating anything inside it', () => {
    const root = workspace()
    const handle = open(join(root, '.dsh'))
    const workdir = join(root, 'proj')
    mkdirSync(workdir)
    handle.workflow.registerWorkspace('ws-proj', workdir)
    assert.equal(handle.workflow.workspacePath('ws-proj'), workdir)
    assert.ok(!existsSync(join(workdir, '.xirang-ai')))
    assert.ok(!existsSync(join(workdir, 'requirements')))
  })

  it('reads legacy workspace paths only under the new root and normalizes them once', () => {
    const root = workspace()
    const dataDir = join(root, '.dsh')
    const workdir = join(root, 'proj')
    mkdirSync(workdir)
    const docs = join(dataDir, 'docs')

    const first = open(dataDir)
    first.workflow.registerWorkspace('ws-legacy', workdir)
    const story = first.workflow.createStory({ workspaceId: 'ws-legacy', title: '旧文档', content: '正文\n' })
    const legacyPath = `.xirang-ai/dsh-teamflow/${story.contentPath}`
    first.db.prepare('UPDATE stories SET content_path = ? WHERE id = ?').run(legacyPath, story.id)

    // A decoy at the old workspace location must never be picked up.
    mkdirSync(join(workdir, '.xirang-ai/dsh-teamflow/stories', story.id), { recursive: true })
    writeFileSync(join(workdir, legacyPath), '工作区里的旧文档\n', 'utf8')

    assert.equal(first.workflow.getStory(story.id)?.contentPath, legacyPath)
    assert.equal(first.workflow.readContent(legacyPath), null)

    // Startup rewrites the stored path onto the document root; the body is
    // then readable at the new location and the decoy is untouched.
    first.close()
    const second = open(dataDir)
    const normalized = second.workflow.getStory(story.id)
    assert.equal(normalized?.contentPath, story.contentPath)
    assert.equal(second.workflow.readContent(normalized?.contentPath ?? ''), '正文\n')
    assert.equal(readFileSync(join(workdir, legacyPath), 'utf8'), '工作区里的旧文档\n')
    assert.ok(existsSync(join(docs, story.contentPath)))
  })
})
