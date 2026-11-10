/**
 * Small, dependency-free version comparison used to decide whether the stored
 * plugin version matches the running one. Semantic-version precedence is
 * enough here: a build suffix (`+sha`) is ignored, and a prerelease sorts
 * before its release (`0.2.0-rc.1 < 0.2.0`).
 *
 * @module
 */

/** Parsed version numbers plus prerelease identifiers. */
export interface ParsedVersion {
  readonly major: number
  readonly minor: number
  readonly patch: number
  readonly prerelease: readonly string[]
}

const VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/
const NUMERIC = /^\d+$/

/**
 * Parse a semantic version.
 * @param value - version string such as `0.1.0` or `0.2.0-rc.1`.
 * @returns the parsed version, or `undefined` when the string is not a version.
 */
export function parseVersion(value: string): ParsedVersion | undefined {
  const match = VERSION_PATTERN.exec(value.trim())
  if (match === null) return undefined
  const [, major, minor, patch, prerelease] = match
  if (major === undefined || minor === undefined || patch === undefined) return undefined
  return {
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
    prerelease: prerelease === undefined || prerelease === '' ? [] : prerelease.split('.'),
  }
}

function comparePrerelease(left: readonly string[], right: readonly string[]): number {
  // A release has higher precedence than any prerelease of the same numbers.
  if (left.length === 0 && right.length === 0) return 0
  if (left.length === 0) return 1
  if (right.length === 0) return -1

  const shared = Math.min(left.length, right.length)
  for (let index = 0; index < shared; index += 1) {
    const a = left[index]
    const b = right[index]
    if (a === undefined || b === undefined) break
    if (a === b) continue
    const aNumeric = NUMERIC.test(a)
    const bNumeric = NUMERIC.test(b)
    if (aNumeric && bNumeric) return Number(a) < Number(b) ? -1 : 1
    if (aNumeric) return -1
    if (bNumeric) return 1
    return a < b ? -1 : 1
  }
  if (left.length === right.length) return 0
  return left.length < right.length ? -1 : 1
}

/**
 * Compare two parsed versions by semantic-version precedence.
 * @returns a negative number when `left < right`, `0` when equal, positive when greater.
 */
export function compareVersions(left: ParsedVersion, right: ParsedVersion): number {
  if (left.major !== right.major) return left.major < right.major ? -1 : 1
  if (left.minor !== right.minor) return left.minor < right.minor ? -1 : 1
  if (left.patch !== right.patch) return left.patch < right.patch ? -1 : 1
  return comparePrerelease(left.prerelease, right.prerelease)
}

/**
 * Order two version strings.
 * @returns a negative number, zero, or a positive number; unparseable inputs fall back to string order.
 */
export function compareVersionStrings(left: string, right: string): number {
  const a = parseVersion(left)
  const b = parseVersion(right)
  if (a !== undefined && b !== undefined) return compareVersions(a, b)
  if (left === right) return 0
  return left < right ? -1 : 1
}
