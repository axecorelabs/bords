import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface GridStore {
  isGridVisible: boolean
  gridColor: string
  gridType: 'lines' | 'dots'
  zoom: number
  scrollY: number
  gridSize: number
  snapEnabled: boolean
  setZoom: (zoom: number) => void
  setScrollY: (scrollY: number) => void
  toggleGrid: () => void
  setGridColor: (color: string) => void
  setGridType: (type: 'lines' | 'dots') => void
  cycleGridType: () => void
  toggleSnap: () => void
  setGridSize: (size: number) => void
  snapValue: (val: number) => number
}

export const useGridStore = create<GridStore>()(
  persist(
    (set, get) => ({
      isGridVisible: true,
      gridColor: '#333333', // Default dark mode grid color
      gridType: 'lines' as const,
      zoom: 1,
      scrollY: 0,
      gridSize: 20,
      snapEnabled: false,
      setZoom: (zoom) => set({ zoom }),
      setScrollY: (scrollY) => set({ scrollY }),
      toggleGrid: () => set((state) => ({ isGridVisible: !state.isGridVisible })),
      setGridColor: (color) => set({ gridColor: color }),
      setGridType: (type) => set({ gridType: type }),
      cycleGridType: () => set((state) => ({ gridType: state.gridType === 'lines' ? 'dots' : 'lines' })),
      toggleSnap: () => set((state) => ({ snapEnabled: !state.snapEnabled })),
      setGridSize: (size) => set({ gridSize: size }),
      snapValue: (val: number) => {
        const { snapEnabled, gridSize } = get()
        return snapEnabled ? Math.round(val / gridSize) * gridSize : val
      },
    }),
    {
      name: 'grid-storage'
    }
  )
)
