/**
 * Development Agent prompt contract.
 *
 * The persona prefix lives in `cordis.patch.yml`; the two task sheets are
 * `buildDevPrompt` / `buildBugDevPrompt`. Both are text assets with no runtime
 * validator, so the skeleton, the dual-entry routing, the boundary clauses and
 * the pre-rewrite snapshot are asserted here.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

const patch = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8').replace(
  /\r\n/g,
  '\n',
)

/** Read the `persona.config.prefix` block of `preset-xirang-dev`, dedented. */
function devPersonaPrefix(): string {
  const block = patch.slice(patch.indexOf('    - id: preset-xirang-dev'))
  const prefixAt = block.indexOf('prefix: |-')
  assert.ok(prefixAt > 0, 'preset-xirang-dev declares a persona prefix')
  const body = block.slice(prefixAt + 'prefix: |-'.length)
  const end = body.indexOf('          - id: agent-instructions')
  assert.ok(end > 0, 'the persona prefix is followed by the host instruction row')
  return body
    .slice(0, end)
    .split('\n')
    .map((line) => line.replace(/^ {16}/, ''))
    .join('\n')
    .trim()
}

const prompt = devPersonaPrefix()

/** The slice of the prompt between two markers. */
function between(start: string, end: string): string {
  const startAt = prompt.indexOf(start)
  const endAt = prompt.indexOf(end, startAt + start.length)
  assert.ok(startAt >= 0, `prompt is missing: ${start}`)
  assert.ok(endAt > startAt, `prompt is missing: ${end}`)
  return prompt.slice(startAt, endAt)
}

/** Assert every fragment appears in the prompt, failing with the missing one. */
function includesAll(fragments: string[]): void {
  for (const fragment of fragments) {
    assert.ok(prompt.includes(fragment), `prompt is missing: ${fragment}`)
  }
}

/** Assert the fragments appear inside `section` in the given order. */
function inOrder(section: string, fragments: string[]): void {
  let cursor = -1
  for (const fragment of fragments) {
    const at = section.indexOf(fragment, cursor + 1)
    assert.ok(at > cursor, `fragment is out of order or missing: ${fragment}`)
    cursor = at
  }
}

/** Count the numbered clauses of one boundary block. */
function clauseCount(section: string): number {
  return section
    .split('\n')
    .filter((line) => /^\d+\. /.test(line))
    .length
}

