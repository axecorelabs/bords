# BORDS — Product Overview

**Visual Productivity Platform by AXECORE Labs Inc.**

---

## What is BORDS?

BORDS is a **visual productivity platform** that transforms planning, thinking, and workflow management into a flexible, real-time collaborative experience. It provides an infinite digital canvas where individuals and teams organize ideas, tasks, and projects through drag-and-drop boards, modular blocks, and real-time collaboration — without being boxed in by rigid structures.

**Tagline:** *Collaboration at its finest.*

**One-liner:** Organize visually. Work flexibly. Collaborate in real time.

---

## Who is BORDS For?

### Individuals
- Freelancers managing multiple projects visually
- Students organizing coursework, research, and deadlines
- Creatives brainstorming and mood-boarding ideas
- Anyone who thinks better when they can *see* their work laid out

### Teams & Organizations
- Product teams mapping sprints, kanban flows, and roadmaps
- Agencies coordinating deliverables across clients
- Startups aligning distributed teams on shared boards
- Any team that needs visual project management with real-time collaboration

---

## Core Canvas Tools

Every board is an infinite canvas. Drop any of these modular blocks anywhere:

### Sticky Notes
Drag-and-drop notes with customizable colors. Click to expand into a full editing modal. Pin ideas, reminders, or quick thoughts anywhere on your board.

### Checklists
To-do lists with completable items, due dates, and email reminders. Track progress visually. Items can be assigned to team members and synced bidirectionally between the board and the database.

### Kanban Boards
Full kanban columns with draggable task cards. Each card supports titles, descriptions, assignees, due dates, priority levels, and completion status. Build entire project workflows directly on the canvas.

### Text Blocks
Freeform rich text placed anywhere on the board. Write long-form notes, documentation, or meeting agendas right alongside your visual elements.

### Media
Upload images and files directly to the canvas. Media is stored in the cloud (Wasabi) and rendered inline on the board. Supports drag-and-drop upload.

### Tables
Structured tabular data right on the canvas. Organize information that doesn't fit neatly into sticky notes or cards.

### Drawings
Freehand drawing tools powered by tldraw — sketch, annotate, highlight, draw arrows, create shapes, and erase. Multiple tool modes: select, hand (pan), draw, eraser, arrow, highlight, and shapes.

### Connections
Visual lines linking any items together. Map relationships, flows, and dependencies between elements on the board.

### Reminders
Set time-based reminders on any item. Get notified via email when deadlines approach so nothing falls through the cracks.

---

## Drawing & Canvas Tools

The bottom dock provides a full creative toolkit:

| Tool | Description |
|------|-------------|
| **Select** | Click and drag to select items on the canvas |
| **Hand** | Pan around the infinite canvas |
| **Draw** | Freehand drawing with pen/pencil |
| **Eraser** | Remove drawing strokes |
| **Arrow** | Draw directional arrows between elements |
| **Highlight** | Highlight areas with semi-transparent strokes |
| **Shapes** | Add geometric shapes to the canvas |
| **Drag Mode** | Toggle drag-and-drop behavior for items |
| **Grid** | Toggle background grid with snap-to-grid support |

---

## Real-Time Collaboration

BORDS is built for multiplayer productivity from the ground up.

### Live Cursors & Awareness
See collaborators' cursors moving on the board in real time. Know who's online, what they're looking at, and what they're editing — all rendered live via WebSocket.

### Multi-User Editing
Multiple users can edit the same board simultaneously. All changes sync instantly — add a sticky note, move a card, check off a task, and everyone sees it immediately. Powered by YJS conflict-free replicated data types (CRDTs).

### Offline-First Architecture
Boards work even without internet. YJS + IndexedDB stores your board locally. When you reconnect, changes merge seamlessly with the server — no data loss, no conflicts.

### Voice & Video Calling
Start a call directly inside a board using LiveKit. Discuss ideas while you both look at the same canvas. No need to switch to a separate app.

### Comments
Leave threaded comments on any board. Discuss changes, ask questions, and keep conversations in context — right where the work happens.

### Board Sharing & Permissions
Share any board with view or edit permissions. Control exactly who can see and modify your work:
- **Owner** — Full control, can share and delete
- **Editor** — Can add, modify, and remove items
- **Viewer** — Read-only access

---

## Workspaces

### Personal Workspace
Your private productivity space. Create boards, organize tasks, and work independently. Everything is yours and stays private until you choose to share.

### Organization Workspace
Create an organization, invite team members, and collaborate under a shared context. Features include:
- **Roles** — Owner, Admin, Member with appropriate permissions
- **Team boards** — Create boards within the org context, accessible to members
- **Board access control** — Grant or restrict board access per member
- **Centralized management** — Manage membership, roles, and permissions from one place

### Workspace Switcher
Seamlessly switch between personal and organization contexts. Each workspace maintains its own set of boards, settings, and collaborators. Dashboard buttons for both personal and org workspaces are always one click away.

---

## Dashboards

