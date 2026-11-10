/**
 * Locale parity: both dictionaries ship in the same bundle, so a key that only
 * exists in one of them renders as a raw key in the other language.
 *
 * Keys are flat strings that already contain dots (for example
 * `toast.startFailed`), so the path is kept as an array of segments instead of
 * splitting the key again.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import en from '../locale/en.json' with { type: 'json' }
import zh from '../locale/zh.json' with { type: 'json' }

/** One dictionary leaf with the object path that reaches it. */
type Entry = [path: readonly string[], value: unknown]

/** Flatten a nested dictionary into `[path, leaf]` entries. */
function entries(value: Record<string, unknown>, prefix: readonly string[] = []): Entry[] {
  return Object.entries(value).flatMap(([key, entry]) => {
    const path = [...prefix, key]
    return typeof entry === 'object' && entry !== null
      ? entries(entry as Record<string, unknown>, path)
      : [[path, entry] as Entry]
  })
}

/** Stable printable form used to compare and report paths. */
function label(path: readonly string[]): string {
  return path.join('/')
}

describe('locale dictionaries', () => {
  it('declare exactly the same keys', () => {
    assert.deepEqual(entries(zh).map(([path]) => label(path)).sort(), entries(en).map(([path]) => label(path)).sort())
  })

  it('declare every leaf as a non-empty string', () => {
    for (const [locale, dictionary] of [
      ['zh', zh],
      ['en', en],
    ] as const) {
      for (const [path, leaf] of entries(dictionary)) {
        assert.equal(typeof leaf, 'string', `${locale}:${label(path)} must be a string`)
        assert.notEqual((leaf as string).trim(), '', `${locale}:${label(path)} must not be empty`)
      }
    }
  })
})
