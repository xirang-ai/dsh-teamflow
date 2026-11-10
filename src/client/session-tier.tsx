/**
 * The read-only permission badge in the conversation header.
 *
 * It answers one question — which tier did this conversation start with — from
 * the workbench's own run record, never from the browser's current settings and
 * never from the request the tab was opened with. A conversation without a
 * record (older sessions, sessions started elsewhere) shows nothing at all:
 * the header must not invent "普通" for a session whose permissions nobody
 * knows.
 *
 * The badge is display-only on purpose. Switching permissions inside a session
 * already has its own entry point, and this label must not compete with it.
 *
 * @module
 */
import { useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'

import { permissionTierDefinition, type PermissionTier } from '../permission-tier.ts'
import type { TranslateFn } from './context.ts'

/** Props of {@link SessionTierBadge}. */
export interface SessionTierBadgeProps {
  readonly t: TranslateFn
  /** Conversation the header is showing. */
  readonly sessionId: string
  /** Read the recorded tier for a conversation; resolves to null when none. */
  readonly load: (sessionId: string) => Promise<{ readonly permissionTier: PermissionTier | null }>
}

/**
 * Short tier label with the full explanation on hover.
 * @param props - translator, conversation id and the lookup.
 * @returns the badge, or null while unknown / unrecorded.
 */
export function SessionTierBadge({ t, sessionId, load }: SessionTierBadgeProps): ReactElement | null {
  const [tier, setTier] = useState<PermissionTier | null>(null)
  // `inject` hands a fresh callback on every render; keeping it in a ref makes
  // the lookup depend on the conversation only, so it runs once per session.
  const loadRef = useRef(load)
  loadRef.current = load

  useEffect(() => {
    let active = true
    setTier(null)
    if (sessionId.length === 0) return () => { active = false }
    loadRef
      .current(sessionId)
      .then((reply) => {
        if (active) setTier(reply.permissionTier)
      })
      .catch(() => {
        // Unknown is the same as unrecorded here: show no badge rather than a
        // wrong one.
        if (active) setTier(null)
      })
    return () => {
      active = false
    }
  }, [sessionId])

  if (tier === null) return null
  const definition = permissionTierDefinition(tier)
  const badge = t(definition.badgeKey)
  const description = t(definition.descriptionKey)
  return (
    <span className="tf-tier-badge" data-tier={tier} title={description} aria-label={`${badge}: ${description}`}>
      {badge}
    </span>
  )
}
