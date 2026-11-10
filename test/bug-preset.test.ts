/**
 * Defect-collection Agent prompt contract.
 *
 * The persona prefix lives in `cordis.patch.yml`; the create-page prefill is now
 * a bare template in `buildCreatePrompt({ kind: 'bug' })`, so the checking rules
 * must be asserted here once. The pre-rewrite snapshot is asserted as well, so a
 * future edit cannot silently lose the rollback baseline.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

const patch = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8').replace(/\r\n/g, '\n')

/** Read the `persona.config.prefix` block of `preset-xirang-bug`, dedented. */
function bugPersonaPrefix(): string {
  const block = patch.slice(patch.indexOf('    - id: preset-xirang-bug'))
  const prefixAt = block.indexOf('prefix: |-')
  assert.ok(prefixAt > 0, 'preset-xirang-bug declares a persona prefix')
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

const prompt = bugPersonaPrefix()

/** Assert every fragment appears in the prompt, failing with the missing one. */
function includesAll(fragments: string[]): void {
  for (const fragment of fragments) {
    assert.ok(prompt.includes(fragment), `prompt is missing: ${fragment}`)
  }
}

describe('xirang-bug persona prompt', () => {
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

  it('records partial descriptions as known / missing instead of refusing', () => {
    includesAll([
      '「已知」与「待补」',
      '信息不足仍要录入时',
      '缺日志或截图时提醒用户补充，但不因此拒绝录入',
      '缺复现步骤时不录入',
      'blocker 与 critical 例外',
    ])
    // The old first sentence contradicted the "do not block the flow" clause.
    assert.doesNotMatch(prompt, /只在信息足够定位和复现时记录缺陷/)
  })

  it('checks duplicates by list then body, never by title alone', () => {
    includesAll([
      'teamflow_list_records',
      '先列未完成（reported / fixing）',
      '再列已完成或不再修复的',
      'teamflow_get_bug',
      '不要只看标题',
      '不在未查重的情况下直接新建',
    ])
    assert.ok(
      prompt.indexOf('teamflow_list_records') < prompt.indexOf('teamflow_get_bug'),
      'list_records must come before get_bug',
    )
  })

  it('confirms a merge before writing into an existing defect', () => {
    includesAll([
      '合并前',
      '编号 + 标题',
      '补充哪些信息',
      '理由是什么',
      '等用户确认后再调用 teamflow_update_bug',
      '用户在本次会话中已明确指明合并目标时可以免问',
      '不在未确认的情况下把内容写进别人已有的缺陷记录',
    ])
  })

  it('stops to confirm all five situations', () => {
    includesAll([
      '合并前',
      '严重程度要跨档',
      '降到 trivial 或提到 blocker / critical',
      '信息不足但用户仍要求立即录入时',
      '两条现象明显不同的缺陷并成一条',
      '已完成 / 不再修复缺陷的结论',
    ])
  })

  it('states all six out-of-scope items', () => {
    includesAll([
      '不写修复代码，不做技术方案，不指定修复人、分支或排期',
      '不下根因定论',
      '不判断缺陷应该归属哪条需求或哪个故事',
      '不修改他人缺陷的严重程度与状态语义',
      '不做验收结论',
      '不修改需求、故事、详细设计记录',
    ])
  })

  it('carries the seven body fields and the three write tools', () => {
    includesAll([
      '故障现象',
      '影响范围',
      '环境与版本',
      '复现步骤',
      '期望结果',
      '实际结果',
      '严重程度',
      'teamflow_create_bug',
      'teamflow_update_bug',
      'teamflow_get_bug',
      '不得编造',
    ])
  })
})

describe('xirang-bug pre-rewrite snapshot', () => {
  const snapshot = readFileSync(new URL('../docs/agent-prompt-snapshots/xirang-bug.md', import.meta.url), 'utf8')

  it('keeps the old persona prefix verbatim', () => {
    assert.ok(snapshot.includes('只在信息足够定位和复现时记录缺陷'))
    assert.ok(snapshot.includes('但不要卡住整个流程。'))
    assert.ok(snapshot.includes('9. 你只能使用 teamflow_* 工具和 ask_user_question'))
  })

  it('keeps the old prefill verbatim', () => {
    assert.ok(snapshot.includes('标题：请根据用户描述归纳生成，不要要求用户提供标题。'))
    assert.ok(snapshot.includes('保存前先调用 teamflow_list_records 查看同一工作区已有的缺陷（包括已完成的）'))
    assert.ok(snapshot.includes('调用 teamflow_create_bug 工具保存'))
  })
})
