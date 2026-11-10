/**
 * The three work-item kinds the interactive creation flow understands.
 *
 * Kept free of React and Cordis so both the browser bundle and the Host-side
 * tools can share the same preset ids and the same prompt wording. The preset
 * ids are part of the bundle contract: `cordis.patch.yml` declares presets
 * with exactly these ids, and a session created with one of them inherits the
 * matching interviewer agent.
 *
 * @module
 */

/** A work-item kind the Create page and the composer can start. */
export type CreateKind = 'requirement' | 'story' | 'bug'

/** Kinds in the order the UI presents them. */
export const CREATE_KINDS: readonly CreateKind[] = ['requirement', 'story', 'bug']

/**
 * Preset id per kind.
 *
 * These strings are declared in `cordis.patch.yml` (`config.id` of each
 * `@deepseek-ai/dsh-agent-preset` row); changing one without the other makes
 * `sessions.create({ agentPreset })` fail with an unknown-preset error.
 */
export const CREATE_PRESET: Readonly<Record<CreateKind, string>> = {
  requirement: 'xirang-requirement',
  story: 'xirang-story',
  bug: 'xirang-bug',
}

/** Locale keys for the human labels; the dictionaries own the words. */
export const CREATE_KIND_LABEL: Readonly<Record<CreateKind, string>> = {
  requirement: 'create.kind.requirement',
  story: 'create.kind.story',
  bug: 'create.kind.bug',
}

/** Narrow an untrusted value (a select value, a remote payload) to a kind. */
export function isCreateKind(value: unknown): value is CreateKind {
  return value === 'requirement' || value === 'story' || value === 'bug'
}

/** What the Create page submits after the user filled the form. */
export interface CreateDraft {
  readonly kind: CreateKind
  readonly workspaceId: string
  /** Display name of the workspace, copied into the prompt for context. */
  readonly workspaceTitle: string
  /** The user's own words; never reformatted into a template. */
  readonly description: string
}

const TYPE_LABEL: Readonly<Record<CreateKind, string>> = {
  requirement: '需求',
  story: '故事',
  bug: '缺陷',
}

/**
 * First message sent into the new conversation.
 *
 * This is deliberately a *fact sheet*, not a questionnaire: the interviewer
 * persona owns the questions, and repeating them here would make the agent
 * ask for information the user already supplied. The workspace id is included
 * so the tool can resolve the right directory even when the session directory
 * is not visible to the model.
 *
 * Every kind uses the same slim template — header, workspace, supplement slot.
 * The title rule, stage rule, split-plan confirmation gate, duplicate checking
 * and the save tool all live in the preset personas, so prompt and persona
 * cannot state the process twice.
 */
export function buildCreatePrompt(draft: CreateDraft): string {
  const description = draft.description.trim()
  return [
    `【创建${TYPE_LABEL[draft.kind]}】`,
    '',
    `工作区：${draft.workspaceTitle}（id: ${draft.workspaceId}）`,
    '',
    '我的补充：',
    description.length > 0 ? description : '（没有额外描述，请先询问。）',
  ].join('\n')
}
