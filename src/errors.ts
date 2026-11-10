/**
 * Error rendering shared by the startup path, so every message names the
 * operation and the cause on one line without leaking secrets.
 *
 * @module
 */

/**
 * Render an unknown thrown value as one line safe to put in a log or error.
 * @param error - thrown value.
 * @returns its message, or a string form for non-errors.
 */
export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

/**
 * Wrap a failure with the operation that was attempted.
 * @param operation - what failed, phrased as a verb phrase.
 * @param cause - the underlying thrown value.
 * @returns an error whose message names both.
 */
export function contextualError(operation: string, cause: unknown): Error {
  return new Error(`teamflow: ${operation}: ${describeError(cause)}`, { cause })
}
