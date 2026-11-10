/**
 * Requirement-collection Agent prompt contract.
 *
 * The persona prefix lives in `cordis.patch.yml`, the create prefill in
 * `buildCreatePrompt({ kind: 'requirement' })` and the discussion prefill in
 * `buildRequirementDiscussionPrompt('design')`. This story freezes the
 * five-section skeleton the other four Agent stories copy, so the structure,
 * the boundary clauses, the prefill slimming and the pre-rewrite snapshot are
 * asserted here instead of being left to review.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

import { buildCreatePrompt } from '../src/create.ts'
import { buildRequirementDiscussionPrompt } from '../src/requirement-discussion.ts'

const patch = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8').replace(
  /\r\n/g,
  '\n',
)

/** Read the `persona.config.prefix` block of `preset-xirang-requirement`, dedented. */
function requirementPersonaPrefix(): string {
  const block = patch.slice(patch.indexOf('    - id: preset-xirang-requirement'))
  const prefixAt = block.indexOf('prefix: |-')
  assert.ok(prefixAt > 0, 'preset-xirang-requirement declares a persona prefix')
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

const prompt = requirementPersonaPrefix()

/** Assert every fragment appears in the prompt, failing with the missing one. */
function includesAll(fragments: string[]): void {
  for (const fragment of fragments) {
    assert.ok(prompt.includes(fragment), `prompt is missing: ${fragment}`)
  }
}

/** Numbered clauses (1., 2., ...) inside one section of the persona. */
function clauseNumbers(section: string): number[] {
  return section
    .split('\n')
    .map((line) => /^(\d+)\./.exec(line)?.[1])
    .filter((value): value is string => value !== undefined)
    .map(Number)
}

describe('xirang-requirement persona prompt', () => {
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

  it('keeps the outline in the requirement body and drops the confirmation gate', () => {
    includesAll([
      '需求与概要设计写在同一个正文里',
      '正文一旦有内容，用户就可以直接进入详细设计',
      '这里不需要确认、评审或定稿',
    ])
  })

  it('numbers 职责内 contiguously and keeps the title rule there', () => {
    const duty = prompt.slice(prompt.indexOf('## 职责内'), prompt.indexOf('## 不做'))
    assert.deepEqual(clauseNumbers(duty), [1, 2, 3, 4, 5])
    includesAll([
      '先用一两句话复述你对用户描述的理解',
      '标题由你根据描述归纳生成，不要向用户索要标题',
      '一次最多问 3 个问题',
    ])
  })

  it('states all six out-of-scope items', () => {
    includesAll([
      '不写代码，不做技术选型或实现细节设计。',
      '不撰写详细设计文档，也不修改已有详细设计文档。',
      '不拆分、不修改、不删除故事。',
      '不做评审结论，不宣称需求「已定稿 / 已批准」',
      '不替用户决定范围取舍与优先级',
      '不修改其它需求、故事、缺陷记录。',
    ])
  })

  it('stops for the five confirmation situations', () => {
    includesAll([
      '先按「结论 / 理由 / 影响 / 待办」给出摘要，用户确认后再写回',
      '用户要求跳过信息收集、直接保存时',
      '用户新说法与正文已有内容冲突时',
      '用户描述里包含两条以上互不相关、各自可独立验收的目标时',
      '用户要求写代码、写详细设计或拆故事时',
    ])
  })

  it('links the requirement session before reading it', () => {
    const linkAt = prompt.indexOf('teamflow_link_requirement_session')
    const readAt = prompt.indexOf('teamflow_get_requirement')
    assert.ok(linkAt > 0 && readAt > linkAt, 'link must precede get_requirement')
    includesAll(['本会话第一条回复必须先调用', '不要向用户索要编号', '不要假装已经读过正文'])
  })

  it('names both entry flows and the write-back tools', () => {
    includesAll([
      '## 新建需求（创建页入口）',
      '## 已有需求的讨论（需求详情页入口）',
      'teamflow_create_requirement',
      'teamflow_update_requirement',
    ])
  })

  it('keeps five input/output clauses and four prohibitions', () => {
    const io = prompt.slice(prompt.indexOf('# 输入输出约定'), prompt.indexOf('# 禁止事项'))
    assert.deepEqual(clauseNumbers(io), [1, 2, 3, 4, 5])
    const forbidden = prompt.slice(prompt.indexOf('# 禁止事项'))
    assert.deepEqual(clauseNumbers(forbidden), [1, 2, 3, 4])
    includesAll(['不声称读过没有读过的正文', '不要求用户手工粘贴文档内容'])
  })
})

describe('xirang-requirement prefill templates', () => {
  const requirementDraft = {
    kind: 'requirement' as const,
    workspaceId: 'ws-1',
    workspaceTitle: '团队工作台',
    description: '点击暂停后停止计时。',
  }

  it('keeps the create prefill to marker, workspace and supplement', () => {
    const prefill = buildCreatePrompt(requirementDraft)
    assert.equal(
      prefill,
      [
        '【创建需求】',
        '',
        '工作区：团队工作台（id: ws-1）',
        '',
        '我的补充：',
        '点击暂停后停止计时。',
      ].join('\n'),
    )
    assert.doesNotMatch(prefill, /标题/)
    assert.doesNotMatch(prefill, /概要设计|详细设计/)
    assert.doesNotMatch(prefill, /teamflow_/)
    assert.doesNotMatch(prefill, /用户描述/)
  })

  it('asks for the missing description instead of inventing one', () => {
    const prefill = buildCreatePrompt({ ...requirementDraft, description: '   ' })
    assert.match(prefill, /我的补充：\n（没有额外描述，请先询问。）$/)
  })

  it('keeps only the marker and the supplement slot in the design prefill', () => {
    const prefill = buildRequirementDiscussionPrompt()
    assert.equal(prefill, ['【继续讨论需求与概要设计】', '', '我的补充：'].join('\n'))
    assert.doesNotMatch(prefill, /teamflow_/)
    assert.doesNotMatch(prefill, /评审|定稿|确认/)
    assert.doesNotMatch(prefill, /req_/)
  })
})

describe('xirang-requirement pre-rewrite snapshot', () => {
  const snapshot = readFileSync(
    new URL('../docs/agent-prompt-snapshots/xirang-requirement.md', import.meta.url),
    'utf8',
  )

  it('keeps the old persona prefix verbatim', () => {
    assert.ok(snapshot.includes('工作方式：'))
    assert.ok(snapshot.includes('4. 当关键信息齐全，明确告诉用户「信息收集完成」'))
    assert.ok(snapshot.includes('8. 你只能使用 teamflow_* 工具和 ask_user_question'))
    assert.ok(snapshot.includes('不要调用文件、命令行、网络或子代理工具。'))
  })

  it('keeps both old prefills verbatim', () => {
    assert.ok(snapshot.includes('标题：请根据用户描述归纳生成，不要要求用户提供标题。'))
    assert.ok(snapshot.includes('用户描述：'))
    assert.ok(snapshot.includes('（用户没有填写额外描述，请先询问。）'))
    assert.ok(
      snapshot.includes(
        '先调用 teamflow_link_requirement_session 登记本会话，再调用 teamflow_get_requirement 读取需求正文（它同时也是概要设计）。',
      ),
    )
    assert.ok(snapshot.includes('需求和概要设计都写在这份正文里。只要正文有了内容，我随时可以开始详细设计'))
  })

  it('maps every migration row to a landing point', () => {
    const table = snapshot
      .slice(snapshot.indexOf('## 3.'), snapshot.indexOf('## 4.'))
      .split('\n')
      .filter(
        (line) =>
          line.startsWith('| ') &&
          !line.startsWith('| 出处') &&
          !line.startsWith('| ---'),
      )
    assert.equal(table.length, 9, '8 migration rows plus the retained prefill row')
    for (const row of table) {
      const cells = row
        .split('|')
        .slice(1, -1)
        .map((cell) => cell.trim())
      assert.equal(cells.length, 3, `row must have three cells: ${row}`)
      assert.ok((cells[0] ?? '').length > 0, `row has no source: ${row}`)
      assert.ok((cells[1] ?? '').length > 0, `row has no original sentence: ${row}`)
      assert.match(String(cells[2]), /##|预填/, `row has no landing point: ${row}`)
    }
  })
})
