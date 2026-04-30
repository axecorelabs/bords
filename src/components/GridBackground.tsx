'use client'
import { useRef, WheelEvent, useState, useEffect } from 'react'
import { useThemeStore, THEME_COLORS } from '../store/themeStore'
import { useGridStore } from '../store/gridStore'
import { motion } from 'framer-motion'
import { useBoardStore } from '../store/boardStore'

interface GridBackgroundProps {
  hoveredCell: number | null;
  onCellHover: (index: number) => void;
  onCellClick: (index: number) => void;
}

export function GridBackground({ hoveredCell, onCellHover, onCellClick }: GridBackgroundProps) {
  const isDark = useThemeStore((state) => state.isDark)
  const { isGridVisible, gridColor, gridType, zoom, setZoom, scrollY, setScrollY } = useGridStore()
  const colorTheme = useThemeStore((state) => state.colorTheme)
  const containerRef = useRef<HTMLDivElement>(null)
  const currentBoardId = useBoardStore((state) => state.currentBoardId)
  const currentBoard = useBoardStore((state) => 
    state.boards.find(board => board.id === currentBoardId)
  )
  const hasCustomBackground = !!(currentBoard?.backgroundImage || currentBoard?.backgroundColor)
  
  // Add effect to handle initial grid color
  useEffect(() => {
    const gridStore = useGridStore.getState()
    if (isDark && !gridStore.gridColor.includes('80')) { // Check if not already a dark mode color
      gridStore.setGridColor(THEME_COLORS.gridColors.dark.gray.value)
    } else if (!isDark && gridStore.gridColor.includes('80')) { // Check if not already a light mode color
      gridStore.setGridColor(THEME_COLORS.gridColors.light.gray.value)
    }
  }, [isDark])

  const handleWheel = (e: WheelEvent<HTMLDivElement>) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault()
      const newZoom = zoom + (-e.deltaY * 0.002)
      const clampedZoom = Math.min(Math.max(0.25, newZoom), 2)
      setZoom(Math.round(clampedZoom * 100) / 100)
    } else {
      e.preventDefault()
      const scrollSpeed = 1.5
      const newScrollY = scrollY + (e.deltaY * scrollSpeed)
      const maxScroll = window.innerHeight * 0.5
      setScrollY(Math.max(0, Math.min(newScrollY, maxScroll)))
    }
  }

  return (
    <div 
      ref={containerRef}
      className="fixed inset-0 pointer-events-none"
      style={{ height: '3000px', userSelect: 'none'  }} // Make grid extend beyond viewport
      onWheel={handleWheel}
    >
      {/* Base background layer — only when no custom background */}
      {!hasCustomBackground && (
        <div 
          className={`
            absolute inset-0
            ${isDark ? 'bg-zinc-900' : 'bg-zinc-100'}
            transition-colors duration-200
          `}
        />
      )}
      
      {/* Semi-transparent blur overlay - between background and grid */}
      {hasCustomBackground && currentBoard?.backgroundOverlay && (
        <div 
          className="absolute inset-0"
          style={{
            backdropFilter: `blur(${{ sm: '4px', md: '12px', lg: '24px', xl: '40px' }[currentBoard.backgroundBlurLevel || 'md']})`,
            WebkitBackdropFilter: `blur(${{ sm: '4px', md: '12px', lg: '24px', xl: '40px' }[currentBoard.backgroundBlurLevel || 'md']})`,
            backgroundColor: currentBoard.backgroundOverlayColor || (isDark ? 'rgba(24, 24, 27, 0.6)' : 'rgba(255, 255, 255, 0.6)')
          }}
        />
      )}

      {/* Grid pattern layer - on top of everything */}
      <div 
        className="absolute inset-0"
        style={{
          backgroundSize: `${40 * zoom}px ${40 * zoom}px`,
          backgroundImage: isGridVisible
            ? gridType === 'dots'
              ? `radial-gradient(circle, ${gridColor} 2px, transparent 2px)`
              : `linear-gradient(to right, ${gridColor} 1px, transparent 1px), linear-gradient(to bottom, ${gridColor} 1px, transparent 1px)`
            : 'none',
          opacity: 1,
          transform: 'translateZ(0)',
          willChange: 'background-image',
          pointerEvents: 'none',
        }}
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const x = e.clientX - rect.left;
          const y = e.clientY - rect.top;
          const cellSize = 40 * zoom;
          const cellIndex = Math.floor(x / cellSize) + Math.floor(y / cellSize) * Math.ceil(window.innerWidth / cellSize);
          onCellClick(cellIndex);
        }}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const x = e.clientX - rect.left;
          const y = e.clientY - rect.top;
          const cellSize = 40 * zoom;
          const cellIndex = Math.floor(x / cellSize) + Math.floor(y / cellSize) * Math.ceil(window.innerWidth / cellSize);
          onCellHover(cellIndex);
        }}
      />
    </div>
  )
}
