# Team Pack 生态系统现状报告

> 更新时间：2026-05-05
> 状态：进行中

---

## 一、核心问题

### 1.1 Agent 显示与 Team Pack 不联动

**现象**：用户在创建项目时选择了团队套件（如「工程三件套」），但 AgentBar 仍然显示默认的 Mario 6 人组。

**根因**：
- `activeAgentIds` 是全局状态，不随项目切换而变化
- `setSelectedConversationId` 原实现只设置 `selectedConversationId`，不读取 `teamPackId`
- 即使读取了 `teamPackId`，`teamPackStore.teamPacks` 内存为空（未 fetch）

**已修复**：
- ✅ `setSelectedConversationId` 现在从 `/api/team-packs/:id` 获取套件
- ✅ 根据 `teamPack.roles` 更新 `activeAgentIds`

### 1.2 PromptComposer 未接收 TeamPack 上下文

**现象**：Agent 收到的 prompt 不包含团队协作规则（工作流、沟通矩阵、角色定义）。

**根因**：
- `daemonStore.dispatchToAgent` 构建 `composeOpts` 时未传入 `teamPack` 字段
- `ComposeOptions` 接口已定义 `teamPack?: TeamPack`，但从未被填充

**已修复**：
- ✅ `composeOpts` 现在包含 `teamPack` 字段
- ✅ 从 `conversation.teamPackId` 查找并传入

### 1.3 数据库 Schema 缺失字段

**现象**：API 返回 `"table team_pack has no column named team_mode"` 错误。

**根因**：
- 迁移 v11 创建 `team_pack` 表时未包含 `team_mode` 和 `source` 列
- 仓库代码引用了这些列，但表结构不存在

**已修复**：
- ✅ 迁移 v13 添加 `team_mode` 和 `source` 列

### 1.4 Conversation 未持久化 teamPackId

**现象**：创建项目时选择的 teamPackId 未保存到数据库。

**根因**：
- `conversationRepo.create()` 未处理 `team_pack_id` 参数
- `ConversationRow` 接口未定义 `team_pack_id` 字段

**已修复**：
- ✅ `ConversationRow` 添加 `team_pack_id` 字段
- ✅ `create()` 方法 INSERT 语句包含 `team_pack_id`

### 1.5 前端未映射 teamPackId

**现象**：从服务器加载的 conversation 对象不含 `teamPackId`。

**根因**：
- `loadFromServer` 中 conversations 映射未包含 `teamPackId`

**已修复**：
- ✅ 映射添加 `teamPackId: c.team_pack_id || undefined`

---

## 二、已完成的工作

### 2.1 后端基础设施（100%）

| 组件 | 状态 | 文件 |
|------|------|------|
| TeamPack 类型定义 | ✅ | `src/types/teamPack.ts` |
| 数据库 Schema | ✅ | `src/server/db/schema.ts` (v11 + v13) |
| 数据库迁移 | ✅ | `src/server/db/migrate.ts` |
| TeamPack 仓库 | ✅ | `src/server/repositories/team-pack-repo.ts` |
| API 端点 | ✅ | `src/pages/api/team-packs/` |
| 预设套件数据 | ✅ | `src/data/presetTeamPacks.ts` |
| 种子函数 | ✅ | `src/server/seed-team-packs.ts` |
| TeamPackLayer | ✅ | `src/lib/agent-context/layers/teamPackLayer.ts` |
| TeamModeEngine | ✅ | `src/lib/orchestration/TeamModeEngine.ts` |
| 安全扫描 | ✅ | `src/server/security-scanner.ts` |
| 导入管道 | ✅ | `src/server/role-card-import.ts` |
| 速率限制 | ✅ | `src/pages/api/role-cards/import.ts` |
| 错误国际化 | ✅ | `src/server/error-messages.ts` |
| 集成测试 | ✅ | 12/12 通过 |

### 2.2 前端 UI（90%）

| 组件 | 状态 | 文件 |
|------|------|------|
| TeamPack Zustand Store | ✅ | `src/store/teamPackStore.ts` |
| ProjectCreateDialog 套件选择 | ✅ | `src/components/project/ProjectCreateDialog.tsx` |
| SettingsDrawer 团队套件 Tab | ✅ | `src/components/task-hub/SettingsDrawer.tsx` |
| ProjectRightPanel 套件展示 | ✅ | `src/components/project/ProjectRightPanel.tsx` |
| ProjectRightPanel JSX 修复 | ✅ | `src/components/project/ProjectRightPanel.tsx` |
| Agent 列表联动 | ✅ | `src/store/taskHubStore.ts` |
| PromptComposer 集成 | ✅ | `src/store/daemonStore.ts` |

### 2.3 数据流完整性（100%）

```
创建项目 → 选套件 → teamPackId 存入 conversation
    ↓
加载项目 → /api/state → team_pack_id 映射为 teamPackId
    ↓
切换项目 → setSelectedConversationId → fetch teamPack → 更新 activeAgentIds
    ↓
AgentBar 显示套件角色
    ↓
dispatch → composeOpts.teamPack → PromptComposer → Agent prompt 包含团队上下文
```

