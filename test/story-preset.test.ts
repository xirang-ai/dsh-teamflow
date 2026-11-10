/**
 * Story-splitting Agent prompt contract.
 *
 * The persona prefix lives in `cordis.patch.yml`, the create prefill in
 * `buildCreatePrompt({ kind: 'story' })` and the discussion prefill in
 * `buildRequirementDiscussionPrompt('split')`. All three are text assets with
 * no runtime validator, so the skeleton, the boundary clauses, the prefill
 * slimming and the pre-rewrite snapshot are asserted here.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

import { buildCreatePrompt } from '../src/create.ts'
import { buildRequirementDiscussionPrompt } from '../src/requirement-discussion.ts'

const patch = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')

/** Read the `persona.config.prefix` block of `preset-xirang-story`, dedented. */
function storyPersonaPrefix(): string {
  const block = patch.slice(patch.indexOf('    - id: preset-xirang-story'))
  const prefixAt = block.indexOf('prefix: |-')
  assert.ok(prefixAt > 0, 'preset-xirang-story declares a persona prefix')
  const body = block.slice(prefixAt + 'prefix: |-'.length)
  const end = body.indexOf('          - id: teamflow-tools')
  assert.ok(end > 0, 'the persona prefix is followed by the tool rows')
  return body
    .slice(0, end)
    .split('\n')
    .map((line) => line.replace(/^ {16}/, '').replace(/\r$/, ''))
    .join('\n')
    .trim()
}

const prompt = storyPersonaPrefix()

/** Assert every fragment appears in the prompt, failing with the missing one. */
function includesAll(fragments: string[]): void {
  for (const fragment of fragments) {
    assert.ok(prompt.includes(fragment), `prompt is missing: ${fragment}`)
  }
}

describe('xirang-story persona prompt', () => {
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

  it('numbers 职责内 contiguously and keeps the standalone-story rule', () => {
    const duty = prompt.slice(prompt.indexOf('## 职责内'), prompt.indexOf('## 不做'))
    const numbers = duty
      .split('\n')
      .map((line) => /^(\d+)\./.exec(line)?.[1])
      .filter((value): value is string => value !== undefined)
    assert.deepEqual(
      numbers.map((value) => Number(value)),
      [1, 2, 3, 4, 5, 6, 7],
    )
    assert.doesNotMatch(prompt, /\b3a\b/)
    // The original 3a clause survives inside one numbered clause, not as a patch number.
    includesAll(['可以没有上游需求', '也可以没有详细设计', '不要为了完整性强行关联父需求'])
  })

  it('gates story creation behind a listed split plan', () => {
    includesAll([
      '先把拆分方案列出来',
      '标题、目标、验收标准要点、规模',
      '等用户确认后再逐条调用 teamflow_create_story 落库',
      '用户明确说「直接建」时才可跳过',
    ])
    const gateAt = prompt.indexOf('先把拆分方案列出来')
    const createAt = prompt.indexOf('teamflow_create_story', gateAt)
    assert.ok(gateAt > 0 && createAt > gateAt, 'the plan gate must precede the create call')
  })

  it('derives the story grain from a business-function loop, xl by default', () => {
    includesAll([
      '业务功能闭环',
      '默认规模为 xl',
      '只有两种情况才继续往下拆',
      '该业务闭环本身已超出 xl 能承载的范围',
      '用户明确要求更小的颗粒',
      '不接受把同一个业务闭环切成前后半截',
    ])
  })

  it('states all six out-of-scope items', () => {
    includesAll([
      '不写代码，不做技术方案或实现细节设计',
      '不修改需求正文（概要设计）',
      '不撰写、不修改详细设计文档',
      '不替用户决定优先级、排期与人力安排',
      '不把一条需求整包成一条故事',
      '不把同一业务闭环切成半截故事',
      '不修改其它需求与缺陷记录',
    ])
  })

  it('deletes one story per confirmation and refuses bulk confirmation', () => {
    includesAll([
      '先用 teamflow_get_story 确认标题与状态',
      '（编号 + 标题 + 状态）',
      '逐条得到明确确认后才调用 teamflow_delete_story',
      '不允许一次确认删多条',
      '如实转述拒绝原因',
      '不要绕道新建替代',
    ])
  })

  it('links the requirement session in the first reply of a discussion', () => {
    const firstReply = '本会话第一条回复先调用 teamflow_link_requirement_session'
    const linkAt = prompt.indexOf(firstReply)
    const readAt = prompt.indexOf('teamflow_get_requirement', linkAt)
    assert.ok(linkAt > 0, 'the discussion flow starts by linking the session')
    assert.ok(readAt > linkAt, 'link must precede reading the requirement')
    includesAll([firstReply, '不要猜 id'])
  })

  it('shows id, title, status, size and parent after saving', () => {
    includesAll(['展示编号、标题、状态、规模与父级关系'])
  })
})

