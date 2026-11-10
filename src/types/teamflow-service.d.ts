/**
 * Ambient declaration for the service this bundle provides.
 *
 * The Host plugin provides the opened database as `ctx.teamflow`; the tools
 * subpath plugin (mounted inside preset compositions) reads it lazily so it
 * never opens a second database or races the Host plugin's startup.
 *
 * @module
 */

import type { TeamflowDatabase } from '../store/db.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The workbench database, when the main teamflow plugin has applied. */
    readonly teamflow?: TeamflowDatabase
  }
}
