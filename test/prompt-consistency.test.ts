/**
 * Cross-Agent prompt consistency contract.
 *
 * Every Agent persona lives in `cordis.patch.yml` as a
 * `@deepseek-ai/dsh-agent-preset` row with a `persona.config.prefix` block. The
 * five Agents share one skeleton and one set of boundary seams; those are
 * product decisions, so they are frozen here rather than left to review. The
 * report next to this test — `docs/agent-prompt-consistency.md` — records the
 * evidence behind each assertion.
 *
 * @module
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

import { CREATE_KINDS, buildCreatePrompt } from '../src/create.ts'
import { buildBugDevPrompt, buildDevPrompt } from '../src/dev.ts'
import { buildRequirementDiscussionPrompt } from '../src/requirement-discussion.ts'

const patch = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8').replace(
  /\r\n/g,
  '\n',
)

/** Top-level sections every persona must carry, in this order. */
const SKELETON = [
  '# 角色定位',
  '# 职责与边界',
  '# 工作流程',
  '# 输入输出约定',
  '# 禁止事项',
] as const

/** Sub-sections every `职责与边界` must carry, in this order. */
const BOUNDARY = ['## 职责内', '## 不做', '## 需停下确认'] as const

/** Sections that may never grow a sub-section; only `# 工作流程` may. */
const FLAT_SECTIONS = ['# 角色定位', '# 输入输出约定', '# 禁止事项'] as const

interface AgentCase {
  /** Preset id declared by `config.id` and used by `sessions.create()`. */
  readonly preset: string
  /** Preset display name, shown in the picker. */
  readonly title: string
  /** Tool profile the preset's `teamflow-tools` row selects. */
  readonly profile: string
}

/** The five Agents, in the order their stories were delivered (S1–S5). */
const AGENTS: readonly AgentCase[] = [
  { preset: 'xirang-requirement', title: '需求收集', profile: 'requirement' },
  { preset: 'xirang-story', title: '故事拆分', profile: 'split' },
  { preset: 'xirang-bug', title: '缺陷收集', profile: 'bug' },
  { preset: 'xirang-dev', title: '研发执行', profile: 'dev' },
  { preset: 'xirang-detail', title: '详细设计', profile: 'detail' },
]

/** One preset row of `cordis.patch.yml`. */
function presetBlock(preset: string): string {
  const start = patch.indexOf(`    - id: preset-${preset}`)
  assert.ok(start >= 0, `cordis.patch.yml declares preset-${preset}`)
  const next = patch.indexOf('\n    - id: ', start + 1)
  return patch.slice(start, next < 0 ? undefined : next)
}

/** The `persona.config.prefix` block of a preset, dedented and trimmed. */
function personaPrefix(preset: string): string {
  const block = presetBlock(preset)
  const prefixAt = block.indexOf('prefix: |-')
  assert.ok(prefixAt > 0, `preset-${preset} declares a persona prefix`)
  const body = block.slice(prefixAt + 'prefix: |-'.length)
  const end = body.indexOf('          - id: ')
  assert.ok(end > 0, `the ${preset} persona prefix is followed by plugin rows`)
  return body
    .slice(0, end)
    .split('\n')
    .map((line) => line.replace(/^ {16}/, ''))
    .join('\n')
    .trim()
}

/** Tool profile of a preset's `teamflow-tools` row; the schema default is requirement. */
function toolProfile(preset: string): string {
  const block = presetBlock(preset)
  const toolsAt = block.indexOf('          - id: teamflow-tools')
  assert.ok(toolsAt > 0, `preset-${preset} mounts the teamflow tools`)
  const match = /^ {14}profile: (\w+)$/m.exec(block.slice(toolsAt))
  return match?.[1] ?? 'requirement'
}

/** Plugin ids mounted by a preset, in declaration order. */
function pluginIds(preset: string): string[] {
  return [...presetBlock(preset).matchAll(/^ {10}- id: ([\w-]+)$/gm)].map(
    (match) => match[1] ?? '',
  )
}

