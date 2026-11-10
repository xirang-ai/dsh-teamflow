/**
 * Pure path rules behind the design file tree and markdown cross-links. These
 * functions never touch the filesystem; the tests pin the edge cases that would
 * otherwise turn a link into a wrong jump (escapes, fragments, percent escapes).
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  basename,
  buildFileTree,
  designPath,
  normalizePath,
  relativeToDesign,
  resolveMarkdownHref,
} from '../src/client/files.ts'

const DESIGN = '.xirang-ai/dsh-teamflow/designs/des_pause/design.md'
const DOC = '.xirang-ai/dsh-teamflow/designs/des_pause/docs/doc_flow.md'

describe('path normalisation', () => {
  it('collapses dot segments and duplicate separators', () => {
    assert.equal(normalizePath('a/./b/../c'), 'a/c')
    assert.equal(normalizePath('a//b/'), 'a/b')
    assert.equal(normalizePath('a\\b\\c'), 'a/b/c')
    assert.equal(normalizePath('/a/b'), '/a/b')
  })

  it('refuses a path that escapes the root', () => {
    assert.equal(normalizePath('../a'), null)
    assert.equal(normalizePath('a/../../b'), null)
  })

  it('reads the last segment and its parent', () => {
    assert.equal(basename(DOC), 'doc_flow.md')
    assert.equal(basename('design.md'), 'design.md')
    assert.equal(designPath(DESIGN, 'docs/doc_flow.md'), DOC)
    assert.equal(relativeToDesign(DESIGN, DOC), 'docs/doc_flow.md')
    assert.equal(relativeToDesign(DESIGN, '.xirang-ai/dsh-teamflow/designs/other/design.md'), null)
  })
})

describe('markdown link resolution', () => {
  it('resolves relative links against the containing file', () => {
    assert.equal(resolveMarkdownHref(DOC, '../design.md'), DESIGN)
    assert.equal(resolveMarkdownHref(DOC, 'doc_rule.md#rules'), `${DOC.slice(0, -'doc_flow.md'.length)}doc_rule.md`)
    assert.equal(resolveMarkdownHref(DOC, './doc_data.md?plain=1'), `${DOC.slice(0, -'doc_flow.md'.length)}doc_data.md`)
  })

  it('decodes percent escapes used by generated documents', () => {
    assert.equal(
      resolveMarkdownHref(DOC, './%E6%9A%82%E5%81%9C.md'),
      `${DOC.slice(0, -'doc_flow.md'.length)}暂停.md`,
    )
  })

  it('leaves external URLs, anchors and misses to the caller', () => {
    assert.equal(resolveMarkdownHref(DOC, 'https://example.com/a.md'), null)
    assert.equal(resolveMarkdownHref(DOC, 'mailto:a@example.com'), null)
    assert.equal(resolveMarkdownHref(DOC, '#section'), null)
    assert.equal(resolveMarkdownHref(DOC, ''), null)
  })
})

describe('file tree assembly', () => {
  it('keeps insertion order and nests documents under their folders', () => {
    const tree = buildFileTree(DESIGN, [DESIGN, DOC, '.xirang-ai/dsh-teamflow/designs/des_pause/docs/doc_rule.md'])
    assert.deepEqual(tree.map((node) => node.name), ['design.md', 'docs'])
    const outline = tree[0]
    assert.equal(outline?.isFile, true)
    assert.equal(outline?.relative, 'design.md')
    assert.equal(outline?.path, DESIGN)
    const docs = tree[1]
    assert.equal(docs?.isFile, false)
    assert.deepEqual(docs?.children.map((node) => node.name), ['doc_flow.md', 'doc_rule.md'])
    assert.equal(docs?.children[0]?.path, DOC)
  })

  it('treats missing paths from an older host snapshot as absent', () => {
    assert.equal(normalizePath(undefined), null)
    assert.equal(normalizePath(null), null)
    assert.equal(relativeToDesign(undefined, DOC), null)
    assert.equal(relativeToDesign(DESIGN, undefined), null)
    assert.deepEqual(buildFileTree(undefined, [DESIGN]), [])
    const tree = buildFileTree(DESIGN, [undefined, null, DOC])
    assert.deepEqual(tree.map((node) => node.name), ['docs'])
  })

  it('ignores files from another design and duplicate entries', () => {
    const tree = buildFileTree(DESIGN, [
      DESIGN,
      DESIGN,
      '.xirang-ai/dsh-teamflow/designs/des_other/design.md',
      '.xirang-ai/dsh-teamflow/stories/sty_pause/story.md',
    ])
    assert.deepEqual(tree.map((node) => node.name), ['design.md'])
  })
})
