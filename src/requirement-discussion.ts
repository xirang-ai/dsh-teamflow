/**
 * The requirement discussion hand-off: the preset a discussion runs under and
 * the prompt that carries the user into it.
 *
 * The requirement body is also the outline design. There is no separate
 * outline-design Agent: collecting the requirement and writing its outline is
 * one job under the requirement Agent. Detailed design and story splitting are
 * different jobs with different write surfaces, so each runs under its own
 * preset. Keeping the presets separate means an Agent only sees the tools its
 * stage needs.
 *
 * @module
 */

/** Preset for the requirement / outline-design discussion (the collection Agent). */
export const REQUIREMENT_DISCUSSION_PRESET = 'xirang-requirement'

/** Preset for the detailed-design discussion. */
export const DETAIL_DISCUSSION_PRESET = 'xirang-detail'

/** Preset for the story-splitting discussion (reuses the standalone story agent). */
export const STORY_SPLIT_PRESET = 'xirang-story'

/** Which activity a requirement discussion is about. */
export type RequirementDiscussionKind = 'design' | 'detail' | 'split'

/**
 * Pick the preset a discussion kind must run under.
 * @param kind - `design`, `detail` or `split`.
 * @returns the preset id declared in `cordis.patch.yml`.
 */
export function presetForRequirementDiscussion(kind: RequirementDiscussionKind): string {
  if (kind === 'detail') return DETAIL_DISCUSSION_PRESET
  if (kind === 'split') return STORY_SPLIT_PRESET
  return REQUIREMENT_DISCUSSION_PRESET
}

/**
 * Build the prompt sent when the user starts a discussion from the requirement page.
 *
 * It deliberately carries neither the id nor the body: the tools resolve the
 * requirement through the session binding, which keeps the prompt short and
 * the binding authoritative. The kinds differ only in where the Agent writes
 * its conclusions: the outline lives in the requirement body, the detailed
 * design is a set of separate documents, and story splitting creates, revises
 * or removes stories.
 *
 * Every kind carries only the entry heading and the supplement slot; the tool
 * sequence, confirmation gate and boundaries live in the preset personas.
 * @param kind - `design` for the outline, `detail` for the detailed design,
 * `split` for splitting the requirement into stories.
 * @returns the first message of the discussion, carrying the supplement slot.
 */
export function buildRequirementDiscussionPrompt(kind: RequirementDiscussionKind = 'design'): string {
  if (kind === 'detail') {
    return [
      '【继续讨论详细设计】',
      '',
      '我的补充：',
    ].join('\n')
  }
  if (kind === 'split') {
    return ['【继续讨论故事拆分】', '', '我的补充：'].join('\n')
  }
  return ['【继续讨论需求与概要设计】', '', '我的补充：'].join('\n')
}
