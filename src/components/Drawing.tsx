'use client'

import { useEffect, useRef } from 'react'
import { Drawing as DrawingType } from '@/types/drawing'

interface DrawingProps extends DrawingType {}

export function Drawing({ id, paths, position }: DrawingProps) {
  const canvasRef = useRef<SVGSVGElement>(null)

  return (
    <svg
      ref={canvasRef}
      className="absolute inset-0 pointer-events-none"
      style={{
        width: '100%',
        height: '100%',
        position: 'fixed',
        top: 0,
        left: 0,
        zIndex: 5,
      }}
    >
      {(paths || []).map((path) => {
        if ((path.points || []).length < 2) return null
        
        // Create SVG path from points
        const pathData = (path.points || [])
          .map((point, index) => {
            if (index === 0) return `M ${point.x} ${point.y}`
            return `L ${point.x} ${point.y}`
          })
          .join(' ')

        return (
          <path
            key={path.id}
            d={pathData}
            stroke={path.color}
            strokeWidth={path.strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        )
      })}
    </svg>
  )
}
