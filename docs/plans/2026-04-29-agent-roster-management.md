# Agent Roster Management Implementation Plan

> 历史计划稿。该文档保留了早期 roster 设计过程，但其中的旧角色命名与“招募队伍”世界观不再是当前项目主表达。

## 当前状态

- `AGENT_ROSTER` 已经存在于当前代码中
- 当前项目使用 `Mario / Luigi / Toad / Peach / DK / Yoshi` 这一组内置角色
- 相关实现应以当前 `src/store/taskHubStore.ts` 与 `docs/wiki/02-frontend.md` 为准

## 说明

文中涉及的旧角色命名和主题化描述仅代表早期探索过程，不应再被用作当前产品文案或实现依据。

---

以下内容仅作为历史草稿保留，不代表当前事实。

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
Update `initialAgents` to include the full roster (Mario, Luigi, Toad, Peach, DK, Yoshi). Rename it to `AGENT_ROSTER`.

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
