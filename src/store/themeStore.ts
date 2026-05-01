import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { useGridStore } from './gridStore'

export const THEME_COLORS = {
  slate: { bg: 'bg-slate-100', border: 'border-slate-200/50', hover: 'hover:bg-slate-200/30', dark: 'bg-slate-900' },
  zinc: { bg: 'bg-zinc-100', border: 'border-zinc-200/50', hover: 'hover:bg-zinc-200/30', dark: 'bg-zinc-900' },
  neutral: { bg: 'bg-neutral-100', border: 'border-neutral-200/50', hover: 'hover:bg-neutral-200/30', dark: 'bg-neutral-900' },
  stone: { bg: 'bg-stone-100', border: 'border-stone-200/50', hover: 'hover:bg-stone-200/30', dark: 'bg-stone-900' },
  red: { bg: 'bg-red-50', border: 'border-red-100/50', hover: 'hover:bg-red-100/30', dark: 'bg-red-950' },
  orange: { bg: 'bg-orange-50', border: 'border-orange-100/50', hover: 'hover:bg-orange-100/30', dark: 'bg-orange-950' },
  amber: { bg: 'bg-amber-50', border: 'border-amber-100/50', hover: 'hover:bg-amber-100/30', dark: 'bg-amber-950' },
  yellow: { bg: 'bg-yellow-50', border: 'border-yellow-100/50', hover: 'hover:bg-yellow-100/30', dark: 'bg-yellow-950' },
  lime: { bg: 'bg-lime-50', border: 'border-lime-100/50', hover: 'hover:bg-lime-100/30', dark: 'bg-lime-950' },
  green: { bg: 'bg-green-50', border: 'border-green-100/50', hover: 'hover:bg-green-100/30', dark: 'bg-green-950' },
  emerald: { bg: 'bg-emerald-50', border: 'border-emerald-100/50', hover: 'hover:bg-emerald-100/30', dark: 'bg-emerald-950' },
  teal: { bg: 'bg-teal-50', border: 'border-teal-100/50', hover: 'hover:bg-teal-100/30', dark: 'bg-teal-950' },
  cyan: { bg: 'bg-cyan-50', border: 'border-cyan-100/50', hover: 'hover:bg-cyan-100/30', dark: 'bg-cyan-950' },
  sky: { bg: 'bg-sky-50', border: 'border-sky-100/50', hover: 'hover:bg-sky-100/30', dark: 'bg-sky-950' },
  blue: { bg: 'bg-blue-50', border: 'border-blue-100/50', hover: 'hover:bg-blue-100/30', dark: 'bg-blue-950' },
  indigo: { bg: 'bg-indigo-50', border: 'border-indigo-100/50', hover: 'hover:bg-indigo-100/30', dark: 'bg-indigo-950' },
  violet: { bg: 'bg-violet-50', border: 'border-violet-100/50', hover: 'hover:bg-violet-100/30', dark: 'bg-violet-950' },
  purple: { bg: 'bg-purple-50', border: 'border-purple-100/50', hover: 'hover:bg-purple-100/30', dark: 'bg-purple-950' },
  fuchsia: { bg: 'bg-fuchsia-50', border: 'border-fuchsia-100/50', hover: 'hover:bg-fuchsia-100/30', dark: 'bg-fuchsia-950' },
  rose: { bg: 'bg-rose-50', border: 'border-rose-100/50', hover: 'hover:bg-rose-100/30', dark: 'bg-rose-950' },
  gridColors: {
    light: {
      gray: { value: '#e4e4e7', label: 'Gray' },
      blue: { value: '#dbeafe', label: 'Blue' },
      green: { value: '#dcfce7', label: 'Green' },
      purple: { value: '#f3e8ff', label: 'Purple' },
      pink: { value: '#fce7f3', label: 'Pink' },
      orange: { value: '#ffedd5', label: 'Orange' },
    },
    dark: {
      gray: { value: '#27272a80', label: 'Gray' },    // More subtle dark colors
      blue: { value: '#1e3a8a80', label: 'Blue' },    // with 50% opacity
      green: { value: '#064e3b80', label: 'Green' },
      purple: { value: '#4c1d9580', label: 'Purple' },
      pink: { value: '#83184380', label: 'Pink' },
      orange: { value: '#7c2d1280', label: 'Orange' },
    }
  }
} as const

interface ThemeStore {
  isDark: boolean
  colorTheme: keyof typeof THEME_COLORS
  chatWallpaperIntensity: number
  toggleDark: () => void
  setColorTheme: (theme: keyof typeof THEME_COLORS) => void
  setChatWallpaperIntensity: (value: number) => void
}

export const useThemeStore = create<ThemeStore>()(
  persist(
    (set, get) => ({
      isDark: true,
      colorTheme: 'zinc',
      chatWallpaperIntensity: 68,
      toggleDark: () => {
        const gridStore = useGridStore.getState()
        set((state) => {
          const newIsDark = !state.isDark
          // Switch grid color when toggling dark mode
          if (newIsDark) {
            gridStore.setGridColor(THEME_COLORS.gridColors.dark.gray.value)
            document.documentElement.classList.add('dark')
          } else {
            gridStore.setGridColor(THEME_COLORS.gridColors.light.gray.value)
            document.documentElement.classList.remove('dark')
          }
          return { isDark: newIsDark }
        })
      },
      setColorTheme: (theme) => set({ colorTheme: theme }),
      setChatWallpaperIntensity: (value) =>
        set({ chatWallpaperIntensity: Math.max(20, Math.min(90, Math.round(value))) })
    }),
    {
      name: 'theme-storage'
    }
  )
)
