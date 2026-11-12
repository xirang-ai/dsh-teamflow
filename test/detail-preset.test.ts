/**
 * Detailed-design Agent prompt contract.
 *
 * The persona prefix lives in `cordis.patch.yml` and the discussion prefill in
 * `buildRequirementDiscussionPrompt('detail')`. Both are text assets with no
 * runtime validator, so the prompt's skeleton, boundary clauses and the
 * pre-rewrite snapshot are asserted here.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

const patch = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8').replace(/\r\n/g, '\n')

/** Read the `persona.config.prefix` block of `preset-xirang-detail`, dedented. */
function detailPersonaPrefix(): string {
  const block = patch.slice(patch.indexOf('    - id: preset-xirang-detail'))
  const prefixAt = block.indexOf('prefix: |-')
  assert.ok(prefixAt > 0, 'preset-xirang-detail declares a persona prefix')
  const body = block.slice(prefixAt + 'prefix: |-'.length)
  const end = body.indexOf('          - id: teamflow-tools')
  assert.ok(end > 0, 'the persona prefix is followed by the tool rows')
  return body
    .slice(0, end)
    .split('\n')
    .map((line) => line.replace(/^ {16}/, ''))
    .join('\n')
    .trim()
}

const prompt = detailPersonaPrefix()

/** Assert every fragment appears in the prompt, failing with the missing one. */
function includesAll(fragments: string[]): void {
  for (const fragment of fragments) {
    assert.ok(prompt.includes(fragment), `prompt is missing: ${fragment}`)
  }
}

describe('xirang-detail persona prompt', () => {
  it('follows the frozen five-section skeleton in order', () => {
    const topLevel = prompt.split('\n').filter((line) => line.startsWith('# '))
    assert.deepEqual(topLevel, [
      '# 角色定位',
      '# 职责与边界',
      '# 工作流程',
      '# 输入输出约定',
      '# 禁止事项',
    ])
    const boundary = prompt
      .slice(prompt.indexOf('## 职责内'), prompt.indexOf('# 工作流程'))
      .split('\n')
      .filter((line) => line.startsWith('## '))
    assert.deepEqual(boundary, ['## 职责内', '## 不做', '## 需停下确认'])
    assert.doesNotMatch(prompt, /工作方式：/)
  })

  it('links the session and reads the requirement before anything else', () => {
    const linkAt = prompt.indexOf('teamflow_link_requirement_session')
    const readAt = prompt.indexOf('teamflow_get_requirement')
    assert.ok(linkAt >= 0 && readAt > linkAt, 'link must precede get_requirement')
    includesAll(['不要向用户索要编号', '不要假装已经读过正文'])
  })

  it('reads each detailed design by id without guessing or pretending', () => {
    includesAll([
      'teamflow_get_design_doc',
      '说明你选了哪几份',
      '不要猜文档 id',
      '不要声称读过没有读过的文档',
    ])
  })

  it('derives the document grain from kind without a confirmation gate', () => {
    includesAll([
      'kind 自动划分',
      'flow',
      'data',
      'interface',
      'page',
      'rule',
      '一份文档只讲一件事',
      '更新既有文档',
      '不要新建副本',
      '不设确认闸口',
    ])
  })

  it('confirms a conclusion summary before writing documents back', () => {
    includesAll([
      '结论 / 理由 / 影响 / 待办',
      '是否写回',
      'teamflow_update_design_doc',
      'teamflow_create_design_doc',
      'teamflow_delete_design_doc',
      '不可恢复',
    ])
    assert.match(prompt, /用户确认后才调用 teamflow_create_design_doc 或 teamflow_update_design_doc/)
    assert.match(prompt, /得到明确同意后才调用 teamflow_delete_design_doc/)
  })

  it('states all seven out-of-scope items', () => {
    includesAll([
      '不写代码，也不阅读仓库代码',
      '没有文件工具',
      '不逐条比对故事的验收标准',
      '你看不到故事正文',
      '不修改概要设计正文',
      '不拆分、不修改、不删除故事',
      '不做评审结论',
      '不替用户决定技术取舍',
      '不要求用户手工粘贴文档内容',
    ])
  })

  it('stops to confirm all five situations', () => {
    includesAll([
      '用户确认后才调用',
      '概要设计自相矛盾',
      '需求已完成、已归档或已取消',
      '用户要求改概设正文或拆故事',
      '用户要求跳过读取、直接写文档',
    ])
  })

  it('separates checking a story title from judging its acceptance criteria', () => {
    includesAll(['核对标题与编号', '不要评论故事的验收标准细节'])
  })
})

describe('xirang-detail pre-rewrite snapshot', () => {
  const snapshot = readFileSync(
    new URL('../docs/agent-prompt-snapshots/xirang-detail.md', import.meta.url),
    'utf8',
  )

  it('keeps the old persona prefix verbatim', () => {
    assert.ok(snapshot.includes('工作方式：'))
    assert.ok(snapshot.includes('8. 你只能使用 teamflow_* 工具和 ask_user_question'))
    assert.ok(snapshot.includes('文档、和用户逐项讨论并落盘修改'))
  })

  it('keeps the old discussion prefill verbatim', () => {
    assert.ok(
      snapshot.includes('先调用 teamflow_link_requirement_session 登记本会话，再调用 teamflow_get_requirement'),
    )
    assert.ok(snapshot.includes('不要在本会话里修改概要设计正文，也不要拆分故事。'))
  })
})
