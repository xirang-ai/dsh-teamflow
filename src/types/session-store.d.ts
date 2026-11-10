/**
 * Ambient declaration for the Host session store.
 *
 * `@deepseek-ai/dsh-session` ships with the installed Host and declares
 * `sessions` on its own Cordis `Context`; this bundle depends on that package
 * only for the `SessionId` brand and the `SessionStore` / `Session` shapes, so
 * the declaration is repeated here to keep `ctx.get('sessions')` typed in this
 * program.
 *
 * The property is optional on purpose: `get` is how the plugin reaches the
 * service without listing it in `inject`, so headless profiles and unit tests
 * that compose no session store keep loading, and callers must handle the
 * missing branch.
 */
import '@deepseek-ai/cordis'
import type { SessionStore } from '@deepseek-ai/dsh-session'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Live sessions of this Host, when the profile composes a store. */
    readonly sessions?: SessionStore
  }
}
