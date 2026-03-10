'use client'
import { useState } from 'react'
import { XCircle, Plus, Calendar, Trash2 } from 'lucide-react'
import { useChecklistStore, CHECKLIST_COLORS } from '../store/checklistStore'
import toast from 'react-hot-toast'
import { useBoardStore } from '../store/boardStore'
import { useThemeStore } from '../store/themeStore'
import { useZIndexStore } from '../store/zIndexStore'

interface TaskItem {
  id: string
  text: string
  date: string
  time: string
}

interface ChecklistFormProps {
  onClose: () => void
  position: { x: number; y: number }
}

export function ChecklistForm({ onClose, position }: ChecklistFormProps) {
  const [title, setTitle] = useState('')
  const [color, setColor] = useState('bg-blue-100/90')
  const [items, setItems] = useState<TaskItem[]>([{ 
    id: Date.now().toString(), 
    text: '', 
    date: '', 
    time: '' 
  }])
  const { addChecklist } = useChecklistStore()
  const currentBoardId = useBoardStore((state) => state.currentBoardId)
  const addItemToBoard = useBoardStore((state) => state.addItemToBoard)
  const isDark = useThemeStore((state) => state.isDark)
  const bringToFront = useZIndexStore((state) => state.bringToFront)

  const validateDateTime = (date: string, time: string) => {
    if ((date && !time) || (!date && time)) {
      return false;
    }
    if (!date || !time) return true;

    const dateTime = new Date(`${date}T${time}`);
    return dateTime > new Date();
  };

  const getMinTime = (date: string) => {
    if (date === new Date().toISOString().split('T')[0]) {
      const now = new Date();
      return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    }
    return '00:00';
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validate all date/time pairs
    const isValid = items.every(item => {
      return validateDateTime(item.date, item.time);
    });

    if (!isValid) {
      toast.error('Please provide both date and time, and ensure they are in the future');
      return;
    }

    const checklistId = Date.now().toString();

    addChecklist({
      id: checklistId,
      title,
      items: items.map(item => ({
        id: item.id,
        text: item.text,
        completed: false,
        deadline: item.date && item.time 
          ? new Date(`${item.date}T${item.time}:00`) // Add seconds to ensure proper Date creation
          : undefined,
        timeSpent: 0,
        isTracking: false
      })),
      position,
      color,
      createdAt: new Date().toISOString()
    })

    // Add checklist to current board
    if (currentBoardId) {
      addItemToBoard(currentBoardId, 'checklists', checklistId)
    }

    bringToFront(checklistId)
    onClose()
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/40 backdrop-blur-md z-50">
      <form onSubmit={handleSubmit} className={`${color} p-8 rounded-3xl shadow-2xl w-[560px] border border-white/20`}>
        {/* Header */}
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-semibold text-gray-800">New Checklist</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 hover:bg-white/60 backdrop-blur-sm rounded-full p-2 transition-all duration-200 hover:scale-110"
          >
            <XCircle size={20} />
          </button>
        </div>

        {/* Title and Color Selection */}
        <div className="mb-6">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Checklist title"
            className="w-full p-3 mb-5 border-0 rounded-2xl focus:ring-2 focus:ring-blue-400/50 focus:outline-none bg-white/90 backdrop-blur-sm shadow-sm text-gray-900 placeholder:text-gray-500"
            autoFocus
          />

          <div className="flex gap-3 justify-center">
            {Object.entries(CHECKLIST_COLORS).map(([name, colorClass]) => (
              <button
                key={name}
                type="button"
                onClick={() => setColor(colorClass)}
                className={`
                  w-10 h-10 rounded-full ${colorClass} 
                  ${color === colorClass ? 'ring-2 ring-offset-2 ring-blue-500 scale-110' : 'hover:scale-105'}
                  transition-all duration-200 border border-black/5 shadow-md hover:shadow-lg
                `}
              />
            ))}
          </div>
        </div>

        {/* Tasks */}
        <div className="space-y-3 mb-6 max-h-[40vh] overflow-y-auto">
          {items.map((item, index) => (
            <div key={item.id} className="flex gap-2 group">
              <div className="flex-1 space-y-2">
                <input
                  type="text"
                  value={item.text}
                  onChange={(e) => {
                    const newItems = [...items]
                    newItems[index].text = e.target.value
                    setItems(newItems)
                  }}
                  placeholder="Task description"
                  className="w-full p-3 border-0 rounded-xl bg-white/90 backdrop-blur-sm shadow-sm text-gray-900 placeholder:text-gray-500 focus:ring-2 focus:ring-blue-400/50 focus:outline-none"
                />
                {index === 0 && (
                  <p className="text-xs text-gray-600 px-1">
                    💡 Leave date & time empty if you don't want to set a deadline
                  </p>
                )}
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <input
                      type="date"
                      value={item.date}
                      onChange={(e) => {
                        const newItems = [...items]
                        newItems[index].date = e.target.value
                        // Reset time if date is changed
                        newItems[index].time = '';
                        setItems(newItems)
                      }}
                      min={new Date().toISOString().split('T')[0]}
                      className={`w-full p-2.5 border-0 rounded-xl text-sm pr-8 bg-white/90 backdrop-blur-sm shadow-sm text-gray-900 focus:ring-2 focus:outline-none
                        ${item.time && !item.date ? 'ring-2 ring-red-400 bg-red-50' : 'focus:ring-blue-400/50'}
                      `}
                    />
                    <Calendar className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                  </div>
                  <input
                    type="time"
                    value={item.time}
                    onChange={(e) => {
                      const newItems = [...items]
                      newItems[index].time = e.target.value
                      setItems(newItems)
                    }}
                    min={item.date ? getMinTime(item.date) : undefined}
                    className={`p-2.5 border-0 rounded-xl text-sm w-32 bg-white/90 backdrop-blur-sm shadow-sm text-gray-900 focus:ring-2 focus:outline-none
                      ${item.date && !item.time ? 'ring-2 ring-red-400 bg-red-50' : 'focus:ring-blue-400/50'}
                    `}
                    disabled={!item.date}
                  />
                </div>
              </div>
              {items.length > 1 && (
                <button
                  type="button"
                  onClick={() => setItems(items.filter((_, i) => i !== index))}
                  className="p-2 text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all hover:scale-110 rounded-lg hover:bg-red-50"
                >
                  <Trash2 size={16} />
                </button>
              )}
            </div>
          ))}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => setItems([...items, { id: Date.now().toString(), text: '', date: '', time: '' }])}
            className="flex items-center gap-2 text-sm text-gray-700 hover:text-gray-900 font-medium hover:scale-105 transition-all duration-200"
          >
            <Plus size={16} />
            Add task
          </button>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2.5 text-gray-700 hover:bg-white/60 backdrop-blur-sm rounded-xl transition-all duration-200 font-medium hover:scale-105"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2.5 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-xl hover:from-blue-600 hover:to-blue-700 transition-all duration-200 font-medium shadow-md hover:shadow-lg hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
              disabled={!title.trim()}
            >
              Create Checklist
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}
