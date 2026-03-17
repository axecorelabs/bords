/**
 * Centralized Reminder System
 * ============================
 * Single source of truth for scheduling, queuing, deduplicating, and sending
 * reminders across all board item types (checklists, kanban boards, reminder widgets).
 *
 * Features:
 * - Unified API for all reminder sources
 * - Deduplication (same reminder won't fire twice)
 * - Retry with exponential backoff (3 attempts)
 * - Sequential queue to avoid overwhelming the mail API
 * - Cooldown window per item (configurable, default 4 minutes)
 * - Deadline scheduler that auto-fires at 30m, 10m, 5m, and 0m before deadline
 * - Queue cancellation when items/components are deleted
 * - Tab-focus recovery to catch deadlines missed while tab was inactive
 * - Sent-log for debugging & UI feedback
 *
 * Limitations:
 * - Client-side only — if the browser tab is closed, timeouts are lost.
 *   Server-side cron (/api/cron/check-reminders) covers that gap by scanning
 *   synced board data and sending emails independently.
 */

import { format, isPast, formatDistanceToNow } from 'date-fns'
import toast from 'react-hot-toast'

// ─── KILL SWITCH ─────────────────────────────────────────────────────────────
// Set to true to completely disable the reminder system (no timers, no intervals,
// no visibility listeners, no network calls). Remove this when re-enabling.
const REMINDERS_DISABLED = true

// ─── Types ───────────────────────────────────────────────────────────────────

export type ReminderSource = 'checklist' | 'kanban' | 'reminder'

export interface ReminderRecipient {
  email: string
  name: string
}

/** A single item within a reminder email */
export interface ReminderEmailItem {
  text: string
  dueDate?: string   // formatted display string e.g. "Mar 1, 3:00 PM"
  overdue?: boolean
  completed?: boolean
}

/** Payload sent to the unified API */
export interface SendReminderPayload {
  source: ReminderSource
  /** Title of the parent container (checklist title, kanban board title, reminder title) */
  title: string
  /** Individual items — for checklist single-item reminders this will be length 1 */
  items: ReminderEmailItem[]
  /** If omitted, sends to the logged-in user */
  recipient?: ReminderRecipient
  /** Optional note from the sender */
  message?: string
  /** For checklist: the specific time-remaining label ("30 minutes", "overdue", etc.) */
  timeRemaining?: string
  /** Internal: watchId that created this payload, used for cancellation */
  _watchId?: string
}

export interface SentRecord {
  key: string
  source: ReminderSource
  title: string
  sentAt: string
  recipient: string
  success: boolean
  error?: string
}

// ─── Constants ───────────────────────────────────────────────────────────────

const API_ENDPOINT = '/api/reminders/send'
const MAX_RETRIES = 3
const BASE_RETRY_DELAY = 1000              // 1 second, then 2s, then 4s
const DEFAULT_COOLDOWN_MS = 4 * 60 * 1000  // 4 minutes between identical sends
const SENT_LOG_MAX = 200                    // max entries kept in memory

/** Standard intervals before a deadline at which reminders fire */
export const DEADLINE_INTERVALS = [
  { offsetMs: 30 * 60 * 1000, label: '30 minutes', urgent: false },
  { offsetMs: 10 * 60 * 1000, label: '10 minutes', urgent: true },
  { offsetMs: 5 * 60 * 1000,  label: '5 minutes',  urgent: true },
  { offsetMs: 0,               label: 'overdue',    urgent: true },
] as const

// ─── Internal state ──────────────────────────────────────────────────────────

/** Keys of reminders already sent / in cooldown → timestamp of last send */
const sentKeys = new Map<string, number>()

// Periodically evict expired sentKeys entries (older than 10 min) to prevent unbounded growth
if (!REMINDERS_DISABLED) {
  setInterval(() => {
    const cutoff = Date.now() - 10 * 60_000
    for (const [k, ts] of sentKeys) {
      if (ts < cutoff) sentKeys.delete(k)
    }
  }, 5 * 60_000)
}

/** Sequential processing queue */
let queue: Array<{ payload: SendReminderPayload; resolve: (v: SendResult) => void }> = []
let processing = false

/** Set of watchIds that have been cancelled — checked before sending */
const cancelledWatchIds = new Set<string>()

/** In-memory sent log (most recent first) */
let sentLog: SentRecord[] = []

/** Active deadline timeouts keyed by a unique watchId so they can be cleared */
const activeWatchers = new Map<string, NodeJS.Timeout[]>()

