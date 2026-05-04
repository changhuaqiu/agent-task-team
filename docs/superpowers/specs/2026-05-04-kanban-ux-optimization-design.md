# Kanban UX Optimization Design

**Status:** Draft
**Date:** 2026-05-04
**Scope:** MiniKanban + TaskDetailPanel + drag-and-drop

---

## Goal

Make the kanban board genuinely usable — data-rich cards, drag-and-drop interactions, expandable layout, and inline editing in the detail panel.

## Problem

Current MiniKanban lives in a 320px sidebar with 180px columns. Cards show only ID, title, status badge, and agentId. Available data (phase, dependencies, artifacts, reviewNote) is never visualized. No drag-and-drop — all status changes require clicking into the detail panel.

## Architecture

Add `@dnd-kit/core` + `@dnd-kit/sortable` for drag interactions. Extend existing MiniKanban component with expand/collapse toggle. Enhance TaskCard with data-rich layout. Add context menu via native event handling. Extend TaskDetailPanel with inline editing fields. All mutations go through existing `task_update` / `task_update_status` APIs (which write to both SQLite and TASKS.md).

---

## 1. Kanban Card Data Mapping

### Current card (4 data points)
ID, title, status badge, agentId

### Proposed card (~52px tall)

```
┌─────────────────────────────────────┐
│ ▌ TASK-001                    P1   │
│ ▌ Fix auth middleware          ▸ 2  │
│ ▌ 🟢 luigi              📎 🔗    │
└─────────────────────────────────────┘
  ↑                        ↑    ↑
  agent brand left    deps count  artifacts
  border (3px)        (if any)   (if any)
```

| Visual element | Data field | Condition | Token |
|---|---|---|---|
| Left border (3px) | `agentId` | always | `hsl(var(--agent-{name}))` |
| Phase tag (top-right) | `phaseId` | `phaseId !== ''` | `text-xs bg-muted` |
| Title (2-line clamp) | `title` | always | `text-sm font-medium` |
| Dependency count | `dependencies.length` | `length > 0` | `text-xs text-muted-fg` with `ChevronRight` icon |
| Artifact icons | `artifacts[]` | `length > 0` | `Paperclip` for file, `ExternalLink` for link |
| Agent row | `agentId` | always | Agent brand color dot + name; dashed avatar if unassigned |
| Blocked/Rejected cards | `status` | `blocked` or `rejected` | `bg-muted/50` background tint |

### Unassigned state
When `agentId === ''` or `'-'`: show dashed border avatar + "Unassigned" label in `text-muted-fg`.

---

## 2. Expandable Kanban Layout

### Collapsed (default)
- MiniKanban stays in 320px right panel
- Compact cards, 2-3 per column visible
- "+N more" overflow indicator at bottom of each column

### Expanded
- Kanban expands within the right panel (320px → full right panel width), does NOT overlay the chat area
- Columns grow to 260px each
- Up to 8 cards visible per column
- Phase filter bar remains at top

### Toggle
- Button in kanban header bar: `Maximize2` icon (expand) / `Minimize2` icon (collapse)
- Transition: 200ms fade, `transition-opacity` only — no sliding animation
- No layout shift to other panels — purely right-panel internal. Chat panel width is unchanged

---

## 3. Drag-and-Drop

**Library:** `@dnd-kit/core` + `@dnd-kit/sortable` (~12KB gzip)

### 3.1 Cross-column status change
- Drag card from one status column to another
- Maps to `task_update_status(id, newStatus)` mutation
- **Status transition enforcement:** Only allow drops on valid next states
  - `pending` → `in_progress`, `blocked`
  - `in_progress` → `in_review`, `blocked`
  - `in_review` → `done`, `rejected`, `blocked`
  - `blocked` → `pending`, `in_progress`
  - `rejected` → `pending`, `in_progress`
- Invalid drop targets render at reduced opacity during drag
- Drop animation: 150ms color transition on the target column header

### 3.2 Drag-to-assign agent
- Drag card onto an agent avatar in the AgentBar (top of workspace)
- Sets `task.agentId = agent.id`
- Maps to `task_update(id, { agentId })` mutation
- During drag over an avatar: avatar shows highlight ring using a dynamic class from a predefined map (e.g. `ring-2 ring-agent-mario` using CSS custom classes, no arbitrary values)
- Requires reading agent list from agent store

### 3.3 In-column reorder
- Drag card up/down within the same status column
- Purely visual — updates local sort order only, no data mutation
- Uses `@dnd-kit/sortable` with vertical list strategy

