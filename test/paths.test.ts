/**
 * Document-root resolution tests: the default sits next to the database, the
 * override accepts relative and `~/` forms, and malformed values fail loudly
 * with the field name instead of falling back.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, it } from 'node:test'

import { openTeamflowDatabase } from '../src/store/db.ts'
import {
  DOCS_DIRNAME,
  defaultDocsDir,
  ensureDocsDir,
  resolveDocsDir,
} from '../src/store/paths.ts'

const directories: string[] = []

function temp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'teamflow-paths-'))
  directories.push(dir)
  return dir
}

afterEach(() => {
  while (directories.length > 0) {
    const dir = directories.pop()
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  }
})

describe('document root resolution', () => {
  it('defaults to <dataDir>/docs', () => {
    const dataDir = join(temp(), 'data')
    assert.equal(DOCS_DIRNAME, 'docs')
    assert.equal(defaultDocsDir(dataDir), join(dataDir, 'docs'))
    assert.equal(resolveDocsDir('', dataDir), join(dataDir, 'docs'))
    assert.equal(resolveDocsDir(undefined, dataDir), join(dataDir, 'docs'))
    assert.equal(resolveDocsDir('   ', dataDir), join(dataDir, 'docs'))
  })

  it('expands ~/ and ~ and resolves relative paths against the working directory', () => {
    const dataDir = join(temp(), 'data')
    assert.equal(resolveDocsDir('~/teamflow-docs', dataDir), join(homedir(), 'teamflow-docs'))
    assert.equal(resolveDocsDir('~', dataDir), homedir())
    assert.equal(resolveDocsDir('relative/docs', dataDir), resolve('relative/docs'))
    assert.equal(resolveDocsDir('~teamflow', dataDir), resolve('~teamflow'))
    assert.equal(resolveDocsDir('/tmp/teamflow-docs', dataDir), '/tmp/teamflow-docs')
  })

  it('rejects malformed overrides with the field name and accepted forms', () => {
    const dataDir = join(temp(), 'data')
    const expected = /config "docsDir" must be an absolute path, a path relative to the working directory, or a path starting with "~\/"/
    assert.throws(() => resolveDocsDir('~/bad\u0000dir', dataDir), expected)
  })

  it('rejects an override that is already a file', () => {
    const dataDir = join(temp(), 'data')
    const file = join(temp(), 'not-a-directory')
    writeFileSync(file, '', 'utf8')
    assert.throws(
      () => resolveDocsDir(file, dataDir),
      /config "docsDir" must point to a directory, but .* is a file/,
    )
  })

  it('creates the root when missing and accepts an existing directory', () => {
    const root = join(temp(), 'nested', 'docs')
    assert.equal(ensureDocsDir(root), root)
    assert.ok(statSync(root).isDirectory())
    assert.equal(ensureDocsDir(root), root)
  })

  it('fails plugin startup on a bad docsDir instead of silently using the default', () => {
    const dataDir = join(temp(), 'data')
    const file = join(temp(), 'docs-file')
    writeFileSync(file, '', 'utf8')
    assert.throws(
      () =>
        openTeamflowDatabase({
          dataDir,
          docsDir: file,
          version: '0.1.0',
          log: { info: () => {}, warn: () => {}, error: () => {} },
        }),
      /config "docsDir" must point to a directory/,
    )
  })

  it('keeps the document root next to the database by default', () => {
    const dataDir = join(temp(), 'data')
    const handle = openTeamflowDatabase({
      dataDir,
      version: '0.1.0',
      log: { info: () => {}, warn: () => {}, error: () => {} },
    })
    try {
      assert.equal(handle.report.docsDir, join(dataDir, 'docs'))
      assert.ok(statSync(handle.report.docsDir).isDirectory())
    } finally {
      handle.close()
    }
  })
})
