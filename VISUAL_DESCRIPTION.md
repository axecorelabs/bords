# BORDS — Complete Visual Description

> This document describes the visual appearance of every screen, component, and UI element in BORDS in precise detail. It is intended for AI-assisted design tools and landing page mockup generators. All colors, sizes, spacing, borders, typography, and layout data are pulled directly from the production codebase.

---

## Table of Contents

1. [Global Design System](#1-global-design-system)
2. [Authentication Pages](#2-authentication-pages)
3. [Pricing Page](#3-pricing-page)
4. [Main Canvas Workspace](#4-main-canvas-workspace)
5. [Top Bar](#5-top-bar)
6. [Bottom Dock](#6-bottom-dock)
7. [Right Sidebar](#7-right-sidebar)
8. [Grid Background](#8-grid-background)
9. [Sticky Notes](#9-sticky-notes)
10. [Kanban Boards](#10-kanban-boards)
11. [Checklists](#11-checklists)
12. [Text Elements](#12-text-elements)
13. [Media Elements](#13-media-elements)
14. [Connection Lines](#14-connection-lines)
15. [Drawing Tools](#15-drawing-tools)
16. [Comments Panel](#16-comments-panel)
17. [Boards Panel](#17-boards-panel)
18. [Organize Panel](#18-organize-panel)
19. [Workspace Switcher](#19-workspace-switcher)
20. [Share Modal](#20-share-modal)
21. [Active Collaborators](#21-active-collaborators)
22. [Server Status Indicator](#22-server-status-indicator)
23. [Export Modal](#23-export-modal)
24. [Background Modal](#24-background-modal)
25. [Sticky Note Edit Modal](#25-sticky-note-edit-modal)
26. [Task Modal](#26-task-modal)
27. [Media Modal](#27-media-modal)
28. [Connection Lines Modal](#28-connection-lines-modal)
29. [Custom Dropdown](#29-custom-dropdown)
30. [Presentation Mode](#30-presentation-mode)
31. [Personal Dashboard](#31-personal-dashboard)
32. [Organization Dashboard](#32-organization-dashboard)
33. [Dashboard Switcher](#33-dashboard-switcher)

---

## 1. Global Design System

### Color Palette

| Token | Dark Mode | Light Mode |
|-------|-----------|------------|
| Primary background | `#18181b` (zinc-900) | `#ffffff` (white) |
| Secondary background | `#27272a` (zinc-800) | `#fafafa` (zinc-50) |
| Surface / card | `#27272a` at 50% opacity | `#ffffff` |
| Border | `#3f3f46` at 50% opacity (zinc-700/50) | `#e4e4e7` at 50% opacity (zinc-200/50) |
| Text primary | `#ffffff` | `#18181b` (zinc-900) |
| Text secondary | `#a1a1aa` (zinc-400) | `#71717a` (zinc-500) |
| Text muted | `#71717a` (zinc-500) | `#a1a1aa` (zinc-400) |
| Accent / interactive | `#3b82f6` (blue-500) | `#3b82f6` (blue-500) |
| Accent hover | `#2563eb` (blue-600) | `#2563eb` (blue-600) |
| Accent faint | `#3b82f6` at 15% opacity | `#eff6ff` (blue-50) |
| Success | `#10b981` (emerald-500) | `#10b981` |
| Warning | `#f59e0b` (amber-500) | `#f59e0b` |
| Danger | `#ef4444` (red-500) | `#ef4444` |

### Typography

- **Brand font**: Custom `brand-font` (used in headings, logo text). Tight tracking (`tracking-tighter` / `tracking-tight`).
- **Body font**: System sans-serif stack.
- **Sizes**: `text-[10px]` (labels/badges), `text-[11px]` (timestamps), `text-xs` (12px, metadata), `text-sm` (14px, body), `text-base` (16px), `text-lg` (18px, section titles), `text-xl` (20px), `text-2xl` (24px, page headings), `text-3xl` (30px), `text-5xl` (48px, hero).
- **Weights**: `font-light` (300, subtitles), `font-medium` (500, item labels), `font-semibold` (600, section headers), `font-bold` (700, values/headings).

### Border Radius

| Context | Radius |
|---------|--------|
| Small elements (badges, inputs) | `rounded-lg` (8px) |
| Cards, modals, panels | `rounded-xl` (12px) or `rounded-2xl` (16px) |
| Canvas items (sticky notes, checklists, kanban) | `rounded-3xl` (24px) |
| Circles (avatars, dots) | `rounded-full` |
| Buttons | `rounded-xl` (12px) |

### Shadows

- **Cards**: `shadow-lg` or `shadow-2xl`.
- **Canvas items**: `box-shadow: 0 10px 40px rgba(0,0,0,0.15)`.
- **Modals**: `shadow-2xl`.
- **Floating UI**: `shadow-xl`.

### Backdrop Blur

All floating panels, toolbars, and modals use `backdrop-blur-xl` with semi-transparent backgrounds (`bg-zinc-800/90` in dark, `bg-white/90` in light). This creates a frosted-glass effect where underlying canvas content shows through faintly.

### Animations

- **Entry/exit**: Framer Motion spring animations (`damping: 25-30, stiffness: 200-300`).
- **Page transitions**: `opacity: 0 → 1`, `y: 20 → 0` over 0.5s.
- **Hover**: `scale: 1.02-1.1`, color transitions (`transition-colors`).
- **Tap/press**: `scale: 0.98` (subtle press feedback).
- **Loading spinners**: `animate-spin` on circular border elements.
- **Pulse**: `animate-pulse` on status dots and connection indicators.

---

## 2. Authentication Pages

All auth pages (Login, Signup, Forgot Password, Reset Password) share the same base layout.

### Base Layout

- **Full viewport**: Fixed `inset-0`, `bg-black`.
- **Background image**: `/bord2.png` covering the entire screen at `opacity: 10%`, centered, `bg-cover`.
- **Blur overlay**: On top of the image — `backdrop-blur-[2px]` with `bg-black/50`.
- **Content alignment**: Centered vertically and horizontally (`flex items-center justify-center min-h-screen`).

### Login Page Card

- **Card**: `bg-white/20 backdrop-blur-xl rounded-2xl shadow-2xl p-8`, max-width `md` (448px).
- **Logo**: Centered at top — `w-16 h-16 bg-black rounded-xl` containing the BORDS logo image (bordclear.png, white on black).
- **Title**: `text-3xl font-semibold text-white brand-font tracking-tight` centered below logo. Text: "Sign in to BORDS".
- **Subtitle**: `text-zinc-300 font-light` centered. Text: "Your workspace awaits".
- **Google button**: Full-width, `py-3.5 bg-white hover:bg-zinc-50 text-zinc-700 rounded-xl font-medium border border-zinc-200`. Shows Google "G" icon on left.
- **Divider**: Centered text "or sign in with email" in `text-zinc-400 font-light`. No horizontal line.
- **Form fields**: `space-y-5`. Each has:
  - Label: `text-sm font-medium text-white mb-2`.
  - Input: `w-full pl-12 pr-4 py-3 bg-white border border-zinc-300 rounded-xl`. Left icon (Mail/Lock) at `text-zinc-400`. Focus ring: `ring-2 ring-[#bfdbfe]`. Placeholder: `text-zinc-400 font-light`.
  - Error state: `border-red-500`.
- **Forgot password link**: Right-aligned under password, `text-sm text-zinc-300 hover:text-white`.
- **Submit button**: `w-full py-4 bg-black text-white rounded-xl font-medium hover:bg-zinc-900`. Framer Motion hover `scale: 1.02`, tap `scale: 0.98`. Loading shows white spinner.
- **Footer link**: "Don't have an account? Sign up" in `text-zinc-300`, link in `text-white font-medium underline`.

### Signup Page

- Same card layout as login.
- Extra fields: First Name + Last Name in a `grid grid-cols-2 gap-4`, Confirm Password below Password.
- Terms checkbox: `w-4 h-4 mt-1 text-black border-zinc-300 rounded`.
- Verification notice (if sent): `p-4 bg-black/40 border border-white/20 rounded-xl` with mail icon and success text.

### Forgot Password Page

- Same card layout.
- Header icon: `w-16 h-16 bg-black rounded-xl` with Mail icon (`w-8 h-8 text-white`).
- Title: "Reset your password".
- Single email field.
- Submit button text: "Send reset link".
- Back link: ArrowLeft icon + "Back to login" in `text-zinc-300 hover:text-white`.

---

## 3. Pricing Page

### Layout

- **Background**: Full screen `bg-black text-white`.
- **Container**: `max-w-7xl mx-auto px-6 py-20 lg:py-32`.
- **Header**: Centered `text-center mb-16`.
  - Title: `text-5xl lg:text-7xl font-semibold brand-font tracking-tighter`. Text: "Simple, transparent pricing".
  - Subtitle: `text-xl text-zinc-400 font-light max-w-2xl mx-auto`.

### Billing Toggle

- **Container**: `bg-zinc-900 rounded-xl p-1 inline-flex border border-zinc-800`.
- **Active tab**: `bg-white text-black` rounded pill.
- **Inactive tab**: `text-zinc-400 hover:text-white`.
- "Save 20%" badge on annual: `absolute -top-2 -right-2 bg-blue-200 text-black text-xs px-2 py-0.5 rounded-full font-semibold`.

### Plan Cards

- **Grid**: `grid md:grid-cols-2 lg:grid-cols-3 gap-8 max-w-6xl mx-auto`.
- **Standard card**: `bg-zinc-900 border border-zinc-800 rounded-2xl p-8 relative`.
- **"Most Popular" card**: `border-blue-200 shadow-lg shadow-blue-200/10` (light blue glow). Badge at top: `bg-blue-200 text-black text-xs px-3 py-1 rounded-full font-semibold`.
- **Card header**: Plan title `text-2xl font-semibold brand-font`, description `text-zinc-400 text-sm font-light`.
- **Price**: `text-5xl font-semibold brand-font` followed by `/month` in `text-zinc-400 text-lg`.
- **Currency**: NGN (₦). Prices: Free ₦0, Pro ₦5,000, Team ₦15,000 per month.
- **Feature list**: `space-y-3`, each item has blue check icon `text-blue-200` + feature text `text-zinc-300 font-light text-sm`.
- **CTA button**:
  - Popular plan: `bg-white text-black hover:bg-zinc-100 w-full py-4 rounded-xl font-medium`.
  - Standard: `border border-zinc-700 text-white hover:bg-zinc-800`.
  - Free (current): `bg-zinc-800 text-zinc-500 cursor-not-allowed`.

### FAQ Section

- Below pricing cards.
- Title: `text-3xl font-semibold brand-font`.
- FAQ items: `border border-zinc-800 rounded-2xl p-6` with question/answer pairs.

---

## 4. Main Canvas Workspace

The main workspace is a full-viewport infinite canvas where all visual elements are placed. It occupies the entire screen with the TopBar floating at top-left, the Dock at the bottom center, and the SideBar on the right edge.

### Canvas Container

- `fixed inset-0` covering the full viewport.
- Background: `bg-zinc-900` (dark) or `bg-zinc-100` (light), optionally replaced by a custom background image.
- Contains a zoomable, pannable area where all board items (sticky notes, checklists, kanban, text, media, drawings, connections) are absolutely positioned.
- Zoom range: Controlled by scroll wheel. Grid pattern scales with zoom level.
- Drag-and-drop: Items can be freely placed anywhere on the canvas via pointer drag.

### Layering (z-index hierarchy):

1. Grid background (z-0)
2. Connection lines SVG (z-0)
3. Canvas items — sticky notes, kanban, checklists, media, text (z-1+ dynamic, item that was last clicked gets the highest z-index)
4. Drawing canvas (z-50 when active)
5. Sidebar (z-40)
6. TopBar (z-50)
7. Bottom Dock (z-50)
8. Comments panel (z-200)
9. Modals (z-9999)

---

## 5. Top Bar

### Container

- **Position**: `fixed top-4 left-4 z-50`.
- **Shape**: `rounded-xl`.
- **Background**: `bg-zinc-800/90 backdrop-blur-xl` (dark) / `bg-white/90 backdrop-blur-xl` (light).
- **Border**: `border-zinc-700/50` (dark) / `border-zinc-200/50` (light).
- **Shadow**: `shadow-lg`.
- **Layout**: Horizontal `flex items-center gap-3 px-3 py-2`.

### Left Section (inside bar)

1. **BORDS Logo**: `w-8 h-8 bg-black rounded-lg` containing the white logo image (bordclear.png). Next to it, "BORDS" text in `text-lg font-bold tracking-tighter`.
2. **Vertical separator**: `w-px h-5 bg-zinc-600/50` (dark) / `bg-zinc-300` (light).
3. **User avatar + name**: Circular `w-8 h-8 rounded-full` avatar image (or gradient placeholder with initials). Name in `text-sm font-medium`, email in `text-xs text-zinc-400`. Chevron right icon for dropdown.
4. **User dropdown** (on click): `w-64 rounded-xl border shadow-xl` with menu items: Subscription, Logout. Each item is `px-3 py-2 text-sm rounded-lg` with hover background.
5. **Vertical separator**.
6. **Workspace Switcher**: See [Section 19](#19-workspace-switcher).

### Right Section (separate floating element)

- Positioned `fixed top-4 right-4`.
- Same bar styling: `rounded-xl backdrop-blur-xl` with same background/border.
- Contains (left to right): Server Status Indicator, Publish Button (org context only), Activity Sidebar toggle, Dashboard button (LayoutDashboard icon with inbox badge), Team/Friends button (Users icon).

### Board Name Pill (separate floating element)

- **Position**: `fixed top-4` centered between left and right bars.
- **Shape**: `rounded-xl backdrop-blur-xl` with same glass styling.
- **Content**: Board name in `text-sm font-semibold`, truncated.
- **Role tag**: If viewer → `text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400` labeled "VIEWER". If editor → `bg-blue-500/20 text-blue-400` labeled "EDITOR".
- **Share button**: Inside the pill, opens the share modal.
- **Active Collaborators**: Avatar stack showing connected users (see [Section 21](#21-active-collaborators)).

---

## 6. Bottom Dock

### Container

- **Position**: `fixed bottom-4 left-1/2 -translate-x-1/2 z-50` (centered at bottom).
- **Shape**: `rounded-2xl`.
- **Background**: `bg-zinc-800/90 backdrop-blur-xl` (dark) / `bg-white/90 backdrop-blur-xl` (light).
- **Border**: `border-zinc-700/50` (dark) / `border-zinc-200/50` (light).
- **Shadow**: `shadow-lg`.
- **Layout**: Horizontal `flex items-center gap-1 px-3 py-2`.

### Dock Items

Each item is a button with:
- **Size**: `w-5 h-5` icon.
- **Default**: `text-zinc-400` (dark) / `text-zinc-500` (light).
- **Hover**: `text-white` (dark) / `text-zinc-900` (light), `scale-125 -translate-y-2` (magnification effect, item lifts up and grows on hover).
- **Active tool**: `text-blue-400` (highlighted).
- **Tooltip**: Appears above the item on hover — `bg-zinc-800 text-white text-xs px-2 py-1 rounded-lg shadow-lg` with a small downward-pointing triangle.

### Dock Sections (left to right, separated by `w-px h-6 bg-zinc-600/30` dividers)

1. **Navigation**: Drag mode, Grid toggle, Snap-to-grid toggle.
2. **Content Creation**: Sticky Note (square icon), Text (Type icon), Checklist (CheckSquare), Kanban Board (LayoutDashboard), Reminder (Bell), Media (Image), Table (Table).
3. **Drawing Tools**: Select (MousePointer), Hand (Hand), Draw/Pencil (Pencil), Eraser (Eraser), Arrow (ArrowUpRight), Highlight (Highlighter), Shapes ▾ (dropdown with Rectangle, Circle, Triangle, Diamond, Star, Hexagon, Pentagon, Octagon — each shown in a popup grid).
4. **Collaboration**: Comments (MessageCircle with unread count badge), Organize (Layers).
5. **Zoom**: Zoom Out (−), Zoom percentage (click to reset to 100%), Zoom In (+).

### Shapes Popup

- Triggered by clicking the Shapes dock item.
- **Position**: Opens above the dock.
- **Container**: `rounded-xl border shadow-xl p-2 backdrop-blur-xl` with same glass styling.
- **Grid**: `grid grid-cols-4 gap-1`.
- **Items**: `p-2 rounded-lg hover:bg-zinc-700` (dark), each contains an SVG shape preview icon.

---

## 7. Right Sidebar

### Container

- **Position**: `fixed right-4 top-1/2 -translate-y-1/2 z-40`.
- **Shape**: `rounded-2xl` vertical strip, `w-16`.
- **Background**: Same frosted glass as TopBar/Dock.
- **Layout**: `flex flex-col items-center gap-4 py-4`.

### Tool Items

Each button: `w-6 h-6` icon centered. Hover: `scale-110` with tooltip appearing to the left.

**Tools listed (top to bottom):**
1. Custom Backgrounds (Paintbrush icon) — opens Background Modal.
2. Export Options (Download icon) — opens Export Modal.
3. Grid Colors (Grid3X3 icon) — opens inline color picker sub-panel.
4. Presentation Mode (Presentation icon) — toggles presentation mode.
5. Connection Lines (GitBranch icon) — opens Connection Line Modal.
6. Collaborate (Users icon) — collaboration features.
7. Automations (Zap icon) — disabled, shows "Coming Soon" badge.

### Tooltip

- **Position**: `fixed` to the left of the sidebar, `right: 88px`.
- **Container**: `bg-zinc-800 text-white px-3 py-2 rounded-lg text-xs`.
- **Content**: Bold label + description in `text-zinc-400`.
- **Arrow**: Right-pointing triangle (`border-l-zinc-800`).
- **Experimental badge**: `text-[10px] px-1.5 py-0.5 bg-amber-500/20 text-amber-300 rounded`.

### Grid Color Picker Sub-Panel

- Opens to the left of the sidebar.
- `fixed right-24 top-1/2 -translate-y-1/2 p-3 rounded-xl border shadow-xl z-50 w-[260px]`.
- **Custom color input**: Color swatch (`w-10 h-10 rounded-lg`) + hex text input side by side.
- **Preset grid**: `grid grid-cols-6 gap-2` of `w-8 h-8 rounded-lg` color swatches. Hover: `scale-110`. Active swatch gets `ring-2 ring-blue-500`.

---

## 8. Grid Background

### Pattern

- **Position**: `fixed inset-0 pointer-events-none` (behind all canvas items).
- **Grid size**: 40px cells, scaled by current zoom level.
- **Lines**: Drawn with CSS `linear-gradient` — 1px lines in the grid color.
- **Default grid color**: `#4a4a4a` (dark) / `#d4d4d4` (light). Customizable via color picker.
- **Background**: `bg-zinc-900` (dark) / `bg-zinc-100` (light) as base.

### Custom Background

- When a background image is set, it replaces the solid color.
- A configurable blur overlay sits on top: `backdrop-blur-sm/md/lg/xl` levels.
- Grid lines still render over the background image.

---

## 9. Sticky Notes

### Container

- **Shape**: `rounded-2xl` (16px corners).
- **Background**: Dynamic color class — the user picks from a set of pastel/vivid colors (yellow, pink, blue, green, purple, etc.). Each color is a Tailwind class applied to the outer div.
- **Border**: `border-black/10`. Selected: `border-blue-400/50 ring-2 ring-blue-400/30`.
- **Backdrop**: `backdrop-blur-sm`.
- **Shadow**: `box-shadow: 0 10px 40px rgba(0,0,0,0.15)`.
- **Default size**: `200 × 200` (resizable by dragging the bottom-right corner).
- **Draggable**: Entire note can be dragged by the grip handle.
- **Absolutely positioned**: Coordinates come from the store, placed on the infinite canvas.

### Header

- **Badge**: `bg-gradient-to-r from-zinc-700 to-zinc-600 text-white text-[10px] rounded-full px-2 py-0.5 font-medium`. Text: "Sticky Note".
- **Drag handle**: `GripVertical` icon in `text-gray-400`, left side of header.

### Body

- **Content text**: `font-medium text-gray-800 whitespace-pre-wrap`.
- **Overflow**: Hidden/clipped to container bounds.

### Action Buttons (on hover/select)

- Appear at the top of the note.
- **Color picker**: `p-2.5 hover:bg-purple-50 rounded-xl`, Palette icon.
- **Delete**: `p-2.5 hover:bg-red-50 rounded-xl`, Trash icon with red hover color.

### Connection Nodes

- Small `w-3 h-3 rounded-full` dots on the left and right edges (vertically centered).
- **Default**: `bg-white border-2 border-gray-300`.
- **Active/connected**: `bg-blue-500 border-blue-600`.
- **Hover**: `scale-125`.
- Appear on hover with framer-motion fade-in.

---

## 10. Kanban Boards

### Container

- **Shape**: `rounded-3xl` (24px).
- **Background**: Dynamic color prop (same color system as sticky notes).
- **Border**: `1px solid rgba(255,255,255,0.2)`.
- **Shadow**: `box-shadow: 0 10px 40px rgba(0,0,0,0.15)`.
- **Backdrop**: `backdrop-blur-sm`.
- **Default size**: `800 × 350` (resizable, min 600×450).
- **Draggable**: By the grip handle in the header.

### Header

- **Layout**: `flex items-center justify-between px-4 py-3 border-b border-zinc-200/50`.
- **Left**: Grip handle + Board title (`font-semibold text-lg text-gray-800`, editable on double-click).
- **Right**: Color picker button + Delete button (both `p-2 rounded-xl` with hover states).

### Columns

- **Container**: `flex-1 flex gap-3 p-4` horizontal scroll.
- **Column**: Fixed `240px` width, `bg-zinc-50/80 rounded-2xl flex flex-col`.
- **Column header**: `px-3 py-2 border-b border-zinc-200/50`. Title (`font-semibold text-sm` truncated) + count badge (`text-xs px-2 py-0.5 rounded-full bg-white/80 text-gray-700`).
- **Add task button**: At bottom of column, `text-xs text-zinc-400 hover:text-zinc-600`.
- **Drop target state**: `bg-blue-50/80 ring-2 ring-blue-300/50`.

### Task Cards (inside columns)

- **Container**: `p-3 rounded-xl border border-zinc-200/60 bg-white cursor-grab`.
- **Hover**: `hover:border-zinc-300 hover:shadow-md`.
- **Dragging**: `opacity-30 scale-95`.
- **Title**: `font-medium text-sm`. Completed: `line-through opacity-60`.
- **Description**: `text-xs mt-1.5 line-clamp-2 text-gray-600`.
- **Footer**: Priority dot (`w-2 h-2 rounded-full`) + due date.
  - Priority colors: Low = `bg-blue-500`, Medium = `bg-yellow-500`, High = `bg-red-500`.
  - Overdue date: `text-red-500`.
- **Action buttons** (on hover): Edit pencil + Delete trash, `opacity-0 group-hover:opacity-100`.

### Drag Ghost

- `fixed pointer-events-none z-[99999]` following the cursor.
- `p-3 rounded-xl border border-blue-300 bg-white shadow-2xl opacity-90`.
- Shows task title text, `max-w-[220px] truncate`.

---

## 11. Checklists

### Container

- **Shape**: `rounded-3xl` (24px × zoom).
- **Background**: Dynamic color prop + `backdrop-blur-md`.
- **Border**: `border-black/10`. Selected: `border-blue-400/50 ring-2 ring-blue-400/30`.
- **Shadow**: `box-shadow: 0 10px 40px rgba(0,0,0,0.15)`.
- **Default min size**: `280 × 200` (resizable).
- **Layout**: `flex flex-col` with header + scrollable items area.

### Header

- **Layout**: `flex justify-between items-start mb-5`.
- **Title**: `font-semibold text-gray-800` (size scales with zoom, ~1.25× base font).
- **Grip handle**: `GripVertical` icon, `text-gray-400`.
- **Action buttons**: Color picker (Palette) and Delete (Trash2), both `p-2.5 hover:bg-purple-50/red-50 rounded-xl`.

### Checklist Items

- **Container**: `space-y-2.5`, scrollable, `flex-1 min-h-0 overflow-auto`.
- **Each item**: `bg-white/60 backdrop-blur-sm rounded-xl border border-white/50 hover:shadow-md`.
- **Checkbox (unchecked)**: `bg-white/80 border border-black/10` square with `rounded-md`. Hover: `scale-110`.
- **Checkbox (checked)**: `bg-green-500 text-white shadow-sm` with check mark.
- **Item text**: `text-sm font-medium leading-snug text-gray-800`. Completed: `text-gray-400 line-through`.
- **Deadline badge**: `bg-blue-50/60 rounded-md px-1.5 py-0.5 text-[10px] text-gray-500` showing time remaining. Colors: green (plenty of time), orange (soon), red (overdue/past).
- **Overdue badge**: `bg-red-500 text-white px-2 py-0.5 rounded text-[10px] font-medium`.

### Assignee Completion Dots

- Tiny avatar circles overlapping: `-space-x-1.5`, `w-5 h-5 rounded-full border-2 border-white`.
- Completed: `bg-emerald-500`.
- Pending: `bg-zinc-200`.

### Hover Action Pill (desktop)

- Appears on hover over an item: `bg-white/95 backdrop-blur-md rounded-lg shadow-md border border-black/10 px-1 py-0.5`.
- Shows small icon buttons (edit, delete, assign, connection).

---

## 12. Text Elements

### Container

- **Positioned absolutely** on canvas with `transform` for drag offset.
- **Resizable** horizontally only (right handle).
- **Default width**: 200px.

### Display Mode

- Direct text rendering at `fontSize` (8–72px range).
- **Color**: Customizable. Dark mode: white. Light mode: user-selected color.
- **Selected state**: `ring-2 ring-blue-400/50 rounded-lg shadow-lg`.
- **Hovered state**: `ring-1 ring-blue-300/30 rounded-lg`.
- **Rotation**: Supports 15° increments.

### Editing Mode (double-click)

- Turns into a `<textarea>`.
- `p-3 backdrop-blur-sm rounded-lg border-2 border-blue-400/50 shadow-sm`.
- Dark: `bg-zinc-800/90 text-white`.
- Light: `bg-white/80 text-gray-900`.

### Toolbar (appears when selected)

- Shows above the text: rotate left, rotate right, zoom in/out font, color picker, delete.
- Buttons: `p-1.5 rounded-md hover:bg-zinc-700` (dark) / `hover:bg-zinc-200` (light).

### Resize Handle

- Vertical three-dot grip on the right edge.
- `opacity-0 group-hover:opacity-40` — fades in on hover.
- Three `w-[3px] h-[3px] rounded-full bg-gray-400` dots stacked vertically.

---

## 13. Media Elements

### Container

- **Shape**: `rounded-2xl border-2 overflow-hidden`.
- **Shadow**: `shadow-lg`.
- **Default border**: `border-zinc-700 hover:border-zinc-600` (dark) / `border-zinc-300 hover:border-zinc-400` (light).
- **Selected border**: `border-blue-500 shadow-blue-500/50`.
- **Resizable**: All corners and edges.

### Image Content

- Fills container with `object-cover`.
- Background: `bg-zinc-900` (dark) / `bg-zinc-100` (light) while loading.

### Video Content

- `aspect-video` container.
- **Play button** (before playing): `w-12 h-12 rounded-full bg-white/95 hover:bg-white shadow-[0_2px_12px_rgba(0,0,0,0.3)]` with filled triangle play icon.
- **Stop button** (while playing): `absolute top-2 left-2 p-1.5 rounded-lg bg-black/60 hover:bg-black/80 text-white`.

### Action Buttons (on hover)

- **Position**: `absolute top-2 right-2 flex gap-2`.
- Color button: `p-2 rounded-lg bg-purple-500 hover:bg-purple-600 text-white shadow-lg`.
- Delete button: `p-2 rounded-lg bg-red-500 hover:bg-red-600 text-white shadow-lg`.

---

## 14. Connection Lines

### SVG Rendering

- **Container**: `fixed inset-0` SVG overlay at `z-index: 0` (behind board items).
- **Path type**: Cubic Bézier curves — `M startX startY C midX startY, midX endY, endX endY`. Creates smooth flowing S-curves between connected items.
- **Stroke**: `strokeWidth="2"`, `strokeLinecap="round"`, `fill="none"`.
- **Color**: Customizable per connection — defaults to element colors or user-chosen.
- **Shadow**: `drop-shadow(0 0 4px rgba(0,0,0,0.1))`. Hover: `drop-shadow(0 0 6px rgba(0,0,0,0.2))`.

### Active Drag Line (while connecting)

- Dashed line from source to cursor: `stroke="#3b82f6"`, `strokeWidth="2"`, `strokeDasharray="5,5"`.
- Updates on every `mousemove` in real time.

### Connections Summary Panel (bottom-left)

- Small collapsible panel: `rounded-xl shadow-lg border backdrop-blur-xl`.
- Shows connection count with blue Link2 icon.
- Expandable to list all connections.

---

## 15. Drawing Tools

### Drawing Canvas

- **Layer**: `fixed inset-0 z-50` — sits above board items when active.
- **SVG paths**: `stroke-linecap="round" stroke-linejoin="round" fill="none"`. Smooth freehand curves.

### Controls (when drawing mode is active)

- **Position**: `fixed bottom-8 left-1/2 -translate-x-1/2`.
- **Container**: `bg-white/95 backdrop-blur-sm rounded-2xl shadow-2xl border border-zinc-200 p-4`.
- **Tool buttons**: `w-10 h-10 rounded-lg hover:bg-zinc-100`. Active: `bg-blue-100 text-blue-600`.
- **Color palette**: Horizontal strip of `w-6 h-6` color circles.
- **Stroke width**: Preset sizes (1px to 24px).
- **Eraser**: Custom crosshair cursor.

---

## 16. Comments Panel

### Container

- **Position**: `fixed top-0 right-0 h-full w-[480px] max-w-[90vw] z-[200]`.
- **Background**: `bg-zinc-900 border-l border-zinc-700/50` (dark) / `bg-white border-l border-zinc-200` (light).
- **Shadow**: `shadow-2xl`.
- **Layout**: `flex flex-col` (header → scrollable list → fixed input).

### Header

- `flex items-center justify-between px-5 py-4 border-b`.
- Blue MessageCircle icon in `p-1.5 rounded-lg bg-blue-500/15` container.
- Title: "Comments".
- Close X button.

### Comment Bubbles (chat-style)

- **List**: `flex-1 overflow-y-auto px-4 py-3 space-y-2`.
- **Avatar**: `w-7 h-7 rounded-full text-[10px] font-semibold text-white` with consistent hash-based color (blue, purple, pink, teal, etc.).
- **Own messages**: `bg-blue-500 text-white rounded-2xl rounded-br-md px-3 py-2`.
- **Others (dark)**: `bg-zinc-800 text-zinc-200 rounded-2xl rounded-bl-md px-3 py-2`.
- **Others (light)**: `bg-zinc-100 text-zinc-800 rounded-2xl rounded-bl-md px-3 py-2`.
- **Username**: `text-[11px] font-semibold mb-0.5`.
- **Message text**: `text-sm leading-relaxed break-words`.
- **Timestamp**: `text-[10px]` right-aligned.
- **Date separators**: `text-[11px] px-3 py-0.5 rounded-full` — dark: `bg-zinc-800 text-zinc-400`, light: `bg-zinc-200/70 text-zinc-500`.

### Input Area

- `flex-shrink-0 border-t px-4 py-3`.
- **Input**: `flex-1 text-sm border rounded-xl px-3.5 py-2 focus:ring-2 focus:ring-blue-500/30`.
- Dark: `bg-zinc-800 border-zinc-700 text-white placeholder:text-zinc-500`.
- Light: `bg-zinc-50 border-zinc-200 text-zinc-900 placeholder:text-zinc-400`.
- **Send button**: `p-2 bg-blue-500 text-white rounded-xl hover:bg-blue-600`.

---

## 17. Boards Panel

### Container

- **Position**: `fixed left-0 top-0 bottom-0 w-80 z-50`.
- **Background**: `bg-zinc-800/90 backdrop-blur-xl border-r border-zinc-700/50` (dark) / `bg-white/90 backdrop-blur-xl border-r border-zinc-200/50` (light).
- **Animation**: Slides in from left — Framer Motion `x: -300 → 0`, spring type with `damping: 30, stiffness: 300`.

### Header

- `p-4` with title "My Boards" or org name + "Boards".
- **Title**: `text-lg font-semibold`.
- Close button: X icon in `p-2 rounded-lg hover:bg-zinc-700`.

### Create Board

- **Input**: `flex-1 p-2 rounded-lg border focus:ring-2 focus:ring-blue-500 bg-white text-gray-900`.
- **Create button**: `px-3 py-2 bg-blue-500 text-white rounded-lg text-sm`.

### Board List

- Scrollable area, `space-y-1`.
- **Board item**: `w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm`.
- **Active board**: `bg-blue-500/15 text-blue-400` (dark) / `bg-blue-50 text-blue-600` (light).
- **Inactive**: `text-zinc-300 hover:bg-zinc-700/50` (dark) / `text-zinc-700 hover:bg-zinc-100` (light).
- **Board icon**: Layout icon, 16px.
- **Timestamp**: `text-[10px] text-zinc-500` — last modified date.
- **Action buttons** (on hover): Edit (pencil), Share, Delete — small icon buttons.

### Sections

- **My Boards**: User-owned boards in current context.
- **Shared With Me** (personal only): Other users' boards shared via link.
- **Accessible Boards** (org only): Boards from other org members with access granted.
- **Section dividers**: `border-t border-zinc-700/50` (dark) / `border-zinc-200` (light) with label.

---

## 18. Organize Panel

### Container

- **Position**: `fixed right-0 top-0 bottom-0 w-96 z-40`.
- **Background**: Same frosted glass as Boards Panel (but on right side).
- **Animation**: Slides in from right — `x: 400 → 0`.

### Header

- `p-4`, title "Organize" with `text-lg font-semibold`.
- Close button.

### Sections

- `space-y-6 pb-8`, each section lists items of one type.
- **Section heading**: `text-sm font-medium mb-2 flex items-center gap-2` with icon + count.
- **Sections**: Sticky Notes, Checklists, Kanban Boards, Text, Media, Drawings.

### Item Row

- `p-3 rounded-lg flex items-center justify-between`.
- Background: `bg-zinc-700/50` (dark) / `bg-gray-50` (light).
- **Label**: `text-sm truncate`.
- **Actions**: Eye icon (toggle visibility, `p-1.5 rounded-lg hover:bg-white/10`) + Delete icon (`text-red-500`).

---

## 19. Workspace Switcher

### Trigger Button

- `flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium`.
- Shows: UserIcon (personal) or Building2 (org) + label (truncated at 140px) + ChevronDown (rotates 180° when open).

### Dropdown

- `absolute left-0 top-full mt-1.5 z-[100] w-64 rounded-xl border shadow-xl overflow-hidden`.
- Dark: `bg-zinc-800 border-zinc-700/60`. Light: `bg-white border-zinc-200`.

### Items

1. **Personal**: UserIcon + "Personal" label + LayoutDashboard mini-button to go to dashboard + Check icon if active.
   - Active: `bg-blue-500/10 text-blue-400` (dark) / `bg-blue-50 text-blue-600` (light).
2. **Divider**: `border-t`.
3. **"Organizations" label**: `text-[10px] font-bold uppercase tracking-wider text-zinc-500`.
4. **Org items**: Building2 icon + org name (truncated) + Owner/Member badge (`text-[9px] px-1.5 py-0.5 rounded-full`) + LayoutDashboard mini-button + Check icon if active.
   - Owner badge: `bg-blue-500/15 text-blue-400`.
   - Member badge: `bg-zinc-700 text-zinc-400`.
5. **Divider**.
6. **"Create New Organization"**: Plus icon + label. Opens org creation flow.

---

## 20. Share Modal

### Backdrop

- `fixed inset-0 bg-black/50`.

### Modal

- `w-full max-w-md mx-4 rounded-2xl shadow-2xl border`.
- Dark: `bg-zinc-800 border-zinc-700`. Light: `bg-white border-gray-200`.

### Header

- `flex items-center justify-between p-4 border-b`.
- Title: "Share Board" `font-semibold`.

### Visibility Options

- 2-column grid. Each option: `p-4 rounded-xl border-2 transition-all`.
- **Private** (selected): `border-blue-500 bg-blue-50 text-blue-700` / `bg-blue-500/10 text-blue-400`.
- **Public**: Same styling when selected.
- Shows icon + label for each.

### Public Link (when public)

- Input showing share URL: `bg-zinc-700 text-zinc-300 rounded-lg px-3 py-2`.
- Copy button toggles between Copy and Check icon.

---

## 21. Active Collaborators

### Avatar Stack

- Displayed in the board name pill / TopBar.
- `flex items-center -space-x-2` (overlapping circles).
- **Each avatar**: `w-8 h-8 rounded-full ring-2 ring-offset-1`. Ring matches the bar background (`ring-zinc-800` dark / `ring-white` light).
- **Image**: Full cover rounded.
- **Online dot**: `absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-green-500 ring-2`.
- **Overflow badge**: `+X` in `w-8 h-8 rounded-full bg-zinc-700 text-zinc-300 text-xs font-semibold`.

### Connection Status Pill

- After avatar stack: `ml-3 px-2 py-0.5 rounded-full text-[10px] font-semibold`.
- **Live**: `bg-green-500/15 text-green-400`.
- **Reconnecting**: `bg-amber-500/15 text-amber-400` (pulsing amber dot).
- **Offline**: `bg-red-500/15 text-red-400`.

### Details Popover (on click)

- `absolute top-full right-0 mt-2 w-72 rounded-xl border shadow-xl`.
- **Header**: "X Collaborator(s) Online" in `text-xs font-semibold uppercase tracking-wider`.
- **User list**: `max-h-64 overflow-y-auto`.
- **Each user row**: `flex items-center gap-3 px-4 py-2.5`.
  - Avatar: `w-9 h-9 rounded-full` with online dot.
  - Name: `text-sm font-medium`. "(You)" suffix for self.
  - Permission badge: `text-[10px] font-semibold px-1.5 py-0.5 rounded-full`.
    - Owner: `bg-purple-500/20 text-purple-400`.
    - Editor: `bg-emerald-500/20 text-emerald-400`.
    - Viewer: `bg-amber-500/20 text-amber-400`.
  - Cursor color dot: Pulsing dot matching the user's assigned presence color.

### Presence Colors (16 total, hash-based per user)

`#e57373`, `#f06292`, `#ba68c8`, `#9575cd`, `#7986cb`, `#64b5f6`, `#4fc3f7`, `#4dd0e1`, `#4db6ac`, `#81c784`, `#aed581`, `#dce775`, `#fff176`, `#ffd54f`, `#ffb74d`, `#ff8a65`.

---

## 22. Server Status Indicator

### Button

- `flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium border`.
- Background: `bg-zinc-800/90 border-zinc-700/50 shadow-sm backdrop-blur-sm`.
- **Status dot**: `w-2 h-2 rounded-full`.
  - Connected: `bg-green-500`.
  - Connecting: `bg-amber-500 animate-pulse`.
  - Offline: `bg-red-500 animate-pulse`.
- **Text**: "X online", "Connecting…", "Disconnected", or "Offline".

### Details Popover

- `absolute top-full right-0 mt-2 w-56 rounded-xl border shadow-xl`.
- **Header**: "Collab Server" in `text-xs font-semibold uppercase tracking-wider`.
- **Status rows**: Server, Supabase, Pub/Sub, WebSocket — each shows label + colored dot + "Connected"/"Down" text.
  - Connected: `text-green-400` + green dot.
  - Down: `text-red-400` + red dot.
  - Connecting: `text-amber-400` + pulsing amber dot.
- **Stats**: Room connections + uptime.

---

## 23. Export Modal

### Backdrop

- `fixed inset-0 z-[9999] flex items-center justify-center p-4`.

### Modal

- `w-full max-w-2xl max-h-[90vh] rounded-2xl shadow-2xl border`.
- Dark: `bg-zinc-900 border-zinc-800`. Light: `bg-white border-zinc-200`.
- Header: `text-xl font-semibold`.
- Preview: `w-full aspect-video rounded-lg overflow-hidden` with the board preview.
- Export button: `px-6 py-3 rounded-lg bg-blue-500 text-white hover:bg-blue-600` with Download icon.

---

## 24. Background Modal

### Modal

- `max-w-2xl max-h-[90vh] rounded-2xl border shadow-2xl`.
- Dark: `bg-zinc-900 border-zinc-800`. Light: `bg-white border-zinc-200`.

### Tabs

- `px-4 py-2 rounded-lg font-medium`. Active: `bg-blue-500 text-white`. Inactive: `bg-zinc-800 text-zinc-400 hover:bg-zinc-700`.

### Image Upload

- Drag-drop area: `border-2 border-dashed rounded-xl p-12`.
- Active drag: `border-blue-500 bg-blue-500/10`.
- Icon: Upload cloud, `w-12 h-12 mx-auto mb-3`.

### Color Picker

- Custom input: `w-16 h-16 rounded-lg cursor-pointer`.
- Preset grid: `grid grid-cols-6 gap-3`.
- Each color: `rounded-lg aspect-square hover:scale-110`.
- Selected: `ring-4 ring-blue-500 ring-offset-2`.

### Overlay Controls

- Toggle switch: `relative inline-flex h-6 w-11 items-center rounded-full`.
- Blur level buttons: sm / md / lg / xl presets.

---

## 25. Sticky Note Edit Modal

### Backdrop

- `fixed inset-0 bg-black/40 backdrop-blur-md z-[9999]`.

### Modal

- Uses the note's color class as background.
- `p-6 rounded-3xl shadow-2xl w-[420px] border border-white/20`.
- Animation: Scale `0.9 → 1`, opacity `0 → 1`, spring.

### Textarea

- `w-full min-h-[160px] max-h-[400px] p-4 border-0 rounded-2xl resize-none`.
- Dark: `bg-black/20 text-zinc-100`.
- Light: `bg-white/90 text-gray-900`.
- Focus ring: `ring-2 ring-blue-400/50`.

### Footer

- Cancel + Save buttons.
- Save: `bg-gradient-to-r from-blue-500 to-blue-600 text-white hover:from-blue-600 hover:to-blue-700 shadow-md px-5 py-2.5 rounded-xl`.

---

## 26. Task Modal

### Backdrop

- `fixed inset-0 z-[9999] bg-black/40 backdrop-blur-sm`.

### Modal

- `rounded-2xl shadow-2xl w-[440px] max-w-[95vw] overflow-hidden animate-in fade-in zoom-in-95`.
- Dark: `bg-zinc-800 border border-zinc-700`. Light: `bg-white`.

### Form

- **Sections**: `space-y-5`. Each section label: `flex items-center gap-1.5 text-sm font-semibold mb-2` with icon.
- **Description textarea**: `rounded-xl min-h-[100px] resize-none border`.
- **Date/time**: Side-by-side `flex gap-3` with Calendar icon overlay.
- **Priority selector**: Radio buttons or styled segments.
- **Submit**: `px-5 py-2 rounded-xl bg-blue-500 text-white hover:bg-blue-600 text-sm font-semibold`. Disabled: `bg-gray-100 text-gray-400 cursor-not-allowed`.

---

## 27. Media Modal

### Modal

- `max-w-lg max-h-[95vh] rounded-2xl shadow-2xl border flex flex-col`.

### Type Selection

- Two option cards side by side: Image / Video.
- `w-full p-4 rounded-xl border-2 transition-all`.
- Active: `border-blue-500 bg-blue-500/20`.
- Each shows icon in colored `p-3 rounded-lg` + label.

### File Upload

- `border-2 border-dashed rounded-xl p-6`.
- Drag active: `border-blue-500 bg-blue-500/10`.
- Center icon: `w-12 h-12 mb-3`.

---

## 28. Connection Lines Modal

### Modal

- `max-w-lg rounded-2xl border shadow-2xl`.
- Title: "Connection Line Settings".

### Color Mode Options

- Full-width buttons: `w-full p-4 rounded-lg border-2 text-left`.
- Active: `border-blue-500 bg-blue-500/10`.
- Radio indicator: `w-5 h-5 rounded-full border-2`.
- Multicolor preview: `flex gap-1 mt-3` with 6 color bars.

---

## 29. Custom Dropdown

### Trigger

- `w-full px-3 py-2 text-left border rounded-lg`.
- Dark: `bg-zinc-900 border-zinc-700 text-white hover:bg-zinc-800`.
- Light: `bg-white border-zinc-200 text-gray-900 hover:bg-zinc-50`.
- ChevronDown icon rotates 180° when open.

### Menu

- `absolute z-50 w-full mt-1 border rounded-lg shadow-lg max-h-48 overflow-auto`.
- Items: `text-xs font-medium`. Selected: `bg-blue-900/50 text-blue-300` (dark) / `bg-blue-50 text-blue-700` (light).
- Optional color dot: `w-2 h-2 rounded-full` before label.

---

## 30. Presentation Mode

When activated, the workspace enters a clean, distraction-free viewing mode.

### What Changes

- **Hidden**: Bottom Dock, Left Sidebar, all creation modals (Media, Background, ConnectionLine, AssignTask).
- **Shown**: PresentationDock (replaces main dock) + ExportModal.
- **TopBar**: Remains but self-collapses.
- **Canvas**: Full focus on board content.
- **Exit**: Press `Escape` key.

### PresentationDock

- **Position**: `fixed right-4 top-1/2 -translate-y-1/2 z-50` (vertical strip on right).
- **Shape**: `rounded-2xl flex flex-col gap-1.5 p-2 border shadow-xl backdrop-blur-xl`.
- **Tools**: Draw (Pencil), Eraser, Zoom Out, Zoom %, Zoom In.
- **Buttons**: `p-2.5 rounded-xl`. Active: colored text + `bg-zinc-700/60`. Tooltip appears to the left.
- **Tooltip**: `bg-zinc-800 text-white px-2.5 py-1 rounded-lg text-xs font-medium` with right-pointing arrow.

---

## 31. Personal Dashboard

### Layout

- **Full-screen split**: Fixed left sidebar (`w-64`) + scrollable main content area (`ml-64`).
- **Background**: `bg-zinc-900` (dark) / `bg-zinc-50` (light).

### Sidebar

- `w-64 fixed inset-y-0 left-0`, `bg-zinc-800/50 border-r border-zinc-700/50` (dark) / `bg-white border-r border-zinc-200` (light).
- **Header**: `px-5 py-5 border-b`. Contains DashboardSwitcher (see [Section 33](#33-dashboard-switcher)).
- **Navigation tabs**: `w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium`.
  - Active: `bg-blue-500/15 text-blue-400` (dark) / `bg-blue-50 text-blue-600` (light).
  - Inactive: `text-zinc-400 hover:bg-zinc-700/50` (dark) / `text-zinc-600 hover:bg-zinc-100` (light).
  - Icon size: 18px.
  - Unread badge: `w-5 h-5 rounded-full bg-blue-500 text-white text-[10px] font-bold`.
- **Footer**: `px-5 py-4 border-t` with "Member since" date.

### Tabs

Tabs: **Overview**, **Inbox**, **Friends**, **Boards**, **Activity**, **Settings**.

Tab content loads with Framer Motion fade + slide-up (`duration: 0.15s`).

### Overview Tab

- **Welcome banner**: Full-width card, `text-2xl font-bold`.
- **Quick stats**: `grid grid-cols-4 gap-3`. Each card: icon (16px) + value (`text-xl font-bold`) + label (`text-[11px]`). Alert cards get `border-red-500/40`.
- **Two-column layout**: Focus section (3/5 width) + Boards section (2/5). Tasks listed with priority badges (color-coded: red high, yellow medium, blue low). Board items with folder icon, title, timestamp.
- **Progress bar**: `h-2 rounded-full bg-gradient-to-r from-blue-500 to-emerald-500 transition-all duration-500`. Percentage right-aligned.
- **Analytics** (expandable): Toggle button with chevron. Charts:
  - Task Activity (Line): `h-48`, created (blue) vs completed (emerald).
  - Task Status (Doughnut): 65% cutout, Draft=zinc, Assigned=amber, Completed=emerald.
  - Priority Distribution (Doughnut): Low=blue, Normal=zinc, High=red.
  - Source Distribution (Doughnut): Sticky Notes=yellow, Checklists=emerald, Kanban=indigo.

### Inbox Tab

- **Category filter pills**: `flex items-center gap-1.5 mb-4`, `text-[13px] rounded-full`. Active: `bg-blue-500/15 text-blue-400`. Count badge: `text-[11px]`.
- **Invitations section**: Purple-tinted header, invitation items with Accept (green) / Decline buttons.
- **Task list**: Card with toolbar (`checkbox, refresh, bulk actions`) at top. Each row: checkbox + task title + priority badge + source type + due date (red if overdue).
- **Empty state**: Large icon (36px) centered with `py-20`.

### Friends Tab

- **Add friend card**: Email input (`pl-12 pr-4 py-3 rounded-xl border`) + UserPlus button (`bg-blue-500 rounded-xl px-6 py-3`).
- **Pending**: Clock header, items with Mail icon avatar in amber circle.
- **Accepted**: `space-y-2`, each row: avatar (image or initial `w-10 h-10 rounded-full`) + name/email + join date badge + remove trash button.

### Boards Tab

- **Grid**: `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3`.
- **Cards**: `rounded-2xl border p-5 hover:bg-zinc-800/80`. Icon (`w-10 h-10 rounded-xl bg-blue-500/15`), title (`text-sm font-semibold`), updated/created dates.

### Activity Tab

- Chronological list in `rounded-2xl border` card with `divide-y`.
- Each row: status dot (`w-2 h-2 rounded-full`) + title + message + timestamp.
  - Completed: `bg-green-400`. Assigned: `bg-blue-400`. Friend request: `bg-purple-400`.

### Settings Tab

- **Profile card**: `max-w-2xl`.
- **Avatar section**: `w-20 h-20 rounded-full` image with Camera icon overlay on hover.
- **Name fields**: `grid grid-cols-2 gap-4`. Inputs: `px-3 py-2 rounded-lg border text-sm`. Focus: `ring-2 ring-blue-500/30`.
- **Email**: Read-only `opacity-60`.
- **Save button**: `bg-blue-500 hover:bg-blue-600` or disabled `bg-zinc-700 text-zinc-500`.

---

## 32. Organization Dashboard

Same sidebar+main split layout as Personal Dashboard.

### Tabs

Tabs: **Overview**, **Inbox**, **Metrics**, **Members**, **Boards**, **Activity**, **Settings** (owner only).

### Overview Tab

- **Stat cards**: `grid grid-cols-4 gap-4 mb-8`. Each: icon in colored `p-2 rounded-xl` + value (`text-2xl font-bold`) + label (`text-xs`).
  - Blue (tasks), Purple (boards), Amber (members), Emerald (completion), Red (overdue).
- **Completion progress**: Card with `p-6`. Bar: `h-3 rounded-full bg-gradient-to-r from-blue-500 to-emerald-500`. Percentage: `text-2xl font-bold` right-aligned.
- **Charts**: Assignment Timeline (line, col-span-2, h-56), Task Status (doughnut, h-56).
- **Recent Activity**: List with unread highlighting (`bg-blue-500/5`) and dot indicators.
- **Recent Publishes**: Version badges, board names, counts.

### Metrics Tab

- **KPI Cards**: `grid grid-cols-4 gap-3`. 8 cards: Completion Rate, Avg Completion Time, On-Time Rate, Weekly Velocity, Overdue Tasks, Bottleneck Tasks, Tasks/Member, High Priority Avg.
  - Normal cards: Standard styling.
  - Alert cards (overdue/bottleneck > 0): `bg-red-500/5 border-red-500/20 ring-1 ring-red-500/10`.
  - Trend badge: `text-[10px] font-semibold px-1.5 py-0.5 rounded-md`. Positive: `text-emerald-500 bg-emerald-500/10` + TrendingUp. Negative: `text-red-500 bg-red-500/10` + TrendingDown.
- **Charts**:
  - Row 1 — Three doughnuts (`grid grid-cols-3 gap-4`): Task Status, Priority Breakdown, Source Types. All 65% cutout.
  - Row 2 — Timeline Line Chart (full width, h-64): Created vs Completed over weeks. Created `#60a5fa`, Completed `#34d399`.
  - Row 3 — Board Breakdown (stacked bar) + Member Workload (horizontal bar).
- **Chart styling**: Cards with rounded borders. Tooltips: dark bg `#27272a` text `#a1a1aa` border `#3f3f46`, corner radius 10px.

### Members Tab

- **Invite section** (owner only): Email input + UserPlus button (same as Friends).
- **Pending invitations**: Amber icon badges, email + "Invited X ago", revoke X button.
- **Active members**: Avatar (image or initials `w-10 h-10`) + name + badges (Owner: amber, You: blue) + email. Actions: join date, Metrics button (BarChart3 in blue badge), Remove (trash, red hover).

### Member Detail View (drill-down)

- **Back button**: ArrowLeft + "Back to members".
- **Profile card**: `w-14 h-14 rounded-full` avatar + name (`text-xl font-bold`) + email.
- **Stat cards**: `grid grid-cols-3 gap-3`, each centered with icon + value (`text-xl font-bold`) + label. Overdue: red text. High priority: flame icon.
- **Completion bar**: `h-2.5 rounded-full` gradient. Percentage: `text-lg font-bold`.
- **KPI cards**: `grid grid-cols-2 lg:grid-cols-4 gap-3`. Each: label (`text-[10px] uppercase tracking-wider`) + value (`text-2xl font-bold`) + trend badge.

### Boards Tab (Org)

- `grid grid-cols-2 gap-4`.
- Cards: `rounded-2xl border p-5 hover:shadow-md`. Purple icon (`p-2 rounded-xl bg-purple-500/15`), title, created date, last published date.

### Activity Tab (Org)

- Same as Personal Activity but with richer icon mapping:
  - `task_assigned`: UserPlus blue.
  - `task_completed`: CheckCircle2 emerald.
  - `task_unassigned`: X red.
  - `task_reassigned`: Users amber.
  - `org_invitation`: Mail purple.
  - `invitation_accepted`: CheckCircle2 emerald.
- Each icon in `p-2 rounded-xl` with matched color background.
- Unread items: `bg-blue-500/5` subtle highlight.

### Settings Tab (Org, owner only)

- **Logo**: `w-16 h-16 rounded-2xl` with Camera hover overlay.
- **Name input**: `px-4 py-3 rounded-xl border text-sm`.
- **Description**: `<textarea>` with `rows={3}`.
- **Save button**: Blue primary with Save icon.
- **Danger zone**: `rounded-2xl border p-6 bg-red-500/5 border-red-500/20`. Red title, warning text, large red delete button with Trash icon.

---

## 33. Dashboard Switcher

Appears in the dashboard sidebar header. Allows switching between Personal and Org dashboards without leaving.

### Main Button

- `w-full flex items-center gap-3 p-2 -m-2 rounded-xl`.
- **Avatar/Logo**: `w-10 h-10 rounded-xl` (image or initials placeholder with blue background).
- **Label**: `font-semibold text-sm truncate`. Sublabel: `text-xs` (Owner/Member).
- **Chevron**: Rotates on open.

### Dropdown

- `absolute left-0 right-0 top-full mt-2 rounded-xl border shadow-xl overflow-hidden`.
- **Header**: "Switch dashboard" in `text-[10px] font-semibold uppercase tracking-wider`.
- **Items**: Each `flex items-center gap-3 px-3 py-2.5`.
  - Active: `bg-blue-500/10` with blue text + Check icon.
  - Inactive: hover background.
  - Icon: `w-8 h-8 rounded-lg` with UserIcon (personal) or Building2/org logo.
  - Name: `text-sm font-medium truncate`.
  - Sublabel: `text-[11px]`.

---

## Appendix: Responsive Behavior

- **Canvas workspace**: Full viewport, no responsive breakpoints — relies on zoom/pan.
- **Auth pages**: `max-w-md` centered card, `p-4` padding on mobile.
- **Pricing**: 1 → 2 → 3 column grid at sm/md/lg breakpoints.
- **Dashboard**: Sidebar fixed `w-64`, main content has responsive max-width (`max-w-5xl` or `max-w-6xl`). Stat grids collapse from 4 → 3 → 2 → 1 columns.
- **Boards Panel**: `w-80` fixed width, slides over content.
- **Comments Panel**: `w-[480px] max-w-[90vw]`.
- **Modals**: Centered with `max-w-md` / `max-w-lg` / `max-w-2xl`, padding `mx-4`.

---

## Appendix: Brand Identity

- **Logo**: Square black rounded-lg container with white BORDS logotype inside. File: `bordclear.png`.
- **Colors**: Black and white primary. Blue-500 accent. Zinc grays for hierarchy.
- **Font**: `brand-font` with tight tracking for headings. System sans-serif for body.
- **Tagline**: "Collaboration at its finest".
- **Visual mood**: Minimalist, professional, dark-mode-first. Frosted glass surfaces. Subtle shadows. Smooth spring animations. Clean typography with generous whitespace.
