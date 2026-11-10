/**
 * The development hand-off: the preset a started story runs under and the task
 * sheet prefilled into its conversation.
 *
 * The prefill is deliberately a task sheet, not a procedure: it carries the
 * entrance marker, the record id/title and the task facts, while the run
 * lifecycle and the working method live in the `xirang-dev` persona. It stays
 * a pure function of the record so the panel can rebuild it on every click and
 * a later reader can see exactly what the user starts with.
 *
 * @module
 */

/** Preset that composes coding tools with the run lifecycle tools. */
export const DEV_PRESET = 'xirang-dev'

/** The story fields the prompt uses. */
export interface DevStoryBrief {
  readonly id: string
  readonly title: string
  readonly acceptance: readonly string[]
}

/** The optional upstream requirement, used only for context. */
export interface DevRequirementBrief {
  readonly id: string
  readonly title: string
}

/**
 * Build the prompt sent when a user clicks "开始研发".
 * @param story - story whose run the workbench already recorded.
 * @param requirement - upstream requirement, when the story has one.
 * @returns the seven-line task sheet the conversation starts with.
 */
export function buildDevPrompt(story: DevStoryBrief, requirement?: DevRequirementBrief): string {
  const parent = requirement ? `${requirement.title}（${requirement.id}）` : '独立故事'
  return [
    '【开始研发】',
    '',
    `执行故事 ${story.id}《${story.title}》`,
    `所属：${parent}`,
    '验收标准：',
    ...story.acceptance.map((item, index) => `${index + 1}. ${item}`),
  ].join('\n')
}

/** The defect fields the fix prompt uses. */
export interface DevBugBrief {
  readonly id: string
  readonly title: string
  readonly severity: string
  readonly body: string
}

/**
 * Build the prompt sent when a user starts fixing a defect.
 * @param bug - defect whose fix run the workbench already recorded.
 * @returns the six-line task sheet the conversation starts with.
 */
export function buildBugDevPrompt(bug: DevBugBrief): string {
  return [
    '【开始修复】',
    '',
    `修复缺陷 ${bug.id}《${bug.title}》`,
    `严重程度：${bug.severity}`,
    '缺陷描述：',
    bug.body.trim() || bug.title,
  ].join('\n')
}
