/**
 * The three run permission tiers, defined once.
 *
 * Both halves of the plugin import this module: the Host turns a tier into the
 * session's sandbox/approval values and validates what the wire carries, and
 * the browser renders the menu and the header badge from the same table. The
 * permission values appear here and nowhere else — pages and components read
 * {@link PERMISSION_TIER_DEFINITIONS} instead of spelling them out, so the
 * three tiers cannot drift between the button, the menu and the Host.
 *
 * Two vocabularies are deliberately kept apart:
 *
 * - the **tier id** (`normal`, `readonly`, `full`) is the only value that
 *   crosses the wire or is stored; it is an internal identifier and is never
 *   shown.
 * - the **permission values** (`workspace-write`, `read-only`,
 *   `danger-full-access`, `ask`, `never`) are the Host's own sandbox and
 *   approval vocabulary, matched literally against `SANDBOX_MODES` and
 *   `APPROVAL_POLICIES`.
 *
 * Text is not here: every label, description and badge is a locale key, so the
 * dictionaries stay the single source of user-visible copy.
 *
 * @module
 */

/** Tier ids in menu order; the first one is the default. */
export const PERMISSION_TIERS = ['normal', 'readonly', 'full'] as const

/** Identifier of one permission tier. */
export type PermissionTier = (typeof PERMISSION_TIERS)[number]

/**
 * The tier a run uses when the caller does not choose one.
 *
 * Every entry point starts here and nothing remembers the previous choice, so
 * a mistaken "full access" is never repeated by accident.
 */
export const DEFAULT_PERMISSION_TIER: PermissionTier = 'normal'

/** Sandbox modes the Host understands, spelled exactly as `SANDBOX_MODES`. */
export type TierSandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access'

/** Approval policies the Host understands, spelled exactly as `APPROVAL_POLICIES`. */
export type TierApprovalPolicy = 'ask' | 'never'

/** One row of the table: identity, permission values and copy keys. */
export interface PermissionTierDefinition {
  /** Wire and storage identity; never rendered. */
  readonly tier: PermissionTier
  /** Session sandbox mode applied before the first prompt. */
  readonly sandbox: TierSandboxMode
  /** Session approval policy applied before the first prompt. */
  readonly approval: TierApprovalPolicy
  /** Locale key of the menu's primary line, e.g. 普通执行. */
  readonly nameKey: string
  /** Locale key of the menu's one-sentence explanation. */
  readonly descriptionKey: string
  /** Locale key of the short header badge, e.g. 普通. */
  readonly badgeKey: string
}

/** The single definition table; menu order is {@link PERMISSION_TIERS}. */
export const PERMISSION_TIER_DEFINITIONS: readonly PermissionTierDefinition[] = Object.freeze([
  Object.freeze({
    tier: 'normal',
    sandbox: 'workspace-write',
    approval: 'ask',
    nameKey: 'tier.normal.name',
    descriptionKey: 'tier.normal.description',
    badgeKey: 'tier.normal.badge',
  }),
  Object.freeze({
    tier: 'readonly',
    sandbox: 'read-only',
    approval: 'ask',
    nameKey: 'tier.readonly.name',
    descriptionKey: 'tier.readonly.description',
    badgeKey: 'tier.readonly.badge',
  }),
  Object.freeze({
    tier: 'full',
    sandbox: 'danger-full-access',
    approval: 'never',
    nameKey: 'tier.full.name',
    descriptionKey: 'tier.full.description',
    badgeKey: 'tier.full.badge',
  }),
])

/** True when the value is one of the three tier ids, exact case included. */
export function isPermissionTier(value: unknown): value is PermissionTier {
  return typeof value === 'string' && (PERMISSION_TIERS as readonly string[]).includes(value)
}

/**
 * Look one tier up; the table covers every id, so an unknown id is a bug.
 * @param tier - tier id.
 * @returns its definition row.
 */
export function permissionTierDefinition(tier: PermissionTier): PermissionTierDefinition {
  const found = PERMISSION_TIER_DEFINITIONS.find((entry) => entry.tier === tier)
  if (found === undefined) {
    throw new Error(`teamflow: permission tier "${tier}" has no definition`)
  }
  return found
}

/** Outcome of reading the optional `permissionTier` wire parameter. */
export type PermissionTierInput =
  | { readonly ok: true; readonly tier: PermissionTier | null }
  | { readonly ok: false; readonly value: string }

/**
 * Read the optional `permissionTier` parameter.
 *
 * Missing, `null` and the empty string all mean "not passed" and keep the
 * existing default behaviour. Anything else must be exactly one tier id: a
 * permission value such as `danger-full-access`, a different case, or an
 * unknown word is a validation failure, never a silent fall back to `normal`.
 * @param raw - whatever the caller sent.
 * @returns the tier, `null` for "not passed", or the rejected value.
 */
export function readPermissionTierInput(raw: unknown): PermissionTierInput {
  if (raw === undefined || raw === null) return { ok: true, tier: null }
  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if (trimmed.length === 0) return { ok: true, tier: null }
    if (isPermissionTier(trimmed)) return { ok: true, tier: trimmed }
    return { ok: false, value: raw }
  }
  return { ok: false, value: String(raw) }
}

/** Comma-separated tier ids, for validation messages and documentation. */
export const PERMISSION_TIER_LIST: string = PERMISSION_TIERS.join(', ')
