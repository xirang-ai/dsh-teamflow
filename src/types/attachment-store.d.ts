/**
 * Ambient declaration for the Host attachment store.
 *
 * `@deepseek-ai/dsh-attachment` declares `attachments` on its own Cordis
 * `Context`, but this bundle only ever reads the deployment's image policy from
 * it, so the two members it uses are repeated here instead of taking a
 * dependency for one getter.
 *
 * The property is optional because `get` is how the plugin reaches the service
 * without listing it in `inject`: a headless profile that composes no store
 * still loads, and the Create page then has no limits to mirror.
 */
import '@deepseek-ai/cordis'

/** The part of the Host attachment store the workbench reads. */
export interface AttachmentStoreLike {
  /** Deployment-resolved image policy, the same object the composer projects. */
  readonly imageLimits: {
    readonly maxImageBytes: number
    readonly maxImagesPerMessage: number
    readonly maxMessageImageBytes: number
    readonly mediaTypes: readonly string[]
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Durable attachment store, when the profile composes one. */
    readonly attachments?: AttachmentStoreLike
  }
}
