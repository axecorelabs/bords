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
  type SvgExportContext,
} from 'tldraw'
import { useState, useCallback, useMemo, useRef } from 'react'
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  createColumnHelper,
  type ColumnDef,
} from '@tanstack/react-table'
import { Trash2, Palette, Plus, X, Table2 } from 'lucide-react'
import { ColorPicker } from '@/components/ColorPicker'
import { DeleteConfirmModal } from '@/components/DeleteConfirmModal'
import { useTableStore } from '@/store/tableStore'
import { useThemeStore } from '@/store/themeStore'
import { ConnectionLinkButton, ConnectionSelectionRing, ConnectionIndicator } from './ConnectionLink'
import { truncateText } from './bordsShapeTypes'
import type { BordsTable } from './bordsShapeTypes'

/* ── Shape Util ── */
export class BordsTableUtil extends ShapeUtil<BordsTable> {
  static override type = 'bords-table' as const

  static override props: RecordProps<BordsTable> = {
    w: T.number,
    h: T.number,
    title: T.string,
    color: T.string,
    tableId: T.string,
  }

  getDefaultProps(): BordsTable['props'] {
    return {
      w: 500,
      h: 300,
      title: 'Table',
      color: 'transparent',
      tableId: '',
    }
  }

  getGeometry(shape: BordsTable) {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      isFilled: true,
    })
  }

  override canResize() { return true }
  override canEdit() { return true }
  override isAspectRatioLocked() { return false }
  override onResize(shape: BordsTable, info: TLResizeInfo<BordsTable>) {
    return resizeBox(shape, info)
  }

  /* ── SVG export — pure SVG table grid, no foreignObject ── */
  override toSvg(shape: BordsTable, _ctx: SvgExportContext) {
    const { w, h, title, tableId } = shape.props
    const isDark = useThemeStore.getState().isDark
    const tableData = useTableStore.getState().tables.find((t) => t.id === tableId)
    const columns = tableData?.columns || ['Column 1', 'Column 2', 'Column 3']
    const rows = tableData?.rows || []

    const headerH = 40
    const rowH = 32
    const colW = w / columns.length
    const fontSize = 12
    const borderColor = isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.18)'
    const textColor = isDark ? '#e4e4e7' : '#27272a'
    const headerBg = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)'
    const bg = isDark ? '#27272a' : '#ffffff'

    const maxRows = Math.floor((h - headerH) / rowH)
    const visibleRows = rows.slice(0, maxRows)

    return (
      <g>
        {/* Background */}
        <rect width={w} height={h} rx={8} ry={8} fill={bg} stroke={borderColor} strokeWidth={1} />
        {/* Header row background */}
        <rect width={w} height={headerH} rx={8} ry={8} fill={headerBg} />
        {/* Fix bottom corners of header (overlap with full rect) */}
        <rect y={8} width={w} height={headerH - 8} fill={headerBg} />
        {/* Column headers */}
        {columns.map((col, ci) => (
          <g key={ci}>
            <text x={ci * colW + 10} y={headerH / 2 + 4} fontSize={fontSize} fontWeight="600" fill={textColor}
              fontFamily="system-ui, -apple-system, sans-serif">
              {truncateText(col, colW - 20, fontSize)}
            </text>
            {/* Vertical divider */}
            {ci > 0 && <line x1={ci * colW} y1={0} x2={ci * colW} y2={h} stroke={borderColor} strokeWidth={1} />}
          </g>
        ))}
        {/* Header bottom border */}
        <line x1={0} y1={headerH} x2={w} y2={headerH} stroke={borderColor} strokeWidth={1} />
        {/* Data rows */}
        {visibleRows.map((row, ri) => {
          const ry = headerH + ri * rowH
          return (
            <g key={ri}>
              {/* Row bottom border */}
              <line x1={0} y1={ry + rowH} x2={w} y2={ry + rowH} stroke={borderColor} strokeWidth={0.5} />
              {row.map((cell, ci) => (
                <text key={ci} x={ci * colW + 10} y={ry + rowH / 2 + 4} fontSize={fontSize} fill={textColor}
                  fontFamily="system-ui, -apple-system, sans-serif">
                  {truncateText(cell.value, colW - 20, fontSize)}
                </text>
              ))}
            </g>
          )
        })}
      </g>
    )
  }

  component(shape: BordsTable) {
    return <TableComponent shape={shape} />
  }

  indicator(shape: BordsTable) {
    return <rect width={shape.props.w} height={shape.props.h} rx={8} />
  }
}