/** All active watcher configs — used for tab-focus recovery */
const activeConfigs = new Map<string, DeadlineWatchConfig>()

/** Whether the visibility listener has been installed */
let visibilityListenerInstalled = false

// ─── Public API ──────────────────────────────────────────────────────────────

export interface SendResult {
  success: boolean
  messageId?: string
  error?: string
  deduplicated?: boolean
  cancelled?: boolean
}

/**
 * Queue a reminder to be sent. Returns a promise that resolves once the email
 * is dispatched (or deduplicated / rejected).
 *
 * This is the **single entry-point** all components should use.
 */
export function sendReminder(payload: SendReminderPayload): Promise<SendResult> {
  if (REMINDERS_DISABLED) return Promise.resolve({ success: true, deduplicated: true })
  const key = buildKey(payload)

  // ── Deduplication / cooldown check ──
  const lastSent = sentKeys.get(key)
  if (lastSent && Date.now() - lastSent < DEFAULT_COOLDOWN_MS) {
    return Promise.resolve({ success: true, deduplicated: true })
  }

  return new Promise((resolve) => {
    queue.push({ payload, resolve })
    processQueue()
  })
}

/**
 * Send a reminder immediately with a toast notification (the common pattern
 * used by components). Shows a success/error toast automatically.
 */
export async function sendReminderWithToast(
  payload: SendReminderPayload,
  opts?: { silentOnDedup?: boolean }
): Promise<SendResult> {
  const result = await sendReminder(payload)

  if (result.deduplicated || result.cancelled) {
    return result
  }

  if (result.success) {
    const target = payload.recipient?.name || 'you'
    toast.success(`Reminder emailed to ${target}`)
  } else {
    toast.error(result.error || 'Failed to send reminder')
  }

  return result
}

/**
 * Send a toast-only notification (no email) for deadline alerts that only need
 * in-app visibility.
 */
export function showReminderToast(text: string, urgent = false) {
  toast(text, {
    icon: urgent ? '⚠️' : '⏰',
    duration: 5000,
  })
}

// ─── Deadline Scheduling ─────────────────────────────────────────────────────

export interface DeadlineWatchItem {
  /** Unique id for this item (e.g. checklist-item id, kanban task id) */
  itemId: string
  text: string
  deadline: Date
  completed: boolean
}

export interface DeadlineWatchConfig {
  /** Unique namespace so we can clear old watchers (e.g. "checklist-abc123") */
  watchId: string
  source: ReminderSource
  /** Parent container title */
  title: string
  items: DeadlineWatchItem[]
  /** Optional recipient — if omitted, emails go to the logged-in user */
  recipient?: ReminderRecipient
  /** Whether to also show a toast when the deadline fires (default true) */
  showToast?: boolean
}

/**
 * Watch a set of items for upcoming deadlines and automatically queue reminders
 * at the standard intervals (30m, 10m, 5m, at-deadline).
 *
 * Call this inside a useEffect — it returns a cleanup function.
 *
 * ```ts
 * useEffect(() => {
 *   return watchDeadlines({ watchId: `checklist-${id}`, source: 'checklist', ... })
 * }, [items, title])
 * ```
 */
export function watchDeadlines(config: DeadlineWatchConfig): () => void {
  if (REMINDERS_DISABLED) return () => {} // No-op when disabled
  const { watchId, source, title, items, recipient, showToast = true } = config

  // Clear any previous watchers for this watchId
  clearWatcher(watchId)

  // Remove from cancelled set since we're re-creating this watcher
  cancelledWatchIds.delete(watchId)

  // Store config for tab-focus recovery
  activeConfigs.set(watchId, config)

  const timeouts: NodeJS.Timeout[] = []

  items.forEach((item) => {
    if (item.completed || !item.deadline) return

    const now = Date.now()
    const deadlineMs = item.deadline.getTime()
    const timeUntil = deadlineMs - now

    DEADLINE_INTERVALS.forEach(({ offsetMs, label, urgent }) => {
      const fireIn = timeUntil - offsetMs

      if (fireIn > 0) {
        // Schedule future reminder
        const t = setTimeout(() => {
          // Check if this watcher was cancelled (item/component deleted)
          if (cancelledWatchIds.has(watchId)) return
          fireDeadlineReminder(source, title, item, label, urgent, recipient, showToast, watchId)
        }, fireIn)
        timeouts.push(t)
      } else if (offsetMs === 0 && timeUntil <= 0 && timeUntil > -60_000) {
        // Deadline just passed (within last minute) — fire overdue immediately
        fireDeadlineReminder(source, title, item, 'overdue', true, recipient, showToast, watchId)
      }
    })
  })

  activeWatchers.set(watchId, timeouts)

  // Install visibility listener (once globally) for tab-focus recovery
  installVisibilityListener()

  return () => clearWatcher(watchId)
}

