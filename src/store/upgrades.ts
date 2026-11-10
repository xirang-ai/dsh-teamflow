/**
 * Plugin-version upgrades: data or filesystem work that a new plugin release
 * needs once, beyond what a schema migration does.
 *
 * The stored plugin version is compared with the running one on every start.
 * When they differ, every step whose version sits in `(from, to]` runs in
 * ascending order, inside the same transaction that records the new version,
 * so a failing step leaves the stored version untouched. Steps must therefore
 * be idempotent with respect to anything a rollback cannot undo (files,
 * external side effects).
 *
 * The list is intentionally empty today; adding a release that needs data work
 * appends one entry here instead of branching inside the startup path.
 *
 * @module
 */
import type { DatabaseSync } from 'node:sqlite'

import { compareVersionStrings, parseVersion } from './versions.ts'

/** Input handed to one upgrade step. */
export interface UpgradeContext {
  /** Open database; mutations participate in the caller's transaction. */
  readonly db: DatabaseSync
  /** Stored plugin version before this start. */
  readonly from: string
  /** Plugin version now running. */
  readonly to: string
  /** Report progress on the Host log. */
  readonly log: (message: string) => void
}

/** One plugin-version upgrade. */
export interface UpgradeStep {
  /** Version that introduces the change; sorted ascending before running. */
  readonly version: string
  /** Short, log-safe description. */
  readonly description: string
  /** Apply the step. */
  readonly run: (ctx: UpgradeContext) => void
}

/** Result of running the upgrade list. */
export interface AppliedUpgrade {
  readonly version: string
  readonly description: string
}

/** Ordered upgrade steps. */
export const PLUGIN_UPGRADES: readonly UpgradeStep[] = []

/**
 * Run every upgrade step that applies to the `from → to` transition.
 * An unreadable stored version runs every step up to `to`, because skipping
 * steps would leave the data in a state the running build does not expect.
 * @returns the steps that ran, in execution order.
 */
export function runUpgrades(ctx: UpgradeContext): readonly AppliedUpgrade[] {
  const unknownFrom = parseVersion(ctx.from) === undefined
  const applicable = PLUGIN_UPGRADES.filter((step) => {
    if (compareVersionStrings(step.version, ctx.to) > 0) return false
    return unknownFrom || compareVersionStrings(step.version, ctx.from) > 0
  }).sort((left, right) => compareVersionStrings(left.version, right.version))

  return applicable.map((step) => {
    ctx.log(`upgrade ${step.version}: ${step.description}`)
    step.run(ctx)
    return { version: step.version, description: step.description }
  })
}
