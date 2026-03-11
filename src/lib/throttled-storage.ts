import type { StateStorage } from 'zustand/middleware'

/**
 * A localStorage wrapper that throttles writes to avoid blocking the main
 * thread during rapid state changes (e.g. drag operations at 30–60fps).
 *
 * Reads are always instant (synchronous from localStorage).
 * Writes are batched — only the latest value is written, at most once per
 * `intervalMs` (default 1000ms).
 */
export function createThrottledStorage(intervalMs = 1000): StateStorage {
  const pending = new Map<string, string>()
  let timer: ReturnType<typeof setTimeout> | null = null

  const flush = () => {
    timer = null
    for (const [key, value] of pending) {
      try { localStorage.setItem(key, value) } catch { /* quota exceeded — ignore */ }
    }
    pending.clear()
  }

  // Flush all pending writes before the page unloads (reload / close / navigate).
  // Without this, any writes batched but not yet flushed would be lost.
  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', flush)
  }

  return {
    getItem(name: string): string | null {
      // If there's a pending write, return it (most recent state)
      return pending.get(name) ?? localStorage.getItem(name)
    },
    setItem(name: string, value: string): void {
      pending.set(name, value)
      if (!timer) {
        timer = setTimeout(flush, intervalMs)
      }
    },
    removeItem(name: string): void {
      pending.delete(name)
      localStorage.removeItem(name)
    },
  }
}

/** Shared instance — 1 second throttle for all stores */
export const throttledStorage = createThrottledStorage(1000)