### Drag overlay
- Dragged card renders as a lifted card with `shadow-md opacity-90`
- Source position shows a `border-dashed border-muted` placeholder

---

## 4. Context Menu (Right-click)

Native `onContextMenu` handler on each card. Menu items:

| Label | Icon | Action | Condition |
|---|---|---|---|
| Mark as In Progress | `Play` | `updateStatus(id, 'in_progress')` | status = pending |
| Mark as In Review | `Eye` | `updateStatus(id, 'in_review')` | status = in_progress |
| Mark as Done | `Check` | `updateStatus(id, 'done')` | status = in_review |
| Block | `AlertTriangle` | `updateStatus(id, 'blocked')` | any non-done |
| — separator — | | | |
| Assign to → | `UserPlus` | sub-menu: agent list | always |
| View Dependencies | `GitBranch` | open detail panel, scroll to deps | `dependencies.length > 0` |
| Edit Task | `Pencil` | open detail panel, focus title | always |

Menu styling: `bg-popover border border-border rounded-md shadow-md`, items are `text-sm`, icon is `size-3.5`.

---

## 5. Enhanced TaskDetailPanel

Extend existing 450px panel with inline editing. All edits map to `task_update` mutation.

### 5.1 Inline editable fields

| Field | Edit interaction | Component |
|---|---|---|
| Title | Click → text input | `<input>` with `text-base font-medium` |
| Description | Click → textarea | `<textarea>` with `text-sm`, auto-grow |
| Phase | Click → select dropdown | Options: `P1`, `P2`, `P3`, `P4`, or custom |
| Agent | Click → agent picker | Avatar + name dropdown from agent store |
| Dependencies | Click → task checklist | Multi-select from current conversation's tasks |
| Artifacts | Click → add row | Type select (file/link) + label + URL inputs |

### 5.2 Rejection/block reason

When `status === 'rejected'` or `status === 'blocked'`:
- Show `reviewNote` field as editable textarea
- Label: "Rejection reason" or "Block reason" depending on status
- Pre-populated with existing `reviewNote` value
- Save maps to `task_update(id, { reviewNote })`

### 5.3 Dependency management

- List each dependency as a row: task ID + title + status badge
- Checkbox to add/remove dependency
- "Add dependency" button opens task picker (filtered to same conversation)

---

## 6. Data Flow

All interactions follow the existing bidirectional sync:

```
User drags card / edits field / clicks context menu
  → task_update_status / task_update mutation
    → SQLite update + TASKS.md file write
      → FileWatcher detects change
        → Socket.IO task.sync event
          → Zustand store update
            → React re-render
```

No new backend endpoints. No new data fields. All mutations use existing APIs.

---

## 7. Design System Compliance

- **Colors:** All via CSS variable tokens. Agent borders use `hsl(var(--agent-{name}))`. No hardcoded Tailwind colors.
- **Typography:** Only `text-xs`, `text-sm`, `text-base`, `text-lg`. Only `font-normal` and `font-medium`.
- **Spacing:** 4px grid. `gap-1` for card internals, `gap-2` for column spacing.
- **Border radius:** `rounded-sm` for cards, `rounded-md` for menus, `rounded-lg` for the expanded panel.
- **Hover:** `hover:bg-muted` only. No scale, no shadow on hover.
- **Animation:** 150ms for color changes, 200ms for expand/collapse. No bounce.
- **Icons:** Lucide React only. `size-3` for xs contexts, `size-3.5` for sm.

---

## 8. Files to Create/Modify

| File | Action | Purpose |
|---|---|---|
| `src/components/project/MiniKanban.tsx` | Modify | Add expand/collapse, DnD containers, column validation |
| `src/components/project/KanbanCard.tsx` | Create | New data-rich card with left border, phase tag, deps, artifacts |
| `src/components/project/KanbanColumn.tsx` | Create | DnD column with valid-target highlighting |
| `src/components/project/KanbanContextMenu.tsx` | Create | Right-click menu |
| `src/components/project/TaskDetailPanel.tsx` | Modify (or create if extracted) | Add inline editing, dependency picker, agent picker |
| `src/components/project/ExpandableKanban.tsx` | Create | Wrapper with expand/collapse toggle |
| `package.json` | Modify | Add `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities` |

---

## 9. Out of Scope

- Mobile/touch interactions (desktop-only for now)
- Batch operations (multi-select cards)
- Card filtering/search within columns
- Persistent sort order (in-column reorder is session-only)
- New data fields or backend endpoints
