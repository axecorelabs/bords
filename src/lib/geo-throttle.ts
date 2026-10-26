/**
 * Per-item throttle for geometry updates (position / size) coming out of a drag or resize.
 *
 * Why a throttle and not a debounce: a debounce restarts its timer on every event, so while
 * you keep dragging it never fires and collaborators only see the item once it is dropped.
 * This one:
 *   - sends the first change immediately (leading edge),
 *   - then at most once per `intervalMs` with the newest values while the drag continues,
 *   - and always delivers the final values (trailing edge).
 * Content changes (anything outside `geoFields`) are sent immediately, merged with any
 * geometry that was still queued so it isn't lost.
 */

export type Updates = Record<string, any>
export type UpdateFn = (id: string, updates: Updates) => void

interface Options {
  intervalMs: number
  geoFields: Set<string>
  /** Wraps every delivery (the canvas uses it to mark the write as locally originated). */
  run: (id: string, updates: Updates, fn: UpdateFn) => void
}

export function createGeoThrottle({ intervalMs, geoFields, run }: Options) {
  const state = new Map<string, { timer: ReturnType<typeof setTimeout>; pending: Updates | null }>()

  /** Forget queued geometry for an item (the caller is about to send current values itself). */
  function drop(id: string) {
    const s = state.get(id)
    if (s) {
      clearTimeout(s.timer)
      state.delete(id)
    }
  }

  function apply(id: string, updates: Updates, fn: UpdateFn) {
    if (Object.keys(updates).length === 0) return
    const geoOnly = Object.keys(updates).every((k) => geoFields.has(k))
    const s = state.get(id)

    if (!geoOnly) {
      drop(id)
      run(id, s?.pending ? { ...s.pending, ...updates } : updates, fn)
      return
    }

    // Inside the cooldown after a send: remember the newest values; the trailing send delivers them.
    if (s) {
      s.pending = { ...(s.pending ?? {}), ...updates }
      fns.set(id, fn)
      return
    }

    // Leading edge: send now, then open the cooldown window.
    fns.set(id, fn)
    run(id, updates, fn)
    const tick = () => {
      const cur = state.get(id)
      if (!cur) return
      if (cur.pending) {
        const next = cur.pending
        cur.pending = null
        run(id, next, fn)
        cur.timer = setTimeout(tick, intervalMs) // keep the window open while the drag continues
      } else {
        state.delete(id)
      }
    }
    state.set(id, { timer: setTimeout(tick, intervalMs), pending: null })
  }

  const fns = new Map<string, UpdateFn>()

  /** Deliver every queued update right now (tab closing, board switching) so the last position isn't lost. */
  function flush() {
    for (const [id, s] of state) {
      if (!s.pending) continue
      const next = s.pending
      s.pending = null
      const fn = fns.get(id)
      if (fn) run(id, next, fn)
    }
  }

  /** Cancel every queued update (board switch / unmount). */
  function dispose() {
    for (const s of state.values()) clearTimeout(s.timer)
    state.clear()
    fns.clear()
  }

  return { apply, drop, flush, dispose }
}