/**
 * Cancel all scheduled deadline reminders for a given watchId.
 * Also removes any queued-but-not-yet-sent reminders from the queue.
 */
export function clearWatcher(watchId: string) {
  // 1. Clear scheduled timeouts
  const existing = activeWatchers.get(watchId)
  if (existing) {
    existing.forEach((t) => clearTimeout(t))
    activeWatchers.delete(watchId)
  }

  // 2. Mark as cancelled so any in-flight timeout callbacks + queue items are skipped
  cancelledWatchIds.add(watchId)

  // 3. Drain cancelled items from the queue (resolve them immediately)
  const remaining: typeof queue = []
  for (const job of queue) {
    if (job.payload._watchId === watchId) {
      job.resolve({ success: false, cancelled: true })
    } else {
      remaining.push(job)
    }
  }
  queue = remaining

  // 4. Remove stored config
  activeConfigs.delete(watchId)

  // Clean up old cancelled IDs periodically (don't let the set grow forever)
  if (cancelledWatchIds.size > 50) {
    const arr = Array.from(cancelledWatchIds)
    cancelledWatchIds.clear()
    // Keep only the last 20
    arr.slice(-20).forEach((id) => cancelledWatchIds.add(id))
  }
}

// ─── Helpers for building payloads (convenience for components) ──────────────

/**
 * Build a SendReminderPayload for a checklist item deadline.
 */
export function buildChecklistPayload(
  checklistTitle: string,
  item: { text: string; deadline?: Date | null },
  timeRemaining: string,
): SendReminderPayload {
  return {
    source: 'checklist',
    title: checklistTitle,
    timeRemaining,
    items: [{
      text: item.text,
      dueDate: item.deadline ? format(item.deadline, 'MMM d, yyyy @ h:mm a') : undefined,
      overdue: timeRemaining === 'overdue',
      completed: false,
    }],
  }
}

/**
 * Build a SendReminderPayload for a kanban task deadline.
 */
export function buildKanbanPayload(
  boardTitle: string,
  task: { title: string; dueDate?: string; completed?: boolean },
  timeRemaining: string,
): SendReminderPayload {
  const dt = task.dueDate ? new Date(task.dueDate) : null
  return {
    source: 'kanban',
    title: boardTitle,
    timeRemaining,
    items: [{
      text: task.title,
      dueDate: dt ? format(dt, 'MMM d, yyyy @ h:mm a') : undefined,
      overdue: timeRemaining === 'overdue',
      completed: task.completed ?? false,
    }],
  }
}

/**
 * Build a SendReminderPayload for the Reminder widget (multi-item).
 */
export function buildReminderWidgetPayload(
  reminderTitle: string,
  items: Array<{ text: string; dueDate?: string; dueTime?: string; completed: boolean }>,
  recipient?: ReminderRecipient,
): SendReminderPayload {
  return {
    source: 'reminder',
    title: reminderTitle,
    recipient,
    items: items.map((item) => {
      const hasDue = item.dueDate && item.dueTime
      const dt = hasDue ? new Date(`${item.dueDate}T${item.dueTime}`) : null
      return {
        text: item.text,
        dueDate: dt ? format(dt, 'MMM d, h:mm a') : undefined,
        overdue: dt ? isPast(dt) : false,
        completed: item.completed,
      }
    }),
  }
}

// ─── Sent Log ────────────────────────────────────────────────────────────────

/** Get the in-memory sent log (most recent first). */
export function getSentLog(): readonly SentRecord[] {
  return sentLog
}

/** Clear the sent log. */
export function clearSentLog() {
  sentLog = []
}

// ─── Tab-focus recovery ──────────────────────────────────────────────────────

/**
 * When the user returns to the tab after it's been backgrounded, re-evaluate
 * all active watchers. Any deadlines that passed while the tab was hidden will
 * fire their overdue reminders immediately.
 * 
 * Throttled to max once per 10 seconds to avoid firing hundreds of timers
 * when rapidly switching tabs.
 */