---

## 三、当前状态

### 3.1 已验证功能

- ✅ 3 个预设团队套件已写入数据库
- ✅ API `/api/team-packs` 正确返回套件列表
- ✅ ProjectCreateDialog 可选择套件
- ✅ SettingsDrawer 团队套件 Tab 显示套件列表
- ✅ TypeScript 编译通过（0 错误）

### 3.2 待验证功能

- ⏳ 创建项目后切换，AgentBar 是否更新
- ⏳ dispatch 时 Agent 是否收到团队上下文
- ⏳ 从 GitHub 导入套件流程
- ⏳ 套件删除功能

### 3.3 已知限制

1. **预设套件 isPreset=false**：通过 API 创建的套件标记为 `isPreset: false`，需手动更新数据库
2. **team_mode 迁移**：已有数据库需重启服务以应用迁移 v13
3. **Agent 身份固定**：套件角色 ID（如 `planner`）与预设 Agent ID（如 `mario`）不匹配，需建立映射

---

## 四、技术债务

### 4.1 Agent ID 映射

**问题**：预设套件使用 `planner/coder/reviewer` 作为角色 ID，但系统预设 Agent 是 `mario/luigi/toad/peach/dk/yoshi`。

**影响**：选择「工程三件套」后，AgentBar 会显示 `planner/coder/reviewer`，但这些 ID 在 `AGENT_ROSTER` 中不存在。

**方案**：
1. 在 `AGENT_ROSTER` 中添加通用角色 ID 支持
2. 或在 TeamPack 中定义 `agentId` 映射关系
3. 或让预设套件使用现有 Agent ID

### 4.2 团队套件生命周期

**问题**：项目与套件 1:1 绑定，但当前未强制执行。

**方案**：
- 在 `conversation.update` 中禁止修改 `teamPackId`
- 或提供「更换套件」功能（需清理旧状态）

### 4.3 套件来源标记

**问题**：预设套件通过 API 创建，`source` 字段为空。

**方案**：在种子函数中显式设置 `source: { type: 'preset', importedAt: new Date().toISOString() }`

---

## 五、下一步计划

### 5.1 短期（本轮）

1. **验证端到端流程**：创建项目 → 选套件 → 切换 → Agent 更新 → dispatch 带上下文
2. **修复 Agent ID 映射**：确保套件角色 ID 与 AGENT_ROSTER 匹配
3. **更新预设套件 isPreset**：数据库层面标记为预设

### 5.2 中期

1. **GitHub 导入测试**：验证从社区仓库导入套件的完整流程
2. **套件编辑 UI**：允许用户微调导入的套件
3. **套件库管理页面**：独立的套件浏览和管理界面

### 5.3 长期

1. **动态团队**：运行时根据任务类型自动选择套件
2. **套件市场**：社区分享和发现机制
3. **嵌套套件**：大团队包含小团队

---

## 六、文件变更清单

### 本次修复涉及的文件

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `src/server/db/migrate.ts` | 修改 | 添加迁移 v13（team_mode, source 列） |
| `src/server/repositories/conversation-repo.ts` | 修改 | 添加 team_pack_id 字段支持 |
| `src/store/taskHubStore.ts` | 修改 | loadFromServer 映射 + setSelectedConversationId 联动 |
| `src/store/daemonStore.ts` | 修改 | composeOpts 添加 teamPack 字段 |

### 之前已完成的文件

| 文件 | 说明 |
|------|------|
| `src/types/teamPack.ts` | TeamPack 类型定义 |
| `src/server/db/schema.ts` | 数据库 Schema（team_pack, team_pack_role, agent_team_pack） |
| `src/server/repositories/team-pack-repo.ts` | TeamPack 仓库 |
| `src/server/seed-team-packs.ts` | 种子函数 |
| `src/data/presetTeamPacks.ts` | 预设套件数据 |
| `src/lib/agent-context/layers/teamPackLayer.ts` | PromptComposer 层 |
| `src/lib/orchestration/TeamModeEngine.ts` | 团队模式引擎 |
| `src/pages/api/team-packs/index.ts` | 套件列表 API |
| `src/pages/api/team-packs/[packId].ts` | 套件详情 API |
| `src/components/project/ProjectCreateDialog.tsx` | 项目创建套件选择 |
| `src/components/task-hub/SettingsDrawer.tsx` | 团队套件 Tab |
| `src/components/project/ProjectRightPanel.tsx` | 套件信息展示 |
| `src/store/teamPackStore.ts` | TeamPack 状态管理 |
| `src/server/security-scanner.ts` | 安全扫描 |
| `src/server/role-card-import.ts` | 导入管道 |
| `src/server/error-messages.ts` | 错误国际化 |
| `src/__tests__/repositories/team-pack-repo.test.ts` | 集成测试 |