/* ── Row type for tanstack ── */
type RowData = Record<string, string>

/* ── Component ── */
function TableComponent({ shape }: { shape: BordsTable }) {
  const editor = useEditor()
  const isDark = useThemeStore((s) => s.isDark)
  const { title, w, h, tableId } = shape.props
  const [showControls, setShowControls] = useState(false)
  const [showColorPicker, setShowColorPicker] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [editingCell, setEditingCell] = useState<{ row: number; col: string } | null>(null)
  const [editingHeader, setEditingHeader] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState(false)
  const colorBtnRef = useRef<HTMLButtonElement>(null)
  const lastTapRef = useRef<{ key: string; time: number }>({ key: '', time: 0 })

  // Unified double-tap/double-click handler — works on both touch and mouse.
  // Mouse uses native onDoubleClick; touch uses onPointerDown tap detection.
  const doubleTap = useCallback(
    (key: string, handler: () => void) => ({
      onPointerDown: (e: React.PointerEvent) => {
        e.stopPropagation()
        if (e.pointerType !== 'touch') return
        const now = Date.now()
        if (lastTapRef.current.key === key && now - lastTapRef.current.time < 350) {
          handler()
          lastTapRef.current = { key: '', time: 0 }
        } else {
          lastTapRef.current = { key, time: now }
        }
      },
      onDoubleClick: (e: React.MouseEvent) => {
        e.stopPropagation()
        handler()
      },
    }),
    []
  )

  const tableData = useTableStore((s) => s.tables.find((t) => t.id === tableId))
  const { updateCell, addRow, deleteRow, addColumn, deleteColumn, updateColumnHeader, updateTable } = useTableStore()

  const columns = tableData?.columns || ['Column 1', 'Column 2', 'Column 3']
  const rows = tableData?.rows || []

  // Theme-aware colors — stronger contrast in light mode
  const borderColor = isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.18)'
  const borderColorLight = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.10)'
  const textColor = isDark ? '#e4e4e7' : '#27272a'
  const textColorMuted = isDark ? '#a1a1aa' : '#52525b'
  const headerBg = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'
  const titleBarBg = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)'
  const hoverBg = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)'
  const inputBg = isDark ? '#27272a' : '#ffffff'
  const inputBorder = isDark ? '#52525b' : '#d4d4d8'
  const inputText = isDark ? '#e4e4e7' : '#18181b'
  const cardBg = isDark ? 'rgba(24,24,27,0.85)' : 'rgba(255,255,255,0.85)'

  // Convert store rows → tanstack row objects
  const data: RowData[] = useMemo(() =>
    rows.map((row) => {
      const obj: RowData = {}
      columns.forEach((_, ci) => {
        obj[`col_${ci}`] = row[ci]?.value ?? ''
      })
      return obj
    }),
    [rows, columns]
  )

  // Build tanstack columns dynamically
  const tanstackColumns: ColumnDef<RowData, string>[] = useMemo(() => {
    const helper = createColumnHelper<RowData>()
    return columns.map((header, ci) =>
      helper.accessor(`col_${ci}`, {
        id: `col_${ci}`,
        header: () => header,
        cell: (info) => info.getValue(),
      })
    )
  }, [columns])

  const table = useReactTable({
    data,
    columns: tanstackColumns,
    getCoreRowModel: getCoreRowModel(),
  })

  const handleColorChange = useCallback((newColor: string) => {
    editor.updateShape({ id: shape.id, type: 'bords-table', props: { color: newColor } })
    if (tableId) updateTable(tableId, { color: newColor })
    setShowColorPicker(false)
  }, [editor, shape.id, tableId, updateTable])

  const handleDelete = useCallback(() => {
    editor.deleteShape(shape.id)
    setShowDeleteConfirm(false)
  }, [editor, shape.id])

  const handleTitleChange = useCallback((newTitle: string) => {
    editor.updateShape({ id: shape.id, type: 'bords-table', props: { title: newTitle } })
    if (tableId) updateTable(tableId, { title: newTitle })
    setEditingTitle(false)
  }, [editor, shape.id, tableId, updateTable])

  return (
    <HTMLContainer id={shape.id} style={{ width: w, height: h, pointerEvents: 'all' }}>
      <div
        data-node-id={tableId}
        data-item-id={tableId}
        onMouseEnter={() => setShowControls(true)}
        onMouseLeave={(e) => {
          const rect = e.currentTarget.getBoundingClientRect()
          const above = rect.top - 44
          if (e.clientY >= above && e.clientY <= rect.bottom && e.clientX >= rect.left - 20 && e.clientX <= rect.right + 20) return
          setShowControls(false)
        }}
        style={{ position: 'relative', width: '100%', height: '100%' }}
      >
        {/* Hover bridge for toolbar */}
        {showControls && (
          <div style={{ position: 'absolute', top: -44, left: -20, right: -20, height: 44, zIndex: 5 }} />
        )}
        {/* Connection indicator — dynamic side */}
        <ConnectionIndicator itemId={tableId} />
        {/* Connection selection ring */}
        <ConnectionSelectionRing itemId={tableId} />

        {/* Label badge */}
        <div
          style={{
            position: 'absolute', top: -8, left: -8, zIndex: 2, pointerEvents: 'none',
            display: 'flex', alignItems: 'center', gap: 4,
            padding: '4px 8px', borderRadius: 9999,
            background: 'linear-gradient(to right, #0891b2, #0e7490)',
            color: 'white', fontSize: 10, fontWeight: 500,
            boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
          }}
        >
          <Table2 size={10} />
          Table
        </div>

        {/* Toolbar */}
        {showControls && (
          <div
            style={{ position: 'absolute', top: -36, right: 0, zIndex: 10, display: 'flex', gap: 4 }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <button
              onPointerDown={(e) => { e.stopPropagation(); if (tableId) addColumn(tableId, `Col ${columns.length + 1}`) }}
              style={{
                height: 28, padding: '0 8px', borderRadius: 6,
                background: isDark ? '#27272a' : 'rgba(255,255,255,0.95)',
                border: `1px solid ${borderColor}`,
                display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer',
                fontSize: 10, color: '#0891b2', fontWeight: 500,
              }}
              title="Add column"
            >
              <Plus size={10} /> Col
            </button>
            <button
              onPointerDown={(e) => { e.stopPropagation(); if (tableId) addRow(tableId) }}
              style={{
                height: 28, padding: '0 8px', borderRadius: 6,
                background: isDark ? '#27272a' : 'rgba(255,255,255,0.95)',
                border: `1px solid ${borderColor}`,
                display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer',
                fontSize: 10, color: '#0891b2', fontWeight: 500,
              }}
              title="Add row"
            >
              <Plus size={10} /> Row
            </button>
            <div style={{ width: 1, height: 28, background: borderColor }} />
            <button
              ref={colorBtnRef}
              onPointerDown={(e) => { e.stopPropagation(); setShowColorPicker(!showColorPicker) }}
              style={{
                width: 28, height: 28, borderRadius: 6,
                background: isDark ? '#27272a' : 'rgba(255,255,255,0.95)',
                border: `1px solid ${borderColor}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
              }}
              title="Change color"
            >
              <Palette size={14} color={textColorMuted} />
            </button>
            <ConnectionLinkButton
              itemId={tableId}
              itemType="table"
              style={{
                width: 28, height: 28, padding: 0, borderRadius: 6,
                background: isDark ? '#27272a' : 'rgba(255,255,255,0.95)',
                border: `1px solid ${borderColor}`,
              }}
            />
            <button
              onPointerDown={(e) => { e.stopPropagation(); setShowDeleteConfirm(true) }}
              style={{
                width: 28, height: 28, borderRadius: 6,
                background: isDark ? '#27272a' : 'rgba(255,255,255,0.95)',
                border: `1px solid ${borderColor}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
              }}
              title="Delete table"
            >
              <Trash2 size={14} color="#f87171" />
            </button>
          </div>
        )}

        {/* Color Picker */}
        {showColorPicker && (
          <div style={{ position: 'absolute', top: -36, right: 180, zIndex: 20 }} onPointerDown={(e) => e.stopPropagation()}>
            <ColorPicker
              currentColor={shape.props.color}
              onSelect={handleColorChange}
              onClose={() => setShowColorPicker(false)}
              useHex
              triggerRef={colorBtnRef}
            />
          </div>
        )}

        {/* Main card — frosted glass background */}
        <div
          style={{
            width: '100%', height: '100%', borderRadius: 8,
            border: `1px solid ${borderColor}`,
            display: 'flex', flexDirection: 'column', overflow: 'hidden',
            background: cardBg,
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            boxShadow: isDark
              ? '0 2px 8px rgba(0,0,0,0.3)'
              : '0 2px 8px rgba(0,0,0,0.06), 0 0 0 1px rgba(0,0,0,0.04)',
          }}
        >
          {/* Title bar */}
          <div
            style={{
              padding: '8px 12px', borderBottom: `1px solid ${borderColor}`,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              background: titleBarBg, flexShrink: 0,
            }}
          >
            {editingTitle ? (
              <input
                autoFocus
                defaultValue={title}
                onBlur={(e) => handleTitleChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleTitleChange((e.target as HTMLInputElement).value)
                  if (e.key === 'Escape') setEditingTitle(false)
                  e.stopPropagation()
                }}
                onPointerDown={(e) => e.stopPropagation()}
                style={{
                  fontSize: 13, fontWeight: 600, color: inputText,
                  background: inputBg, border: `1px solid ${inputBorder}`,
                  borderRadius: 4, padding: '2px 6px', outline: 'none', width: '100%',
                }}
              />
            ) : (
              <span
                {...doubleTap('title', () => setEditingTitle(true))}
                style={{
                  fontSize: 13, fontWeight: 600, color: textColor,
                  cursor: 'text', userSelect: 'none',
                }}
              >
                {title}
              </span>
            )}
          </div>

          {/* Table content — @tanstack/react-table */}
          <div style={{ flex: 1, overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                {table.getHeaderGroups().map((headerGroup) => (
                  <tr key={headerGroup.id}>
                    {headerGroup.headers.map((header, ci) => (
                      <th
                        key={header.id}
                        style={{
                          padding: '6px 8px', textAlign: 'left', fontWeight: 600,
                          color: textColorMuted, background: headerBg,
                          borderBottom: `2px solid ${borderColor}`,
                          borderRight: ci < columns.length - 1 ? `1px solid ${borderColorLight}` : 'none',
                          minWidth: 80, position: 'sticky', top: 0, zIndex: 1,
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          {editingHeader === header.id ? (
                            <input
                              autoFocus
                              defaultValue={columns[ci]}
                              onBlur={(e) => {
                                if (tableId) updateColumnHeader(tableId, ci, e.target.value)
                                setEditingHeader(null)
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  if (tableId) updateColumnHeader(tableId, ci, (e.target as HTMLInputElement).value)
                                  setEditingHeader(null)
                                }
                                if (e.key === 'Escape') setEditingHeader(null)
                                e.stopPropagation()
                              }}
                              onPointerDown={(e) => e.stopPropagation()}
                              style={{
                                fontSize: 12, fontWeight: 600, color: inputText,
                                background: inputBg, border: `1px solid ${inputBorder}`,
                                borderRadius: 4, padding: '1px 4px', outline: 'none', width: '100%',
                              }}
                            />
                          ) : (
                            <span
                              {...doubleTap(`header-${header.id}`, () => setEditingHeader(header.id))}
                              style={{ cursor: 'text', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                            >
                              {flexRender(header.column.columnDef.header, header.getContext())}
                            </span>
                          )}
                          {columns.length > 1 && (
                            <button
                              onPointerDown={(e) => { e.stopPropagation(); if (tableId) deleteColumn(tableId, ci) }}
                              style={{
                                width: 16, height: 16, borderRadius: 4,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                cursor: 'pointer', opacity: 0, background: 'transparent', border: 'none',
                                transition: 'opacity 0.15s',
                              }}
                              onMouseEnter={(e) => { (e.target as HTMLElement).style.opacity = '1' }}
                              onMouseLeave={(e) => { (e.target as HTMLElement).style.opacity = '0' }}
                              title="Delete column"
                            >
                              <X size={10} color="#ef4444" />
                            </button>
                          )}
                        </div>
                      </th>
                    ))}
                    {/* Row action column */}
                    <th style={{ width: 28, background: headerBg, borderBottom: `2px solid ${borderColor}` }} />
                  </tr>
                ))}
              </thead>
              <tbody>
                {table.getRowModel().rows.map((row, ri) => (
                  <tr
                    key={row.id}
                    style={{ borderBottom: `1px solid ${borderColorLight}`, transition: 'background 0.1s' }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = hoverBg }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                  >
                    {row.getVisibleCells().map((cell, ci) => (
                      <td
                        key={cell.id}
                        style={{
                          padding: '4px 8px', verticalAlign: 'top',
                          borderRight: ci < columns.length - 1 ? `1px solid ${borderColorLight}` : 'none',
                        }}
                      >
                        {editingCell?.row === ri && editingCell?.col === cell.column.id ? (
                          <input
                            autoFocus
                            defaultValue={cell.getValue() as string}
                            onBlur={(e) => {
                              if (tableId) updateCell(tableId, ri, ci, e.target.value)
                              setEditingCell(null)
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                if (tableId) updateCell(tableId, ri, ci, (e.target as HTMLInputElement).value)
                                setEditingCell(null)
                              }
                              if (e.key === 'Escape') setEditingCell(null)
                              if (e.key === 'Tab') {
                                e.preventDefault()
                                if (tableId) updateCell(tableId, ri, ci, (e.target as HTMLInputElement).value)
                                const nextCi = ci + 1 < columns.length ? ci + 1 : 0
                                const nextRi = nextCi === 0 ? ri + 1 : ri
                                if (nextRi < rows.length) {
                                  setEditingCell({ row: nextRi, col: `col_${nextCi}` })
                                } else {
                                  setEditingCell(null)
                                }
                              }
                              e.stopPropagation()
                            }}
                            onPointerDown={(e) => e.stopPropagation()}
                            style={{
                              fontSize: 12, color: inputText,
                              background: inputBg, border: `1px solid #3b82f6`,
                              borderRadius: 4, padding: '1px 4px', outline: 'none', width: '100%',
                              boxShadow: '0 0 0 2px rgba(59,130,246,0.2)',
                            }}
                          />
                        ) : (
                          <span
                            {...doubleTap(`cell-${ri}-${cell.column.id}`, () => setEditingCell({ row: ri, col: cell.column.id }))}
                            style={{
                              cursor: 'text', color: textColor,
                              display: 'block', minHeight: 18,
                            }}
                          >
                            {(cell.getValue() as string) || '\u00A0'}
                          </span>
                        )}
                      </td>
                    ))}
                    <td style={{ width: 28, padding: '4px 2px', textAlign: 'center' }}>
                      {rows.length > 1 && (
                        <button
                          onPointerDown={(e) => { e.stopPropagation(); if (tableId) deleteRow(tableId, ri) }}
                          style={{
                            width: 18, height: 18, borderRadius: 4,
                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                            cursor: 'pointer', opacity: 0, background: 'transparent', border: 'none',
                            transition: 'opacity 0.15s',
                          }}
                          onMouseEnter={(e) => { (e.target as HTMLElement).style.opacity = '1' }}
                          onMouseLeave={(e) => { (e.target as HTMLElement).style.opacity = '0' }}
                          title="Delete row"
                        >
                          <X size={10} color="#ef4444" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td
                      colSpan={columns.length + 1}
                      style={{ padding: '16px 0', textAlign: 'center', color: textColorMuted, fontSize: 12 }}
                    >
                      No rows yet. Click &quot;+ Row&quot; to add data.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Delete confirm modal */}
        {showDeleteConfirm && (
          <DeleteConfirmModal
            isOpen={true}
            itemName="this table"
            itemType="table"
            onConfirm={handleDelete}
            onCancel={() => setShowDeleteConfirm(false)}
          />
        )}
      </div>
    </HTMLContainer>
  )
}
