'use client'
import {
  ShapeUtil,
  HTMLContainer,
  resizeBox,
  TLResizeInfo,
  RecordProps,
  T,
  Rectangle2d,
  useEditor,
} from 'tldraw'
import { useState, useCallback, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import {
  Trash2, Palette, Bell, Plus, Check, Calendar, Clock,
  AlertCircle,
} from 'lucide-react'
import { ColorPicker } from '@/components/ColorPicker'
import { DeleteConfirmModal } from '@/components/DeleteConfirmModal'
import { ConnectionLinkButton, ConnectionSelectionRing, ConnectionIndicator } from './ConnectionLink'
import { resolveColor } from './bordsShapeTypes'
import type { BordsReminder } from './bordsShapeTypes'
import {
  useReminderStore,
  type ReminderItem,
} from '@/store/reminderStore'

/* ── Shape Util ── */
export class BordsReminderUtil extends ShapeUtil<BordsReminder> {
  static override type = 'bords-reminder' as const

  static override props: RecordProps<BordsReminder> = {
    w: T.number,
    h: T.number,
    reminderId: T.string,
    title: T.string,
    color: T.string,
  }

  getDefaultProps(): BordsReminder['props'] {
    return {
      w: 280,
      h: 320,
      reminderId: '',
      title: 'Reminder',
      color: 'bg-amber-100/90',
    }
  }

  getGeometry(shape: BordsReminder) {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      isFilled: true,
    })
  }

  component(shape: BordsReminder) {
    return <ReminderComponent shape={shape} />
  }

  indicator(shape: BordsReminder) {
    return <rect rx={12} ry={12} width={shape.props.w} height={shape.props.h} fill="none" />
  }

  override canResize() { return true }
  override onResize(shape: BordsReminder, info: TLResizeInfo<any>) {
    return resizeBox(shape as any, info)
  }
}

/* ── helpers ── */
function isOverdue(item: ReminderItem): boolean {
  if (!item.dueDate || item.completed) return false
  const now = new Date()
  const due = new Date(item.dueDate + (item.dueTime ? `T${item.dueTime}` : 'T23:59:59'))
  return now > due
}

function formatDue(item: ReminderItem): string {
  if (!item.dueDate) return ''
  const d = new Date(item.dueDate)
  const parts: string[] = [d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })]
  if (item.dueTime) parts.push(item.dueTime)
  return parts.join(' ')
}

