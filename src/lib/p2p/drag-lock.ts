/**
 * While a collaborator drags a shape, we show it moving from their direct (peer-to-peer) updates.
 * The same drag also reaches us a moment later through the shared document, with OLDER positions.
 * Applying those would yank the shape backwards and then forwards again, so while a shape is
 * "locked" the shared-document position is ignored.
 *
 * The lock expires `ttlMs` after the last preview, or shortly after the sender says the drag ended.
 * On expiry `onExpire` fires so the caller can reconcile the shape to the shared document's value:
 * that final position may have arrived (and been ignored) while the lock was held.
 */

interface Options {
  ttlMs?: number
  /** How long after an explicit "drag ended" message to keep the lock (lets the final server update land). */
  endGraceMs?: number
  onExpire: (id: string) => void
  now?: () => number
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
}

export function createDragLock({
  ttlMs = 500,
  endGraceMs = 300,
  onExpire,
  now = () => Date.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
}: Options) {
  const locks = new Map<string, { until: number; timer: unknown }>()

  function arm(id: string, ms: number) {
    const existing = locks.get(id)
    if (existing) clearTimer(existing.timer)
    const until = now() + ms
    const timer = setTimer(() => {
      const cur = locks.get(id)
      if (!cur || cur.until > now()) return // re-armed since
      locks.delete(id)
      onExpire(id)
    }, ms + 5)
    locks.set(id, { until, timer })
  }

  return {
    /** A direct preview for this shape just arrived. */
    touch(id: string) {
      arm(id, ttlMs)
    },
    /** The sender reported the drag ended: keep the lock just long enough for the final update. */
    end(id: string) {
      if (locks.has(id)) arm(id, endGraceMs)
    },
    isLocked(id: string) {
      const l = locks.get(id)
      return Boolean(l && l.until > now())
    },
    dispose() {
      for (const l of locks.values()) clearTimer(l.timer)
      locks.clear()
    },
  }
}
