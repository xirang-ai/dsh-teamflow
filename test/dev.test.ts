/**
 * Development hand-off tests: the preset id and the two task sheets are the
 * whole contract between the board buttons and the Agent that closes the run,
 * so both are asserted directly instead of through the UI.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

import {
  DEV_PRESET,
  buildBugDevPrompt,
  buildDevPrompt,
  type DevBugBrief,
  type DevStoryBrief,
} from '../src/dev.ts'

/** A story with every field the prompt reads. */
function story(overrides: Partial<DevStoryBrief> = {}): DevStoryBrief {
  return {
    id: 'sty_pause',
    title: '暂停按钮',
    acceptance: ['点击暂停后计时停止', '再次点击后继续计时'],
    ...overrides,
  }
}

/** A defect with every field the fix prompt reads. */
function bug(overrides: Partial<DevBugBrief> = {}): DevBugBrief {
  return {
    id: 'bug_timer',
    title: '暂停后计时不停',
    severity: 'major',
    body: '点击暂停后计时器继续走。',
    ...overrides,
  }
}

describe('dev preset', () => {
  it('is the preset declared in the bundle patch with the run tools', () => {
    assert.equal(DEV_PRESET, 'xirang-dev')
    const patch = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
    assert.match(patch, /id: xirang-dev/)
    assert.match(patch, /profile: dev/)
  })
})

describe('buildDevPrompt', () => {
  it('is exactly the seven-line story task sheet', () => {
    assert.equal(
      buildDevPrompt(story()),
      [
        '【开始研发】',
        '',
        '执行故事 sty_pause《暂停按钮》',
        '所属：独立故事',
        '验收标准：',
        '1. 点击暂停后计时停止',
        '2. 再次点击后继续计时',
      ].join('\n'),
    )
  })

  it('names the upstream requirement when the story has one', () => {
    const prompt = buildDevPrompt(story(), { id: 'req_pause', title: '暂停需求' })
    assert.match(prompt, /所属：暂停需求（req_pause）/)
    assert.doesNotMatch(prompt, /独立故事/)
  })

  it('keeps the marker, id, parent and acceptance only — no procedure', () => {
    const prompt = buildDevPrompt(story())
    assert.equal(prompt.split('\n').length, 7)
    assert.doesNotMatch(prompt, /teamflow_|AGENTS\.md|执行要求/)
    assert.doesNotMatch(prompt, /工作台已经记录|不要新建或修改/)
    assert.doesNotMatch(prompt, /^## /m)
  })
})

describe('buildBugDevPrompt', () => {
  it('is exactly the six-line defect task sheet', () => {
    assert.equal(
      buildBugDevPrompt(bug()),
      [
        '【开始修复】',
        '',
        '修复缺陷 bug_timer《暂停后计时不停》',
        '严重程度：major',
        '缺陷描述：',
        '点击暂停后计时器继续走。',
      ].join('\n'),
    )
  })

  it('falls back to the title when the body is empty', () => {
    const prompt = buildBugDevPrompt(bug({ body: '   ' }))
    assert.match(prompt, /缺陷描述：\n暂停后计时不停$/)
    assert.equal(prompt.split('\n').length, 6)
  })

  it('keeps the marker, id, severity and description only — no procedure', () => {
    const prompt = buildBugDevPrompt(bug())
    assert.doesNotMatch(prompt, /teamflow_|执行要求/)
    assert.doesNotMatch(prompt, /工作台已经记录|不要新建或修改/)
    assert.doesNotMatch(prompt, /^## /m)
  })
})
