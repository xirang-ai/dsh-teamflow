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
import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve, sep } from 'node:path'

/** Path segments below `$DSH_HOME` that this plugin owns. */
export const PLUGIN_HOME_SEGMENTS = ['xirang-ai', 'dsh-teamflow'] as const

/** Database file name inside the plugin data directory. */
export const DATABASE_FILENAME = 'teamflow.sqlite'

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
