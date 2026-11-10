/**
 * Identity of the running build.
 *
 * The plugin version is read from the package manifest at runtime rather than
 * injected at build time: the Host half is compiled by `tsc` and the browser
 * half is bundled by `esbuild`, and one manifest read gives both the same
 * answer.
 *
 * @module
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describeError } from './errors.ts'

/** Package name, mirrored by the module id the browser half registers. */
export const PLUGIN_NAME = '@xirang-ai/dsh-teamflow'

/**
 * Read the running package version from `package.json`.
 * @returns the manifest `version` field.
 * @throws when the manifest is missing or malformed — a broken install must fail loudly.
 */
export function readPluginVersion(): string {
  const manifestPath = fileURLToPath(new URL('../package.json', import.meta.url))
  let raw: string
  try {
    raw = readFileSync(manifestPath, 'utf8')
  } catch (error) {
    throw new Error(`teamflow: cannot read its package manifest: ${describeError(error)}`)
  }

  let manifest: unknown
  try {
    manifest = JSON.parse(raw)
  } catch (error) {
    throw new Error(`teamflow: its package manifest is not valid JSON: ${describeError(error)}`)
  }

  if (typeof manifest !== 'object' || manifest === null) {
    throw new Error('teamflow: its package manifest is not a JSON object')
  }
  const version = (manifest as Record<string, unknown>)['version']
  if (typeof version !== 'string' || version.trim() === '') {
    throw new Error('teamflow: its package manifest has no usable "version" field')
  }
  return version.trim()
}