### Personal Dashboard
A user-friendly home screen for your personal workspace:
- **Overview** — At-a-glance stats: total boards, tasks, checklists, completion rates
- **Inbox** — Gmail-style notifications for task assignments, invitations, and updates
- **Friends** — Connect with other BORDS users
- **Boards** — Browse and open all your personal boards
- **Activity** — Timeline of your recent actions
- **Settings** — Profile picture, account management, preferences

### Organization Dashboard
A command center for team leads and org owners:
- **Overview** — Org KPIs, member count, board count, activity metrics
- **Metrics** — Charts and analytics powered by Chart.js (task completion, activity trends, member contributions)
- **Members** — Member list with roles, invite new members, manage permissions, drill into member detail views
- **Boards** — All organization boards with access controls
- **Activity** — Organization-wide activity feed
- **Settings** — Org profile, branding, configuration

---

## Task Delegation System

Assign work and track completion across your organization:

1. **Assign** — Assign checklist items or kanban tasks to team members from the board
2. **Publish** — Push assignments to the cloud so members receive them
3. **Sync** — When a member completes a task on their board, the completion syncs back to the owner's board automatically (and vice versa)
4. **Track** — Monitor assignment status: draft → assigned → completed

Bidirectional sync means the board is always the source of truth while the database stays in sync. No manual status updates needed.

---

## Presentation Mode

Turn any board into a presentation. Enter presentation mode to walk through your board content in a focused, full-screen view — perfect for team standups, client reviews, or idea showcases.

---

## Export

Export your boards for offline use or sharing outside BORDS. Save snapshots of your work to share with stakeholders who aren't on the platform.

---

## Security & Authentication

- **Email + password** sign-up with email verification
- **Google OAuth** single sign-on
- **Password reset** flow with secure email tokens
- **Session management** with secure cookies
- **Role-based access control** across all features

---

## Technical Architecture

| Layer | Technology |
|-------|-----------|
| **Frontend** | Next.js (React), TypeScript, Tailwind CSS |
| **Real-time sync** | YJS (CRDTs) + Hocuspocus WebSocket server |
| **Offline storage** | IndexedDB (y-indexeddb) |
| **Database** | Supabase (PostgreSQL) |
| **Document storage** | MongoDB (YJS document persistence) |
| **File storage** | Wasabi S3-compatible cloud storage |
| **Auth** | Supabase Auth (email + Google OAuth) |
| **Payments** | Paystack (subscriptions) |
| **Email** | ZeptoMail SMTP |
| **Voice/Video** | LiveKit |
| **Animations** | Framer Motion, GSAP |

### Key Design Decisions

- **Offline-first**: Every board works without internet. IndexedDB stores the full YJS document locally. Changes sync when back online.
- **CRDT-based sync**: YJS ensures conflict-free merging when multiple users edit simultaneously. No "last write wins" — all changes are preserved.
- **Canvas-native**: Items are freely positioned on an infinite 2D surface, not locked into rows or columns (unless you choose kanban).

---

## Pricing

### Free — ₦0/month
- Up to 3 boards
- Up to 50 tasks per board
- Basic sticky notes
- Task management
- Mobile responsive

### Pro — ₦5,000/month (or ₦48,000/year — save 20%)
- Unlimited boards
- Unlimited tasks
- Advanced connections
- Priority support
- Export capabilities
- Custom themes
- Up to 5 collaborators

### Team — ₦15,000/month (or ₦144,000/year — save 20%)
- Everything in Pro
- Unlimited collaborators
- Team workspaces
- Advanced permissions
- Real-time collaboration
- Team analytics
- Dedicated support

---

## Brand Identity

- **Company**: AXECORE Labs Inc.
- **Product**: BORDS
- **Design Philosophy**: Minimalist, monochrome-dominant, calm, distraction-free
- **Color Palette**: Black/white/zinc grayscale with subtle blue, pink, and yellow accents
- **Typography**: Inter (body/UI) + Outfit (display/headlines)
- **Voice**: Clear, direct, confident, empowering — no corporate jargon

### Core Pillars
1. **Visual** — Organize ideas with drag-and-drop simplicity
2. **Flexible** — Everything is a modular block you control
3. **Calm** — Minimalist design reduces cognitive load
4. **Smart** — Intelligent structuring for modern workflows

### Brand Promise
*"Collaboration at its finest."* BORDS gives users the freedom to organize visually, work together in real time, and build without being boxed in by rigid structures.

---

## Key Differentiators

| vs. Trello/Asana | vs. Miro/FigJam | vs. Notion |
|---|---|---|
| BORDS has a freeform canvas — items go *anywhere*, not just in lists | BORDS has structured productivity tools (kanban, checklists, tasks) built in — not just a whiteboard | BORDS is visual-first — see your entire workspace at a glance instead of scrolling pages |
| Real-time collaboration with live cursors | Offline-first architecture — works without internet | Infinite canvas with drag-and-drop, not a document editor |
| Voice/video calling inside the board | Task delegation with bidirectional completion sync | Organization workspaces with role-based access |

**BORDS combines the visual freedom of a whiteboard with the structured productivity of a project management tool — and it works offline.**

---

*Built by AXECORE Labs Inc. — Visual productivity for modern teams.*