let lastVisibilityRun = 0
function onVisibilityChange() {
  if (document.visibilityState !== 'visible') return

  const now = Date.now()
  if (now - lastVisibilityRun < 10_000) return // Throttle: max once per 10s
  lastVisibilityRun = now

  // Re-schedule all active configs (the constructor deduplicates via clearWatcher)
  for (const config of activeConfigs.values()) {
    watchDeadlines(config)
  }
}

function installVisibilityListener() {
  if (REMINDERS_DISABLED) return
  if (visibilityListenerInstalled) return
  if (typeof document === 'undefined') return
  document.addEventListener('visibilitychange', onVisibilityChange)
  visibilityListenerInstalled = true
}

// ─── Private helpers ─────────────────────────────────────────────────────────

function buildKey(payload: SendReminderPayload): string {
  const recipientKey = payload.recipient?.email || '_self'
  const itemsKey = payload.items.map((i) => i.text).join('|')
  const timeKey = payload.timeRemaining || ''
  return `${payload.source}::${payload.title}::${itemsKey}::${recipientKey}::${timeKey}`
}

async function processQueue() {
  if (processing) return
  processing = true

  while (queue.length > 0) {
    const job = queue.shift()!

    // Check if the watcher was cancelled while waiting in the queue
    if (job.payload._watchId && cancelledWatchIds.has(job.payload._watchId)) {
      job.resolve({ success: false, cancelled: true })
      continue
    }

    const result = await executeWithRetry(job.payload)
    job.resolve(result)
  }

  processing = false
}

async function executeWithRetry(payload: SendReminderPayload): Promise<SendResult> {
  const key = buildKey(payload)
  let lastError = ''

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    // Re-check cancellation between retries
    if (payload._watchId && cancelledWatchIds.has(payload._watchId)) {
      return { success: false, cancelled: true }
    }

    try {
      const res = await fetch(API_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        lastError = data.error || `HTTP ${res.status}`

        // Don't retry on client errors (4xx) — only on server / network errors
        if (res.status >= 400 && res.status < 500) {
          break
        }
        throw new Error(lastError)
      }

      const data = await res.json()

      // Record success
      sentKeys.set(key, Date.now())
      addToLog(key, payload, true)

      return { success: true, messageId: data.messageId }
    } catch (err: any) {
      lastError = err.message || 'Network error'

      // Wait before retrying (exponential backoff)
      if (attempt < MAX_RETRIES - 1) {
        await sleep(BASE_RETRY_DELAY * Math.pow(2, attempt))
      }
    }
  }

  addToLog(buildKey(payload), payload, false, lastError)
  return { success: false, error: lastError }
}

function fireDeadlineReminder(
  source: ReminderSource,
  title: string,
  item: DeadlineWatchItem,
  timeRemaining: string,
  urgent: boolean,
  recipient: ReminderRecipient | undefined,
  showToast: boolean,
  watchId: string,
) {
  // Check cancellation before doing anything
  if (cancelledWatchIds.has(watchId)) return

  // Show toast
  if (showToast) {
    showReminderToast(
      timeRemaining === 'overdue'
        ? `Deadline reached: ${item.text}`
        : `Reminder: ${item.text} is due in ${timeRemaining}`,
      urgent,
    )
  }

  // Build payload based on source
  let payload: SendReminderPayload
  if (source === 'checklist') {
    payload = buildChecklistPayload(title, { text: item.text, deadline: item.deadline }, timeRemaining)
  } else if (source === 'kanban') {
    payload = buildKanbanPayload(title, { title: item.text, dueDate: item.deadline.toISOString() }, timeRemaining)
  } else {
    payload = {
      source,
      title,
      timeRemaining,
      recipient,
      items: [{
        text: item.text,
        dueDate: format(item.deadline, 'MMM d, h:mm a'),
        overdue: timeRemaining === 'overdue',
        completed: false,
      }],
    }
  }

  if (recipient) payload.recipient = recipient

  // Tag with watchId so queue cancellation works
  payload._watchId = watchId

  // Queue the email send (fire-and-forget with internal retry)
  sendReminder(payload)
}

function addToLog(key: string, payload: SendReminderPayload, success: boolean, error?: string) {
  sentLog.unshift({
    key,
    source: payload.source,
    title: payload.title,
    sentAt: new Date().toISOString(),
    recipient: payload.recipient?.email || 'self',
    success,
    error,
  })
  if (sentLog.length > SENT_LOG_MAX) {
    sentLog = sentLog.slice(0, SENT_LOG_MAX)
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
