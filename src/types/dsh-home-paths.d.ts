/**
 * Ambient types for the Host-provided home-path helper.
 *
 * `@deepseek-ai/dsh-home-paths` is resolved at runtime from the installed Host
 * (like every other `@deepseek-ai/dsh-*` package a plugin imports). It is not a
 * local install, so this file declares exactly the surface used here.
 */
declare module '@deepseek-ai/dsh-home-paths' {
  /** Join path segments onto the resolved Harness home. */
  export function dshHomePath(...segments: string[]): string

  /** Resolve the Harness home: explicit override, then `$DSH_HOME`, then `~/.dsh`. */
  export function resolveDshHome(configured?: string, env?: Record<string, string | undefined>): string
}
