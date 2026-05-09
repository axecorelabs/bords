import type { Json, Database } from '@/types/supabase'

export type BoardPermission = 'owner' | 'view' | 'edit'

type SupabaseBoardDocumentRow = Database['public']['Tables']['board_documents']['Row']

export type BoardDocumentRow = SupabaseBoardDocumentRow & {
  rich_texts?: Json
}

export type BoardJsonObject = Record<string, unknown>

export type BoardItem = BoardJsonObject & {
  id?: string
}

export type BoardItemIds = {
  notes?: string[]
  checklists?: string[]
  texts?: string[]
  connections?: string[]
  drawings?: string[]
  kanbans?: string[]
  medias?: string[]
  reminders?: string[]
  tables?: string[]
  richTexts?: string[]
}

export type ZIndexSnapshot = {
  counter?: number
  entries?: Array<{
    itemId?: string
    zIndex?: number
  }>
}

export type BoardContent = {
  checklists?: unknown[]
  kanbanBoards?: unknown[]
  stickyNotes?: unknown[]
  mediaItems?: unknown[]
  textElements?: unknown[]
  drawings?: unknown[]
  connections?: unknown[]
  reminders?: unknown[]
  tables?: unknown[]
  richTexts?: unknown[]
  nativeTldraw?: unknown
  itemIds?: BoardItemIds | BoardJsonObject
  connectionLineSettings?: BoardJsonObject
  gridSettings?: BoardJsonObject
  themeSettings?: BoardJsonObject
  zIndexData?: ZIndexSnapshot | BoardJsonObject
  backgroundImage?: string | null
  backgroundColor?: string | null
  backgroundOverlay?: boolean | null
  backgroundOverlayColor?: string | null
  backgroundBlurLevel?: string | number | null
}

export type BoardDocumentClient = BoardContent & {
  _id: string
  owner: string
  localBoardId: string
  name: string
  workspaceId: string | null
  organizationId: string | null
  contextType: string
  visibility: string
  shareToken: string | null
  sharedWith: unknown
  publicUrl: string | null
  comments: unknown
  contentHash: string | null
  lastSyncedAt: string | null
  version: number
  createdAt: string
  updatedAt: string
}

export type BoardDocumentContentRow = {
  checklists: unknown[]
  kanban_boards: unknown[]
  sticky_notes: unknown[]
  media_items: unknown[]
  text_elements: unknown[]
  drawings: unknown[]
  connections: unknown[]
  reminders: unknown[]
  tables: unknown[]
  rich_texts: unknown[]
  native_tldraw: unknown
  connection_line_settings: BoardJsonObject
  grid_settings: BoardJsonObject
  theme_settings: BoardJsonObject
  z_index_data: ZIndexSnapshot | BoardJsonObject
  item_ids: BoardItemIds | BoardJsonObject
  background_image: string | null
  background_color: string | null
  background_overlay: boolean
  background_overlay_color: string | null
  background_blur_level: string | number | null
}
