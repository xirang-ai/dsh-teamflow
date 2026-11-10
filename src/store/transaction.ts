/**
 * One transaction primitive shared by the startup path and the workflow store.
 *
 * Keeping it in its own module avoids a cycle between the database opener and
 * the domain operations that run on the opened handle.
 *
 * @module
 */
import type { DatabaseSync } from 'node:sqlite'

import { describeError } from '../errors.ts'

/**
 * Run `body` inside one immediate transaction, rolling back on any throw.
 * @param db - open database whose connection owns the transaction.
 * @param body - synchronous work to run inside the transaction.
 * @returns whatever `body` returns.
 */
export function withTransaction<T>(db: DatabaseSync, body: () => T): T {
  db.exec('BEGIN IMMEDIATE')
  try {
    const value = body()
    db.exec('COMMIT')
    return value
  } catch (error) {
    try {
      db.exec('ROLLBACK')
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        `teamflow: database transaction failed and its rollback failed: ${describeError(error)}`,
      )
    }
    throw error
  }
}