/** One top-level section of a persona, header included. */
function section(prompt: string, header: string): string {
  const start = prompt.indexOf(`${header}\n`)
  assert.ok(start >= 0, `persona carries ${header}`)
  const next = prompt.indexOf('\n# ', start + header.length)
  return prompt.slice(start, next < 0 ? undefined : next)
}

/** Numbered clauses (1., 2., ...) inside one block of a persona. */
function clauseNumbers(block: string): number[] {
  return block
    .split('\n')
    .map((line) => /^(\d+)\./.exec(line)?.[1])
    .filter((value): value is string => value !== undefined)
    .map(Number)
}

/** Sub-sections of a persona, each cut at the next `# ` heading. */
function subBlocks(prompt: string): string[] {
  const blocks: string[] = []
  let current: string[] | null = null
  for (const line of prompt.split('\n')) {
    if (line.startsWith('## ')) {
      if (current !== null) blocks.push(current.join('\n'))
      current = [line]
      continue
    }
    if (line.startsWith('# ')) {
      if (current !== null) blocks.push(current.join('\n'))
      current = null
      continue
    }
    current?.push(line)
  }
  if (current !== null) blocks.push(current.join('\n'))
  return blocks
}

/** Assert every fragment appears in the text, failing with the missing one. */
function includesAll(text: string, fragments: readonly string[]): void {
  for (const fragment of fragments) {
    assert.ok(text.includes(fragment), `prompt is missing: ${fragment}`)
  }
}