describe('xirang-story prefill templates', () => {
  const storyDraft = {
    kind: 'story' as const,
    workspaceId: 'ws-1',
    workspaceTitle: '团队工作台',
    description: '做一个计时器',
  }

  it('keeps the create prefill to marker, workspace and supplement', () => {
    const prefill = buildCreatePrompt(storyDraft)
    assert.equal(
      prefill,
      ['【创建故事】', '', '工作区：团队工作台（id: ws-1）', '', '我的补充：', '做一个计时器'].join('\n'),
    )
    assert.doesNotMatch(prefill, /标题/)
    assert.doesNotMatch(prefill, /teamflow_/)
    assert.doesNotMatch(prefill, /概要设计|详细设计/)
  })

  it('asks for the missing description instead of inventing one', () => {
    const prefill = buildCreatePrompt({ ...storyDraft, description: '   ' })
    assert.match(prefill, /我的补充：\n（没有额外描述，请先询问。）$/)
  })

  it('keeps only the marker and the supplement slot in the split prefill', () => {
    const prefill = buildRequirementDiscussionPrompt('split')
    assert.equal(prefill, ['【继续讨论故事拆分】', '', '我的补充：'].join('\n'))
    assert.doesNotMatch(prefill, /teamflow_/)
    assert.doesNotMatch(prefill, /概要设计|详细设计/)
  })
})

describe('xirang-story pre-rewrite snapshot', () => {
  const snapshot = readFileSync(
    new URL('../docs/agent-prompt-snapshots/xirang-story.md', import.meta.url),
    'utf8',
  )

  it('keeps the old persona prefix verbatim', () => {
    assert.ok(snapshot.includes('工作方式：'))
    assert.ok(snapshot.includes('3a. 直接从一句话创建的故事可以没有上游需求和详细设计'))
    assert.ok(snapshot.includes('10. 你只能使用 teamflow_* 工具和 ask_user_question'))
  })

  it('keeps both old prefills verbatim', () => {
    assert.ok(snapshot.includes('标题：请根据用户描述归纳生成，不要要求用户提供标题。'))
    assert.ok(
      snapshot.includes('故事创建后即可进入开发，不依赖概要设计或详细设计；没有上游需求时不要强行关联。'),
    )
    assert.ok(snapshot.includes('先把拆分方案（每条故事的标题、目标与验收标准要点）列出来给我确认'))
    assert.ok(snapshot.includes('不要在本会话里修改概要设计正文或详设文档。'))
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
    assert.equal(table.length, 9, '8 migration rows plus the retained supplement row')
    for (const row of table) {
      const cells = row
        .split('|')
        .slice(1, -1)
        .map((cell) => cell.trim())
      assert.equal(cells.length, 3, `row must have three cells: ${row}`)
      assert.ok((cells[2] ?? '').length > 0, `row has no landing point: ${row}`)
      assert.match(String(cells[2]), /##|预填/)
    }
  })
})
