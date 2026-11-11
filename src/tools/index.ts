/**
 * The agent-facing tool surface mounted by the five workbench presets.
 *
 * This module is exported as the package subpath `@xirang-ai/dsh-teamflow/tools`
 * and mounted by each preset in `cordis.patch.yml`. It deliberately does not
 * import the Host entry: the database is read from the `teamflow` service the
 * main plugin provides, so mounting a preset never opens a second store.
 *
 * Visibility is a product rule, not a convention: each Agent sees only the
 * tools its stage needs. `profile` selects one fixed set, so the requirement
 * Agent cannot write detailed designs, the design Agents cannot run a story,
 * and the development Agent can read every document but never rewrite one.
 *
 * @module
 */
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'

import { beginSelfTestTool } from './begin-self-test.ts'
import { cancelRunTool } from './cancel-run.ts'
import { createBugTool } from './create-bug.ts'
import { createDesignDocTool } from './create-design-doc.ts'
import { createRequirementTool } from './create-requirement.ts'
import { createStoryTool } from './create-story.ts'
import { deleteStoryTool } from './delete-story.ts'
import { finishRunTool } from './finish-run.ts'
import { getBugTool } from './get-bug.ts'
import { getDesignDocTool } from './get-design-doc.ts'
import { getRequirementTool } from './get-requirement.ts'
import { getStoryTool } from './get-story.ts'
import { linkRequirementSessionTool } from './link-requirement-session.ts'
import { linkSessionTool } from './link-session.ts'
import { listRecordsTool } from './list-records.ts'
import { listWorkspacesTool } from './list-workspaces.ts'
import { createToolEnvironment } from './shared.ts'
import { updateBugTool } from './update-bug.ts'
import { updateDesignDocTool } from './update-design-doc.ts'
import { updateRequirementTool } from './update-requirement.ts'
import { updateStoryTool } from './update-story.ts'

/** Cordis plugin name for diagnostics. */
export const name = 'teamflow-tools'

/** Registries and the workbench database come from the Host service graph. */
export const inject = ['tools', 'teamflow', 'workspaceRegistry']

/** Which Agent this tools row belongs to. */
export const TOOL_PROFILES = [
  'requirement',
  'detail',
  'split',
  'dev',
  'bug',
  'all',
] as const
export type ToolProfile = (typeof TOOL_PROFILES)[number]

/**
 * Tool names per profile.
 *
 * `requirement` collects the requirement and its outline design;
 * `detail` writes detailed designs while reading the outline;
 * `split` writes stories while reading detailed designs;
 * `dev` executes a story with every document read-only;
 * `bug` collects and merges defects.
 */
export const PROFILE_TOOL_NAMES: Readonly<Record<ToolProfile, readonly string[]>> = {
  requirement: [
    'teamflow_link_session',
    'teamflow_link_requirement_session',
    'teamflow_create_requirement',
    'teamflow_get_requirement',
    'teamflow_update_requirement',
    'teamflow_list_records',
    'teamflow_list_workspaces',
  ],
  detail: [
    'teamflow_link_session',
    'teamflow_link_requirement_session',
    'teamflow_get_requirement',
    'teamflow_get_design_doc',
    'teamflow_create_design_doc',
    'teamflow_update_design_doc',
    'teamflow_list_records',
    'teamflow_list_workspaces',
  ],
  split: [
    'teamflow_link_session',
    'teamflow_link_requirement_session',
    'teamflow_get_requirement',
    'teamflow_get_design_doc',
    'teamflow_create_story',
    'teamflow_get_story',
    'teamflow_update_story',
    'teamflow_delete_story',
    'teamflow_list_records',
    'teamflow_list_workspaces',
  ],
  dev: [
    'teamflow_get_requirement',
    'teamflow_get_design_doc',
    'teamflow_get_story',
    'teamflow_get_bug',
    'teamflow_begin_self_test',
    'teamflow_finish_run',
    'teamflow_cancel_run',
  ],
  bug: [
    'teamflow_link_session',
    'teamflow_create_bug',
    'teamflow_get_bug',
    'teamflow_update_bug',
    'teamflow_list_records',
    'teamflow_list_workspaces',
  ],
  all: [
    'teamflow_create_requirement',
    'teamflow_update_requirement',
    'teamflow_get_requirement',
    'teamflow_create_design_doc',
    'teamflow_update_design_doc',
    'teamflow_get_design_doc',
    'teamflow_link_requirement_session',
    'teamflow_link_session',
    'teamflow_create_story',
    'teamflow_get_story',
    'teamflow_update_story',
    'teamflow_delete_story',
    'teamflow_create_bug',
    'teamflow_update_bug',
    'teamflow_get_bug',
    'teamflow_list_records',
    'teamflow_list_workspaces',
    'teamflow_begin_self_test',
    'teamflow_finish_run',
    'teamflow_cancel_run',
  ],
}

/** Every tool this module can register. */
export const TOOL_NAMES = PROFILE_TOOL_NAMES.all

/** Per-preset tool surface. */
export interface Config {
  /** Agent stage this row belongs to; selects one fixed tool set. */
  profile: ToolProfile
}

/** Validated config; the Host rejects a bad layer before `apply` runs. */
export const Config: Schema<Config> = Schema.object({
  profile: Schema.union(TOOL_PROFILES)
    .default('requirement')
    .description('Agent stage: requirement, detail, split, dev or bug.'),
})

/**
 * Register the tools inside the preset composition.
 *
 * The preset itself is the tool boundary: it contains these rows plus the
 * coding and conversation tools its stage needs, so no global allow mask is
 * needed. A `ctx.tools.restrict()` call here cannot see Host-global tool names
 * from the preset's isolated scope and would mark the whole preset as broken.
 * @param ctx - preset context providing `tools`, `teamflow` and the registry.
 * @param config - which Agent stage this row serves.
 */
export function apply(ctx: Context, config: Config): void {
  const environment = createToolEnvironment(ctx)
  const profile = config.profile ?? 'requirement'
  const allowed = new Set(PROFILE_TOOL_NAMES[profile])

  const definitions = [
    createRequirementTool(environment),
    updateRequirementTool(environment),
    getRequirementTool(environment),
    createDesignDocTool(environment),
    updateDesignDocTool(environment),
    getDesignDocTool(environment),
    linkRequirementSessionTool(environment),
    linkSessionTool(environment),
    createStoryTool(environment),
    getStoryTool(environment),
    updateStoryTool(environment),
    deleteStoryTool(environment),
    createBugTool(environment),
    updateBugTool(environment),
    getBugTool(environment),
    listRecordsTool(environment),
    listWorkspacesTool(environment),
    beginSelfTestTool(environment),
    finishRunTool(environment),
    cancelRunTool(environment),
  ]

  for (const definition of definitions) {
    if (allowed.has(definition.name)) ctx.tools.register(definition)
  }
}