/* ── Component ── */
function ReminderComponent({ shape }: { shape: BordsReminder }) {
  const editor = useEditor()
  const { reminderId, title, color, w, h } = shape.props

  const items = useReminderStore((s) => {
    const r = s.reminders.find((rem) => rem.id === reminderId)
    return r?.items ?? []
  })
  const toggleItem = useReminderStore((s) => s.toggleItem)
  const addItem = useReminderStore((s) => s.addItem)

  const [showControls, setShowControls] = useState(false)
  const [showColorPicker, setShowColorPicker] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState(title)
  const [addingItem, setAddingItem] = useState(false)
  const [newText, setNewText] = useState('')
  const [newDate, setNewDate] = useState('')
  const [newTime, setNewTime] = useState('')
  const colorBtnRef = useRef<HTMLButtonElement>(null)

  const bgColor = resolveColor(color)
  const completed = items.filter((i) => i.completed).length
  const overdue = items.filter(isOverdue).length

  const handleColorChange = useCallback((newColor: string) => {
    editor.updateShape({ id: shape.id, type: 'bords-reminder', props: { color: newColor } })
  }, [editor, shape.id])

  const handleDelete = useCallback(() => {
    editor.deleteShape(shape.id)
    setShowDeleteConfirm(false)
  }, [editor, shape.id])

  const finishTitle = useCallback(() => {
    setEditingTitle(false)
    if (titleDraft.trim() && titleDraft !== title) {
      editor.updateShape({ id: shape.id, type: 'bords-reminder', props: { title: titleDraft.trim() } })
    } else {
      setTitleDraft(title)
    }
  }, [editor, shape.id, title, titleDraft])

  const handleAddItem = useCallback(() => {
    if (!newText.trim()) return
    const item: ReminderItem = {
      id: crypto.randomUUID(),
      text: newText.trim(),
      dueDate: newDate || undefined,
      dueTime: newTime || undefined,
      completed: false,
    }
    addItem(reminderId, item)
    setNewText('')
    setNewDate('')
    setNewTime('')
    setAddingItem(false)
  }, [addItem, reminderId, newText, newDate, newTime])

  return (
    <HTMLContainer id={shape.id} style={{ width: w, height: h, pointerEvents: 'all' }}>
      <div
        data-node-id={reminderId}
        data-item-id={reminderId}
        onMouseEnter={() => setShowControls(true)}
        onMouseLeave={() => setShowControls(false)}
        style={{ width: '100%', height: '100%', position: 'relative' }}
      >
        {/* Connection indicator — dynamic side */}
        <ConnectionIndicator itemId={reminderId} />
        <ConnectionSelectionRing itemId={reminderId} />
        {/* Label badge */}
        <div style={{
          position: 'absolute', top: -8, left: -8,
          background: 'linear-gradient(to right, #f59e0b, #d97706)',
          color: 'white', fontSize: 10, padding: '4px 8px',
          borderRadius: 9999, fontWeight: 500,
          display: 'flex', alignItems: 'center', gap: 4,
          boxShadow: '0 1px 3px rgba(0,0,0,0.2)', zIndex: 2, pointerEvents: 'none',
        }}>
          <Bell size={10} />
          Reminder
          {overdue > 0 && (
            <span style={{
              marginLeft: 2, background: '#dc2626', color: 'white',
              fontSize: 9, padding: '1px 4px', borderRadius: 9999,
            }}>
              {overdue}!
            </span>
          )}
        </div>

        {/* Toolbar */}
        {showControls && (
          <div style={{
            position: 'absolute', top: -8, right: -8,
            background: 'rgba(255,255,255,0.85)', backdropFilter: 'blur(12px)',
            borderRadius: 9999, boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
            border: '1px solid rgba(0,0,0,0.1)',
            display: 'flex', overflow: 'hidden', zIndex: 10,
          }}>
            <button
              ref={colorBtnRef}
              style={{ padding: 10, border: 'none', background: 'none', cursor: 'pointer' }}
              title="Change color"
              onPointerDown={(e) => { e.stopPropagation(); setShowColorPicker(!showColorPicker) }}
            >
              <Palette size={14} color="#9333ea" />
            </button>
            <div style={{ width: 1, background: '#e5e7eb' }} />
            <ConnectionLinkButton itemId={reminderId} itemType="reminder" />
            <div style={{ width: 1, background: '#e5e7eb' }} />
            <button
              style={{ padding: 10, border: 'none', background: 'none', cursor: 'pointer' }}
              title="Delete reminder"
              onPointerDown={(e) => { e.stopPropagation(); setShowDeleteConfirm(true) }}
            >
              <Trash2 size={14} color="#dc2626" />
            </button>
          </div>
        )}

        {/* Card */}
        <div style={{
          width: '100%', height: '100%', backgroundColor: bgColor,
          borderRadius: 12, border: '2px solid rgba(0,0,0,0.1)',
          overflow: 'hidden', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)',
          display: 'flex', flexDirection: 'column',
        }}>
          {/* Header */}
          <div style={{
            padding: '10px 14px', borderBottom: '1px solid rgba(0,0,0,0.08)',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            {editingTitle ? (
              <input
                autoFocus
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onBlur={finishTitle}
                onKeyDown={(e) => { if (e.key === 'Enter') finishTitle(); if (e.key === 'Escape') { setTitleDraft(title); setEditingTitle(false) } }}
                onPointerDown={(e) => e.stopPropagation()}
                style={{
                  flex: 1, fontSize: 14, fontWeight: 700, border: 'none',
                  outline: 'none', background: 'transparent', color: '#1f2937',
                }}
              />
            ) : (
              <span
                onDoubleClick={(e) => { e.stopPropagation(); setEditingTitle(true) }}
                style={{ fontSize: 14, fontWeight: 700, color: '#1f2937', cursor: 'default' }}
              >
                {title}
              </span>
            )}

            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              {items.length > 0 && (
                <span style={{
                  fontSize: 10, padding: '2px 6px', borderRadius: 9999,
                  background: completed === items.length ? 'rgba(34,197,94,0.2)' : 'rgba(0,0,0,0.08)',
                  color: completed === items.length ? '#16a34a' : '#6b7280',
                  fontWeight: 600,
                }}>
                  {completed}/{items.length}
                </span>
              )}
              <button
                onPointerDown={(e) => { e.stopPropagation(); setAddingItem(true) }}
                style={{
                  width: 22, height: 22, borderRadius: 9999, border: 'none',
                  background: 'rgba(0,0,0,0.08)', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                <Plus size={12} color="#374151" />
              </button>
            </div>
          </div>

          {/* Items */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '6px 10px' }}>
            {addingItem && (
              <div style={{
                marginBottom: 8, padding: 8, borderRadius: 8,
                background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(0,0,0,0.1)',
              }}>
                <input
                  autoFocus
                  placeholder="Reminder text..."
                  value={newText}
                  onChange={(e) => setNewText(e.target.value)}
                  onPointerDown={(e) => e.stopPropagation()}
                  style={{
                    width: '100%', fontSize: 12, border: 'none', outline: 'none',
                    background: 'transparent', marginBottom: 4,
                  }}
                />
                <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <Calendar size={10} color="#6b7280" />
                    <input
                      type="date"
                      value={newDate}
                      onChange={(e) => setNewDate(e.target.value)}
                      onPointerDown={(e) => e.stopPropagation()}
                      style={{ fontSize: 10, border: 'none', outline: 'none', background: 'transparent', width: 100 }}
                    />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <Clock size={10} color="#6b7280" />
                    <input
                      type="time"
                      value={newTime}
                      onChange={(e) => setNewTime(e.target.value)}
                      onPointerDown={(e) => e.stopPropagation()}
                      style={{ fontSize: 10, border: 'none', outline: 'none', background: 'transparent', width: 70 }}
                    />
                  </div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 4, marginTop: 4 }}>
                  <button
                    onPointerDown={(e) => { e.stopPropagation(); setAddingItem(false); setNewText(''); setNewDate(''); setNewTime('') }}
                    style={{ fontSize: 10, padding: '2px 8px', border: 'none', background: 'rgba(0,0,0,0.08)', borderRadius: 4, cursor: 'pointer' }}
                  >
                    Cancel
                  </button>
                  <button
                    onPointerDown={(e) => { e.stopPropagation(); handleAddItem() }}
                    style={{ fontSize: 10, padding: '2px 8px', border: 'none', background: '#f59e0b', color: 'white', borderRadius: 4, cursor: 'pointer' }}
                  >
                    Add
                  </button>
                </div>
              </div>
            )}

            {items.length === 0 && !addingItem && (
              <div style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                justifyContent: 'center', height: '100%', color: '#9ca3af', gap: 4,
              }}>
                <Bell size={24} color="#d1d5db" />
                <span style={{ fontSize: 12 }}>No reminders yet</span>
                <span style={{ fontSize: 10, color: '#d1d5db' }}>Click + to add one</span>
              </div>
            )}

            {items.map((item) => {
              const overdue = isOverdue(item)
              return (
                <div
                  key={item.id}
                  style={{
                    display: 'flex', alignItems: 'flex-start', gap: 8,
                    padding: '6px 4px', borderBottom: '1px solid rgba(0,0,0,0.05)',
                    opacity: item.completed ? 0.6 : 1,
                  }}
                >
                  <button
                    onPointerDown={(e) => { e.stopPropagation(); toggleItem(reminderId, item.id) }}
                    style={{
                      width: 18, height: 18, minWidth: 18, borderRadius: 9999,
                      border: `2px solid ${item.completed ? '#22c55e' : overdue ? '#dc2626' : '#d1d5db'}`,
                      background: item.completed ? '#22c55e' : 'transparent',
                      cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      marginTop: 1,
                    }}
                  >
                    {item.completed && <Check size={10} color="white" strokeWidth={3} />}
                  </button>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span style={{
                      fontSize: 12, color: '#1f2937',
                      textDecoration: item.completed ? 'line-through' : 'none',
                      wordBreak: 'break-word',
                    }}>
                      {item.text}
                    </span>
                    {item.dueDate && (
                      <div style={{
                        fontSize: 10, marginTop: 2,
                        color: overdue ? '#dc2626' : '#6b7280',
                        display: 'flex', alignItems: 'center', gap: 3,
                      }}>
                        {overdue && <AlertCircle size={10} />}
                        {formatDue(item)}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Color Picker */}
        {showColorPicker && (
          <ColorPicker
            currentColor={color}
            onSelect={handleColorChange}
            onClose={() => setShowColorPicker(false)}
            triggerRef={colorBtnRef}
          />
        )}
      </div>

      {/* Delete Confirm */}
      <DeleteConfirmModal
        isOpen={showDeleteConfirm}
        onConfirm={handleDelete}
        onCancel={() => setShowDeleteConfirm(false)}
        itemName={title}
        itemType="reminder"
      />
    </HTMLContainer>
  )
}