describe('xirang-dev persona prompt', () => {
  it('follows the frozen five-section skeleton in order', () => {
    const topLevel = prompt.split('\n').filter((line) => line.startsWith('# '))
    assert.deepEqual(topLevel, [
      '# 角色定位',
      '# 职责与边界',
      '# 工作流程',
      '# 输入输出约定',
      '# 禁止事项',
    ])
    const boundary = between('## 职责内', '# 工作流程')
      .split('\n')
      .filter((line) => line.startsWith('## '))
    assert.deepEqual(boundary, ['## 职责内', '## 不做', '## 需停下确认'])
    assert.doesNotMatch(prompt, /工作方式：/)
  })

  it('routes the two entrances by their markers and keeps the ids in sync', () => {
    includesAll([
      '## 故事研发（入口标识「【开始研发】」，任务行「执行故事 <id>《…》」）',
      '## 缺陷修复（入口标识「【开始修复】」，任务行「修复缺陷 <id>《…》」）',
      '调用 teamflow_begin_self_test，参数 story 用该故事编号',
      '调用 teamflow_begin_self_test，参数 bug 用该缺陷编号',
      '参数 story 用同一编号',
      '参数 bug 用同一编号',
      '编号必须与预填任务行里的编号一致',
    ])
  })

  it('walks the story branch from the record to the run verdict in order', () => {
    const storyBranch = between('## 故事研发', '## 缺陷修复')
    inOrder(storyBranch, [
      'teamflow_get_story',
      '按仓库约定定位相关代码',
      '实现，按需多轮修改',
      '运行与改动相关的测试或构建',
      '调用 teamflow_begin_self_test，参数 story',
      '调用 teamflow_finish_run：参数 story',
      '只有确认放弃本次研发时才调用 teamflow_cancel_run',
    ])
  })

  it('walks the defect branch from reproduction to the run verdict in order', () => {
    const bugBranch = between('## 缺陷修复', '# 输入输出约定')
    inOrder(bugBranch, [
      'teamflow_get_bug',
      '先尝试复现',
      '确认根因与相关代码',
      '再动手修复',
      '确认原缺陷场景不再出现',
      '调用 teamflow_begin_self_test，参数 bug',
      '调用 teamflow_finish_run：参数 bug',
      '预填不会带上一次失败的原因',
      '不要重复上一轮已失败的改法',
      '只有确认放弃本次修复时才调用 teamflow_cancel_run',
    ])
  })

  it('leans on the injected repository conventions instead of re-reading AGENTS.md', () => {
    includesAll(['按已注入的仓库约定（AGENTS.md 等）与相关代码确认构建方式、测试命令与代码规范'])
    assert.doesNotMatch(prompt, /先读仓库的 AGENTS\.md|先阅读仓库约定|主动读取.*AGENTS\.md/)
  })

  it('lends the working method to both entrances', () => {
    includesAll([
      '实现要小而完整',
      '优先复用现有抽象',
      '不顺手重构无关代码',
      '一次运行内允许「改 → 验」多轮',
      '仓库规定的检查没有运行的，不得声称通过',
    ])
  })

  it('states all six out-of-scope items', () => {
    const outOfScope = between('## 不做', '## 需停下确认')
    assert.equal(clauseCount(outOfScope), 6)
    includesAll([
      '不新建、不修改、不删除任何需求、故事、缺陷、详细设计记录',
      '不代替用户判定完成：不宣称故事完成、不宣称缺陷已解决',
      '不动与本任务无关的模块',
      '不擅自新增依赖、不擅自改 CI 与构建配置',
      '不尝试越过沙箱或提权；不访问不可达的网络',
      '不用 teamflow_cancel_run 掩盖失败',
      '不谎报验证结果，不把没跑过的检查写成通过',
    ])
  })

  it('stops to confirm all five situations', () => {
    const stops = between('## 需停下确认', '# 工作流程')
    assert.equal(clauseCount(stops), 5)
    includesAll([
      '验收标准互相矛盾、或无法客观验证',
      '需要新增依赖、改动构建配置或 CI 脚本',
      '需要更高权限、访问被沙箱拒绝、或依赖的外部服务不可达',
      '自测失败、且根因明显不在本次改动范围内',
      '缺陷描述不足以定位',
    ])
  })

  it('keeps cancel_run distinct from a failed run in all three places', () => {
    includesAll([
      '不用 teamflow_cancel_run 掩盖失败',
      '不用 cancel_run 代替 failed',
      '只有确认放弃本次研发时才调用 teamflow_cancel_run',
      '只有确认放弃本次修复时才调用 teamflow_cancel_run',
      '失败时把原因写进 selfTestNotes',
    ])
  })

  it('never presents a finished run as a completed task', () => {
    includesAll(['运行成功只代表「执行完毕」', '不把「运行结束」表述成「任务完成」'])
    assert.doesNotMatch(prompt, /运行成功.*任务完成/)
  })

  it('names the run tools and the read-only records in the input/output contract', () => {
    const io = between('# 输入输出约定', '# 禁止事项')
    includesAll([
      'teamflow_begin_self_test、teamflow_finish_run、teamflow_cancel_run',
      '运行状态由工作台持有，你只提交结果，不自行修改',
      'summary 要写清改了什么、验证了什么',
    ])
    assert.doesNotMatch(io, /teamflow_create_|teamflow_update_|teamflow_delete_/)
  })
})

describe('xirang-dev pre-rewrite snapshot', () => {
  const snapshot = readFileSync(
    new URL('../docs/agent-prompt-snapshots/xirang-dev.md', import.meta.url),
    'utf8',
  )

  it('keeps the old persona prefix verbatim', () => {
    assert.ok(snapshot.includes('你是息壤工作台里的「研发执行」Agent。你接到一个故事的研发任务'))
    assert.ok(snapshot.includes('1. 先读仓库的 AGENTS.md 和相关 docs，确认构建、测试与代码规范'))
    assert.ok(snapshot.includes('8. 需求不清或有多种合理取舍时，用 ask_user_question 问用户，不要自行扩大范围。'))
  })

  it('keeps both old prefills verbatim', () => {
    assert.ok(snapshot.includes('工作台已经记录了本次研发运行。需求、概要设计和详细设计对你全部只读'))
    assert.ok(snapshot.includes('开始自测前调用 teamflow_begin_self_test，参数 story 用上面的故事编号。'))
    assert.ok(snapshot.includes('开始自测前调用 teamflow_begin_self_test，参数 bug 用上面的缺陷编号。'))
    assert.ok(snapshot.includes('7. 缺陷描述不足以定位时，用 ask_user_question 补充信息，不要猜测。'))
  })

  it('records that the host-injected AGENTS.md content stays untouched', () => {
    assert.ok(snapshot.includes('本次不重写宿主注入的 AGENTS.md 内容'))
  })

  it('maps every migration row to a landing point', () => {
    const table = snapshot
      .slice(snapshot.indexOf('## 3.'), snapshot.indexOf('## 4.'))
      .split('\n')
      .filter(
        (line) =>
          line.startsWith('| ') && !line.startsWith('| 出处') && !line.startsWith('| ---'),
      )
    assert.equal(table.length, 8, '6 migration rows plus 2 retained rows')
    for (const row of table) {
      const cells = row
        .split('|')
        .slice(1, -1)
        .map((cell) => cell.trim())
      assert.equal(cells.length, 3, `row must have three cells: ${row}`)
      assert.ok((cells[2] ?? '').length > 0, `row has no landing point: ${row}`)
      assert.match(String(cells[2]), /#|预填/)
    }
  })
})