describe('five-section skeleton (5/5)', () => {
  it('keeps the five top-level sections, in order, in every persona', () => {
    for (const agent of AGENTS) {
      const prompt = personaPrefix(agent.preset)
      const topLevel = prompt.split('\n').filter((line) => line.startsWith('# '))
      assert.deepEqual(topLevel, [...SKELETON], `${agent.preset} keeps the skeleton`)
    }
  })

  it('keeps the three boundary sub-sections, in order, in every persona', () => {
    for (const agent of AGENTS) {
      const prompt = personaPrefix(agent.preset)
      const subheads = section(prompt, '# 职责与边界')
        .split('\n')
        .filter((line) => line.startsWith('## '))
      assert.deepEqual(subheads, [...BOUNDARY], `${agent.preset} keeps the boundary seams`)
    }
  })

  it('allows sub-sections only under 职责与边界 and 工作流程', () => {
    for (const agent of AGENTS) {
      const prompt = personaPrefix(agent.preset)
      for (const header of FLAT_SECTIONS) {
        const body = section(prompt, header)
        assert.doesNotMatch(body, /^## /m, `${agent.preset} ${header} stays flat`)
      }
      const flow = section(prompt, '# 工作流程')
      assert.match(flow, /^## /m, `${agent.preset} splits 工作流程 by entry`)
      assert.doesNotMatch(prompt, /工作方式：/, `${agent.preset} dropped the old heading`)
    }
  })

  it('numbers clauses contiguously from 1 in every block', () => {
    for (const agent of AGENTS) {
      const prompt = personaPrefix(agent.preset)
      for (const block of subBlocks(prompt)) {
        const numbers = clauseNumbers(block)
        assert.deepEqual(
          numbers,
          numbers.map((_, index) => index + 1),
          `${agent.preset} numbers 「${block.split('\n')[0]}」 contiguously`,
        )
      }
      for (const header of ['# 输入输出约定', '# 禁止事项'] as const) {
        const numbers = clauseNumbers(section(prompt, header))
        assert.deepEqual(
          numbers,
          numbers.map((_, index) => index + 1),
          `${agent.preset} numbers ${header} contiguously`,
        )
      }
    }
  })

  it('keeps every persona a full rewrite rather than a stub', () => {
    for (const agent of AGENTS) {
      const prompt = personaPrefix(agent.preset)
      assert.ok(prompt.length > 600, `${agent.preset} persona is a full brief`)
      assert.ok(
        prompt.startsWith('# 角色定位\n'),
        `${agent.preset} opens on the role sentence`,
      )
    }
  })
})

describe('preset rows stay wired as before', () => {
  it('keeps the five preset ids, display names and tool profiles', () => {
    for (const agent of AGENTS) {
      const block = presetBlock(agent.preset)
      assert.ok(block.includes(`        id: ${agent.preset}`), `${agent.preset} keeps its id`)
      assert.ok(
        block.includes(`        name: ${agent.title}`),
        `${agent.preset} keeps its display name`,
      )
      assert.equal(toolProfile(agent.preset), agent.profile, `${agent.preset} tool profile`)
    }
  })

  it('mounts the teamflow tools and ask_user_question on every preset', () => {
    for (const agent of AGENTS) {
      const plugins = pluginIds(agent.preset)
      assert.ok(plugins.includes('persona'), `${agent.preset} mounts the persona plugin`)
      assert.ok(plugins.includes('teamflow-tools'), `${agent.preset} mounts teamflow tools`)
      assert.ok(plugins.includes('tool-ask-user'), `${agent.preset} can ask the user`)
    }
  })

  it('declares exactly the five story presets', () => {
    const declared = [...patch.matchAll(/^ {4}- id: (preset-xirang-[\w-]+)$/gm)].map(
      (match) => match[1]?.replace('preset-', '') ?? '',
    )
    assert.deepEqual(declared.sort(), AGENTS.map((agent) => agent.preset).sort())
  })
})

describe('cross-Agent boundary seams', () => {
  it('leaves story ownership to the story Agent alone', () => {
    const requirement = personaPrefix('xirang-requirement')
    includesAll(requirement, ['不拆分、不修改、不删除故事。', '用户要求写代码、写详细设计或拆故事时'])
    assert.doesNotMatch(requirement, /teamflow_(create|update|delete|get)_story/)

    const story = personaPrefix('xirang-story')
    includesAll(story, ['逐条得到明确确认后才调用 teamflow_delete_story', '不允许一次确认删多条'])
    includesAll(story, ['不修改需求正文（概要设计）', '不撰写、不修改详细设计文档'])
    assert.doesNotMatch(story, /teamflow_update_requirement/)
  })

  it('leaves detailed design read-only for story and story read-only for design', () => {
    const detail = personaPrefix('xirang-detail')
    includesAll(detail, ['不拆分、不修改、不删除故事', '不改概要设计正文'])
    assert.doesNotMatch(detail, /teamflow_(create|update|delete)_story/)
    assert.doesNotMatch(detail, /teamflow_update_requirement/)
  })

  it('keeps defect ownership out of the recording Agent', () => {
    const bug = personaPrefix('xirang-bug')
    includesAll(bug, [
      '不判断缺陷应该归属哪条需求或哪个故事',
      '缺陷是独立记录：不需要关联需求或故事',
      '信息不足仍要录入时，正文分段写「已知」与「待补」',
      'blocker 与 critical 例外——缺复现步骤时不录入',
    ])
    assert.doesNotMatch(bug, /teamflow_link_requirement_session/)
  })

  it('keeps completion and verdicts with the user', () => {
    const dev = personaPrefix('xirang-dev')
    includesAll(dev, [
      '运行成功只代表「执行完毕」，不代表故事完成或缺陷已解决',
      '不代替用户判定完成：不宣称故事完成、不宣称缺陷已解决。',
      '缺陷描述不足以定位时',
    ])
    includesAll(personaPrefix('xirang-requirement'), ['不做评审结论'])
    includesAll(personaPrefix('xirang-detail'), ['不做评审结论'])
  })

  it('never lets the development Agent write workbench records', () => {
    const dev = personaPrefix('xirang-dev')
    assert.doesNotMatch(dev, /teamflow_(create|update|delete)_(requirement|story|bug|design)/)
    includesAll(dev, ['不新建、不修改、不删除任何需求、故事、缺陷、详细设计记录'])
  })

  it('reaches the workbench only through teamflow tools plus ask_user_question', () => {
    for (const agent of AGENTS) {
      const prompt = personaPrefix(agent.preset)
      assert.doesNotMatch(
        prompt,
        /你可以调用(文件|命令行|网络|子代理)/,
        `${agent.preset} names no foreign tools`,
      )
      assert.ok(
        prompt.includes('teamflow_get_') || prompt.includes('teamflow_create_'),
        `${agent.preset} names the tools it may call`,
      )
    }
  })
})

describe('prefill templates carry facts, not process', () => {
  it('keeps the create prefill to marker, workspace and supplement for every kind', () => {
    for (const kind of CREATE_KINDS) {
      const prefill = buildCreatePrompt({
        kind,
        workspaceId: 'ws-1',
        workspaceTitle: '团队工作台',
        description: '点击暂停后停止计时。',
      })
      assert.equal(prefill.split('\n').length, 6, `${kind} prefill stays six lines`)
      assert.match(prefill, /^【创建.+】$/m)
      assert.match(prefill, /我的补充：\n点击暂停后停止计时。$/)
      assert.doesNotMatch(prefill, /teamflow_|标题|评审|概要设计/)
    }
  })

  it('keeps the discussion prefill to marker and supplement for every entry', () => {
    const entries = [
      { kind: 'design' as const, marker: '【继续讨论需求与概要设计】' },
      { kind: 'split' as const, marker: '【继续讨论故事拆分】' },
      { kind: 'detail' as const, marker: '【继续讨论详细设计】' },
    ]
    for (const entry of entries) {
      const prefill = buildRequirementDiscussionPrompt(entry.kind)
      assert.equal(prefill, [entry.marker, '', '我的补充：'].join('\n'))
      assert.doesNotMatch(prefill, /teamflow_|评审|定稿|确认/)
    }
  })

  it('keeps the run prefills to the entrance marker and task facts', () => {
    const story = buildDevPrompt(
      {
        id: 'sty_1',
        title: '做出暂停按钮',
        acceptance: ['点击后暂停', '再次点击继续'],
      },
      { id: 'req_1', title: '计时器' },
    )
    assert.equal(
      story,
      [
        '【开始研发】',
        '',
        '执行故事 sty_1《做出暂停按钮》',
        '所属：计时器（req_1）',
        '验收标准：',
        '1. 点击后暂停',
        '2. 再次点击继续',
      ].join('\n'),
    )
    assert.equal(
      buildDevPrompt({ id: 'sty_2', title: '独立故事', acceptance: [] }).split('\n')[3],
      '所属：独立故事',
    )

    const bug = buildBugDevPrompt({
      id: 'bug_1',
      title: '暂停后计时不停止',
      severity: 'major',
      body: '暂停后仍继续计时。',
    })
    assert.equal(
      bug,
      [
        '【开始修复】',
        '',
        '修复缺陷 bug_1《暂停后计时不停止》',
        '严重程度：major',
        '缺陷描述：',
        '暂停后仍继续计时。',
      ].join('\n'),
    )
    for (const prefill of [story, bug]) {
      assert.doesNotMatch(prefill, /teamflow_|## |工作方式/)
    }
  })
})

describe('pre-rewrite snapshot set (5/5)', () => {
  it('keeps one snapshot per Agent with the old persona and prefills', () => {
    for (const agent of AGENTS) {
      const snapshot = readFileSync(
        new URL(`../docs/agent-prompt-snapshots/${agent.preset}.md`, import.meta.url),
        'utf8',
      ).replace(/\r\n/g, '\n')
      assert.ok(snapshot.includes('工作方式：'), `${agent.preset} keeps the old persona`)
      assert.ok(snapshot.includes('你是息壤工作台里的'), `${agent.preset} keeps the old role line`)
      const blocks = [...snapshot.matchAll(/```text\n([\s\S]*?)```/g)].map((match) => match[1])
      assert.ok(blocks.length >= 2, `${agent.preset} keeps persona and prefill blocks`)
      assert.ok(
        (blocks[0] ?? '').includes('工作方式：'),
        `${agent.preset} keeps the old persona in the first block`,
      )
      for (const block of blocks) {
        assert.ok(
          !(block ?? '').includes('# 角色定位'),
          `${agent.preset} snapshot block is the pre-rewrite text, not the new skeleton`,
        )
      }
    }
  })
})
