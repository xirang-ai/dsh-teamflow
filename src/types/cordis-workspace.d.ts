/**
 * Ambient declaration for the Host workspace registry service.
 *
 * `@deepseek-ai/dsh-workspace` ships with the installed Host, so this bundle
 * does not depend on it; it only uses `get(id).path` to resolve document
 * bodies that live in the workspace directory. Declaring the service on
 * Cordis' `Context` keeps `ctx.get('workspaceRegistry')` typed without an
 * explicit type argument (which Cordis rejects: the argument must be a
 * declared Context key).
 *
 * The property is optional on purpose: a profile may compose no registry, and
 * callers must then fall back to the paths recorded in the plugin database.
 */
import '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Registered workspace directories, when the profile composes one. */
    readonly workspaceRegistry?:
      | {
          get(workspaceId: string): { readonly path: string } | undefined
          list?(): readonly {
            readonly id: string
            readonly path: string
            readonly title?: string
          }[]
        }
      | undefined
  }
}
