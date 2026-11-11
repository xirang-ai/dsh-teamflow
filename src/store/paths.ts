/**
 * Filesystem locations owned by this plugin.
 *
 * The plugin keeps its durable data under the Host's own home so that it
 * survives workspace changes, and so that one machine has exactly one
 * workbench database. `$DSH_HOME` is resolved through the Host helper, which
 * honours an explicit override, then `$DSH_HOME`, then `~/.dsh`.
 *
 * @module
 */
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { existsSync, mkdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve, sep } from 'node:path'

import { describeError } from '../errors.ts'

/** Path segments below `$DSH_HOME` that this plugin owns. */
export const PLUGIN_HOME_SEGMENTS = ['xirang-ai', 'dsh-teamflow'] as const

/** Database file name inside the plugin data directory. */
export const DATABASE_FILENAME = 'teamflow.sqlite'

/** Directory name of the markdown documents below the plugin data directory. */
export const DOCS_DIRNAME = 'docs'

/** Human-readable directory of the durable data, e.g. `$DSH_HOME/xirang-ai/dsh-teamflow`. */
export function defaultDataDir(): string {
  return dshHomePath(...PLUGIN_HOME_SEGMENTS)
}

/**
 * Resolve the data directory: an explicit `Config.dataDir` wins, otherwise the
 * plugin home below `$DSH_HOME`. A relative override is resolved against the
 * process working directory, and `~/` is expanded so a configured path never
 * silently becomes `<cwd>/~`.
 * @param configured - `Config.dataDir`, possibly empty.
 * @returns the absolute data directory.
 */
export function resolveDataDir(configured?: string): string {
  const trimmed = configured?.trim()
  if (trimmed === undefined || trimmed === '') return defaultDataDir()
  if (trimmed === '~') return homedir()
  if (trimmed.startsWith(`~${sep}`) || trimmed.startsWith('~/')) return join(homedir(), trimmed.slice(2))
  return resolve(trimmed)
}

/** Default document root: `<dataDir>/docs`, next to the database. */
export function defaultDocsDir(dataDir: string): string {
  return join(dataDir, DOCS_DIRNAME)
}

/**
 * Resolve the document root: an explicit `Config.docsDir` wins, otherwise
 * `<dataDir>/docs`. Relative overrides resolve against the process working
 * directory and `~/` is expanded, mirroring {@link resolveDataDir}.
 *
 * Validation is loud on purpose: a malformed override or a path that is
 * already a file fails plugin load with the field name and the accepted forms
 * instead of silently falling back to the default directory.
 *
 * @param configured - `Config.docsDir`, possibly empty.
 * @param dataDir - the resolved data directory.
 * @returns the absolute document root.
 */
export function resolveDocsDir(configured: string | undefined, dataDir: string): string {
  const trimmed = configured?.trim() ?? ''
  if (trimmed === '') return defaultDocsDir(dataDir)
  const expected = 'an absolute path, a path relative to the working directory, or a path starting with "~/"'
  if (trimmed.includes('\0')) {
    throw new Error(`teamflow: config "docsDir" must be ${expected}, got ${JSON.stringify(configured)}`)
  }
  let absolute: string
  if (trimmed === '~') {
    absolute = homedir()
  } else if (trimmed.startsWith(`~${sep}`) || trimmed.startsWith('~/')) {
    absolute = join(homedir(), trimmed.slice(2))
  } else {
    absolute = resolve(trimmed)
  }
  if (existsSync(absolute) && !statSync(absolute).isDirectory()) {
    throw new Error(
      `teamflow: config "docsDir" must point to a directory, but ${toDisplayPath(absolute)} is a file`,
    )
  }
  return absolute
}

/** Create the document root (owner-only) and return it. */
export function ensureDocsDir(docsDir: string): string {
  try {
    mkdirSync(docsDir, { recursive: true, mode: 0o700 })
  } catch (error) {
    throw new Error(
      `teamflow: could not create the docs directory ${toDisplayPath(docsDir)} (config "docsDir"): ${describeError(error)}`,
      { cause: error },
    )
  }
  return docsDir
}

/** Absolute database file path for a resolved data directory. */
export function databaseFile(dataDir: string): string {
  return join(dataDir, DATABASE_FILENAME)
}

/** Create the data directory (owner-only) and return it. */
export function ensureDataDir(dataDir: string): string {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 })
  return dataDir
}

/**
 * Render a path for logs and errors without leaking the absolute home
 * directory of the current user.
 * @param path - absolute path to describe.
 * @returns `~/...` below the OS home, `$DSH_HOME/...` below the Host home, otherwise the path.
 */
export function toDisplayPath(path: string): string {
  const home = homedir()
  if (path === home) return '~'
  if (path.startsWith(`${home}${sep}`)) return `~${path.slice(home.length)}`
  const dshHome = dshHomePath()
  if (path === dshHome) return '$DSH_HOME'
  if (path.startsWith(`${dshHome}${sep}`)) return `$DSH_HOME${path.slice(dshHome.length)}`
  return path
}
