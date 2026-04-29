# DevOps Task Hub & Genshin Pixel Chat Room Implementation Plan

> **For execution:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the current Task Hub into a two-column layout featuring a global chat room for cross-agent collaboration/approvals, and re-theme the UI to an 8-bit Genshin Impact aesthetic.

**Architecture:** 
1. **State:** Expand Zustand store to include `chatMessages` array.
2. **Layout:** Refactor `page.tsx` into a CSS Grid/Flex layout (`70% Board | 30% Chat Room`).
3. **Components:** Build `GlobalChatRoom` and `ChatMessage` components. Update `PixelAvatar` to represent Genshin characters (Jean, Keqing, Zhongli, Nahida).
4. **Styling:** Update `globals.css` with Genshin elemental colors and reinforce pixel-art borders/shadows.

**Tech Stack:** Next.js (App Router), Zustand, Tailwind CSS, Lucide React (or SVG).

---

### Task 1: Update Global State (Zustand)

**Files:**
- Modify: `src/store/taskHubStore.ts`

- [ ] **Step 1: Define Chat Message Types**
Add `ChatMessage` interface (id, agentId, content, timestamp, isApprovalRequest, referencedTaskId, status).

- [ ] **Step 2: Update State Interface**
Add `chatMessages: ChatMessage[]` and actions `addChatMessage(msg)` and `updateChatMessageStatus(id, status)` to `TaskHubState`.

- [ ] **Step 3: Implement Actions & Mock Data**
Add some initial mock chat messages to demonstrate the approval flow. Implement the setter functions in the store. Update initial Agents to be Genshin characters (Jean, Keqing, Zhongli, Nahida).

### Task 2: Implement Global Chat Room Component

**Files:**
- Create: `src/components/task-hub/GlobalChatRoom.tsx`
- Create: `src/components/task-hub/ChatMessageItem.tsx`

- [ ] **Step 1: Build ChatMessageItem**
Create a component that renders a single message. If `isApprovalRequest` is true, render pixel-art style [Approve] and [Reject] buttons. Include the agent's `PixelAvatar`.

- [ ] **Step 2: Build GlobalChatRoom Shell**
Create the container with a fixed height, scrollable message area, and a chat input box at the bottom. Use a dark, JRPG-style dialogue box aesthetic (dark background, solid border).

- [ ] **Step 3: Connect to Store**
Hook up `useTaskHubStore` to read `chatMessages` and render `ChatMessageItem`s. Hook up the input box to `addChatMessage` (mocking a human response).

### Task 3: Refactor Main Layout (Two-Column)

**Files:**
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Update Grid/Flex Layout**
Change the main `<main>` container to hold the `Header` at the top, and a flex container below. The left side (`flex-1` or `w-[70%]`) holds the existing Agent columns. The right side (`w-[30%]`, fixed width like `350px` or `400px`) holds the `<GlobalChatRoom />`.

- [ ] **Step 2: Adjust Overflow**
Ensure the left side scrolls horizontally for agent groups, while the right side is fixed and scrolls its internal chat vertically.

### Task 4: Genshin Pixel Art Theming

**Files:**
- Modify: `src/app/globals.css`
- Modify: `src/components/task-hub/PixelAvatar.tsx`

- [ ] **Step 1: Update CSS Variables**
In `globals.css`, change agent theme names/colors to match Genshin elements (e.g., `--agent-jean: ...` for Anemo, `--agent-keqing: ...` for Electro). Update status colors to match elemental colors (Dendro Green for Done, Pyro Red for Blocked, etc.). Ensure borders are `1px solid` and shadows are sharp (`2px 2px 0px`).

- [ ] **Step 2: Redraw Pixel Avatars**
In `PixelAvatar.tsx`, update the `PIXEL_GRIDS` and `PALETTES` arrays. Draw 4 new 8x8 grids representing Jean, Keqing, Zhongli, and Nahida. Update the `themeStyles` mappings in `AgentTaskGroup.tsx` to match the new agent theme names if necessary.

- [ ] **Step 3: UI Polish**
Review `TaskCard.tsx` and `AgentTaskGroup.tsx` to ensure they use the new CSS variables and maintain the strict 8-bit visual style.
