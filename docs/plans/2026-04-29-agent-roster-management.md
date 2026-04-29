# Agent Roster Management Implementation Plan

> **For execution:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a "Preset Pool + Active Party" system for Agents, allowing users to invite and dismiss Agents from their Task Hub board.

**Architecture:** 
1. Separate `agents` in Zustand store into `roster` (all available agents) and `activeAgentIds` (those currently on the board).
2. Add a `[ + Invite Agent ]` button at the end of the Agent columns on the board.
3. Create an `AgentRosterModal` to display the uninvited agents from the roster.
4. Add a `[ Dismiss ]` button to the `AgentTaskGroup` header to remove them (if they have 0 pending tasks).

**Tech Stack:** Next.js (App Router), Zustand, Tailwind CSS, Lucide React.

---

### Task 1: Update Global State for Agent Roster

**Files:**
- Modify: `src/store/taskHubStore.ts`

- [ ] **Step 1: Expand the Agent Type**
We need a few more characters in the pool to make recruiting interesting. Add `albedo` and `venti` to `AgentTheme`.
```typescript
export type AgentTheme = 'jean' | 'keqing' | 'zhongli' | 'nahida' | 'albedo' | 'venti';
```

- [ ] **Step 2: Define the Full Roster**
Update `initialAgents` to include the full roster (Jean, Keqing, Zhongli, Nahida, Albedo, Venti). Rename it to `AGENT_ROSTER`.

- [ ] **Step 3: Update State Interface**
Replace `agents: Agent[]` with `activeAgentIds: string[]`. Add queries and mutations.
```typescript
interface TaskHubState {
  // ...
  activeAgentIds: string[];
  
  // Queries
  getActiveAgents: () => Agent[];
  getAvailableRoster: () => Agent[];
  
  // Mutations
  inviteAgent: (agentId: string) => void;
  dismissAgent: (agentId: string) => void;
}
```

- [ ] **Step 4: Implement Store Logic**
Initialize `activeAgentIds` with just `['jean', 'keqing']` (to simulate starting with a small party). Implement the getter and setter functions.
```typescript
  activeAgentIds: ['jean', 'keqing'],
  
  getActiveAgents: () => {
    const ids = get().activeAgentIds;
    return AGENT_ROSTER.filter(a => ids.includes(a.id));
  },
  
  getAvailableRoster: () => {
    const ids = get().activeAgentIds;
    return AGENT_ROSTER.filter(a => !ids.includes(a.id));
  },
  
  inviteAgent: (agentId) => set((state) => {
    if (state.activeAgentIds.includes(agentId)) return state;
    return { activeAgentIds: [...state.activeAgentIds, agentId] };
  }),
  
  dismissAgent: (agentId) => set((state) => {
    return { activeAgentIds: state.activeAgentIds.filter(id => id !== agentId) };
  }),
```
*Note: Also fix any existing references to `state.agents` in `page.tsx` and `ChatMessageItem.tsx` to use `AGENT_ROSTER` or `getActiveAgents()`.*

### Task 2: Implement Agent Roster Modal (Gacha Screen)

**Files:**
- Create: `src/components/task-hub/AgentRosterModal.tsx`
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Build the Modal Component**
Create a modal that reads `getAvailableRoster()` from the store. Display each available agent as a card showing their Avatar, Name, Role, and a "Recruit" button.
```tsx
// Example structure:
// <Dialog>
//   {availableAgents.map(agent => (
//     <div className="border p-4 flex items-center justify-between">
//       <PixelAvatar theme={agent.theme} />
//       <div>{agent.name} - {agent.roleLabel}</div>
//       <button onClick={() => inviteAgent(agent.id)}>Recruit</button>
//     </div>
//   ))}
// </Dialog>
```

- [ ] **Step 2: Add "Invite Agent" trigger to Board**
In `page.tsx`, at the end of the `agents.map(...)` horizontal list, add a large dashed-border button `[ + Invite Agent ]` that opens the `AgentRosterModal`.

### Task 3: Implement Dismiss Logic

**Files:**
- Modify: `src/components/task-hub/AgentTaskGroup.tsx`

- [ ] **Step 1: Add Dismiss Button to Column Header**
In the header of `AgentTaskGroup`, add an "X" or "Log out" icon button.

- [ ] **Step 2: Add Validation Logic**
Before calling `dismissAgent(agent.id)`, check if `tasks.length > 0`. If true, show a simple browser `alert('Cannot dismiss an agent with active tasks. Reassign them first.')` and return. If false, call `dismissAgent(agent.id)`.

### Task 4: Add New Themes to CSS and Pixel Grid

**Files:**
- Modify: `src/app/globals.css`
- Modify: `src/components/task-hub/PixelAvatar.tsx`
- Modify: `src/components/task-hub/AgentTaskGroup.tsx`

- [ ] **Step 1: Add CSS Variables for Albedo & Venti**
Albedo (Geo/Chalk): Yellow-white tones.
Venti (Anemo): Teal/Cyan tones.

- [ ] **Step 2: Update `themeStyles` in AgentTaskGroup**
Add the new `albedo` and `venti` configurations to the `themeStyles` map.

- [ ] **Step 3: Draw Pixel Grids**
Add simple 8x8 grids and palettes for `albedo` and `venti` in `PixelAvatar.tsx`.
