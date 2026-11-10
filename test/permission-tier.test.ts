/**
 * The permission-tier table and its wire validation, plus the promise that the
 * permission values live in exactly one place.
 *
 * The literals matter: they are matched against the Host's own
 * `SANDBOX_MODES` / `APPROVAL_POLICIES`, so a typo here would silently start a
 * session in the wrong mode. Importing the Host constants and comparing them
 * literally is the cheapest way to catch that before a release.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

import { SANDBOX_MODES } from '@deepseek-ai/dsh-sandbox-policy'
import { APPROVAL_POLICIES } from '@deepseek-ai/dsh-user-approval'

import en from '../locale/en.json' with { type: 'json' }
import zh from '../locale/zh.json' with { type: 'json' }
import {
  DEFAULT_PERMISSION_TIER,
  PERMISSION_TIERS,
  PERMISSION_TIER_DEFINITIONS,
  PERMISSION_TIER_LIST,
  isPermissionTier,
  permissionTierDefinition,
  readPermissionTierInput,
} from '../src/permission-tier.ts'

describe('permission tier table', () => {
  it('defines every tier exactly once, in menu order', () => {
    assert.deepEqual(
      PERMISSION_TIER_DEFINITIONS.map((definition) => definition.tier),
      [...PERMISSION_TIERS],
    )
    assert.equal(DEFAULT_PERMISSION_TIER, 'normal')
    assert.equal(PERMISSION_TIER_LIST, 'normal, readonly, full')
  })

  it('uses the Host sandbox and approval values verbatim', () => {
    for (const definition of PERMISSION_TIER_DEFINITIONS) {
      assert.ok(
        (SANDBOX_MODES as readonly string[]).includes(definition.sandbox),
        `${definition.tier} sandbox "${definition.sandbox}" is not one of ${SANDBOX_MODES.join(', ')}`,
      )
      assert.ok(
        (APPROVAL_POLICIES as readonly string[]).includes(definition.approval),
        `${definition.tier} approval "${definition.approval}" is not one of ${APPROVAL_POLICIES.join(', ')}`,
      )
    }
    assert.deepEqual(
      PERMISSION_TIER_DEFINITIONS.map((definition) => definition.sandbox),
      ['workspace-write', 'read-only', 'danger-full-access'],
    )
    assert.deepEqual(
      PERMISSION_TIER_DEFINITIONS.map((definition) => definition.approval),
      ['ask', 'ask', 'never'],
    )
  })

  it('keeps every label, description and badge in both dictionaries', () => {
    for (const definition of PERMISSION_TIER_DEFINITIONS) {
      for (const key of [definition.nameKey, definition.descriptionKey, definition.badgeKey]) {
        assert.equal(typeof zh[key as keyof typeof zh], 'string', `zh is missing ${key}`)
        assert.equal(typeof en[key as keyof typeof en], 'string', `en is missing ${key}`)
      }
    }
    assert.equal(zh['tier.normal.name' as keyof typeof zh], '普通执行')
    assert.equal(zh['tier.readonly.name' as keyof typeof zh], '仅查看执行')
    assert.equal(zh['tier.full.name' as keyof typeof zh], '完全权限执行')
    assert.equal(zh['tier.normal.badge' as keyof typeof zh], '普通')
    assert.equal(zh['tier.readonly.badge' as keyof typeof zh], '仅查看')
    assert.equal(zh['tier.full.badge' as keyof typeof zh], '完全权限')
    assert.equal(zh['run.button' as keyof typeof zh], '执行')
  })

  it('rejects an id without a definition', () => {
    assert.throws(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      () => permissionTierDefinition('bogus' as any),
      /teamflow: permission tier "bogus" has no definition/,
    )
  })

  it('recognizes only the three exact ids', () => {
    assert.equal(isPermissionTier('normal'), true)
    assert.equal(isPermissionTier('readonly'), true)
    assert.equal(isPermissionTier('full'), true)
    assert.equal(isPermissionTier('Normal'), false)
    assert.equal(isPermissionTier('read-only'), false)
    assert.equal(isPermissionTier(''), false)
    assert.equal(isPermissionTier(null), false)
    assert.equal(isPermissionTier(3), false)
  })
})

describe('readPermissionTierInput', () => {
  it('treats missing, null, empty and blank as "not passed"', () => {
    for (const raw of [undefined, null, '', '   ']) {
      assert.deepEqual(readPermissionTierInput(raw), { ok: true, tier: null })
    }
  })

  it('accepts the three ids', () => {
    assert.deepEqual(readPermissionTierInput('normal'), { ok: true, tier: 'normal' })
    assert.deepEqual(readPermissionTierInput('readonly'), { ok: true, tier: 'readonly' })
    assert.deepEqual(readPermissionTierInput('full'), { ok: true, tier: 'full' })
    assert.deepEqual(readPermissionTierInput(' full '), { ok: true, tier: 'full' })
  })

  it('refuses anything else instead of falling back to the default', () => {
    for (const raw of ['Full', 'READONLY', 'danger-full-access', 'read-only', 'workspace-write', 'bogus', 7, true]) {
      const parsed = readPermissionTierInput(raw)
      assert.equal(parsed.ok, false, `${String(raw)} should be refused`)
      if (!parsed.ok) assert.equal(parsed.value, String(raw))
    }
  })
})

describe('permission values stay out of the pages', () => {
  const files = [
    'src/client/page.tsx',
    'src/client/run-tier.tsx',
    'src/client/session-tier.tsx',
    'src/client/session.tsx',
    'src/client/index.tsx',
  ]

  it('never spells a sandbox value in a page or component', () => {
    for (const path of files) {
      const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
      for (const literal of ['read-only', 'workspace-write', 'danger-full-access']) {
        assert.equal(
          source.includes(`'${literal}'`),
          false,
          `${path} must not hardcode the permission value "${literal}"`,
        )
        assert.equal(
          source.includes(`"${literal}"`),
          false,
          `${path} must not hardcode the permission value "${literal}"`,
        )
      }
    }
  })

  it('does not split the three tiers into three separate buttons', () => {
    for (const path of files) {
      const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
      assert.equal(
        /tier\.(normal|readonly|full)\.name/.test(source),
        false,
        `${path} must render tier names from the table, not per-tier branches`,
      )
    }
  })
})
