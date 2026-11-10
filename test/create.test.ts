/**
 * Create-flow prompt tests: the text that leaves the browser is the whole
 * hand-off between the Create page and the interviewer Agent, so its shape is
 * asserted directly instead of through the UI.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  CREATE_KINDS,
  CREATE_KIND_LABEL,
  CREATE_PRESET,
  buildCreatePrompt,
  isCreateKind,
  type CreateDraft,
} from '../src/create.ts'

/** A filled Create page draft. The title is not part of the form. */
function draft(overrides: Partial<CreateDraft> = {}): CreateDraft {
  return {
    kind: 'requirement',
    workspaceId: 'ws-1',
    workspaceTitle: '团队工作台',
    description: '点击暂停后停止计时。',
    ...overrides,
  }
}

describe('create kinds', () => {
  it('maps every kind to one preset and one tool', () => {
    assert.deepEqual([...CREATE_KINDS], ['requirement', 'story', 'bug'])
    assert.equal(CREATE_PRESET.requirement, 'xirang-requirement')
    assert.equal(CREATE_PRESET.story, 'xirang-story')
    assert.equal(CREATE_PRESET.bug, 'xirang-bug')
    assert.equal(CREATE_KIND_LABEL.bug, 'create.kind.bug')
    for (const kind of CREATE_KINDS) {
      assert.equal(typeof CREATE_KIND_LABEL[kind], 'string')
      assert.equal(isCreateKind(kind), true)
    }
    assert.equal(isCreateKind('design'), false)
  })
})

describe('buildCreatePrompt', () => {
  it('keeps the requirement prefill to the header, workspace and supplement slot', () => {
    const prompt = buildCreatePrompt(draft())
    assert.equal(
      prompt,
      ['【创建需求】', '', '工作区：团队工作台（id: ws-1）', '', '我的补充：', '点击暂停后停止计时。'].join(
        '\n',
      ),
    )
    assert.doesNotMatch(prompt, /标题/)
    assert.doesNotMatch(prompt, /用户描述/)
    assert.doesNotMatch(prompt, /概要设计/)
    assert.doesNotMatch(prompt, /teamflow_/)
    assert.match(
      buildCreatePrompt(draft({ description: '   ' })),
      /我的补充：\n（没有额外描述，请先询问。）/,
    )
  })

  it('keeps the story and bug templates bare, with no tool names', () => {
    for (const kind of ['story', 'bug'] as const) {
      const prompt = buildCreatePrompt(draft({ kind }))
      assert.match(prompt, /我的补充：/)
      assert.match(prompt, /点击暂停后停止计时。/)
      assert.doesNotMatch(prompt, /teamflow_/)
    }
    assert.match(buildCreatePrompt(draft({ kind: 'story' })), /【创建故事】/)
    assert.match(buildCreatePrompt(draft({ kind: 'bug' })), /【创建缺陷】/)
  })
})
