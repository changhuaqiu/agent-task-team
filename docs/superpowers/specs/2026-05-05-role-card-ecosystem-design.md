# Role Card Ecosystem Design

> 团队套件作为一等公民：从 GitHub 导入预组合的 Agent 团队，零配置即用

---

## 1. 概述

### 1.1 核心定位

- **消费方生态**：兼容 SoulSpec / GitHub 社区格式，让用户从 GitHub 导入团队套件
- **不做分发**：不建 Registry/Marketplace，只做导入和本地管理
- **团队组合**：核心价值是角色间的协作关系（工作流 + 通信矩阵 + 状态机），不只是散装角色

### 1.2 核心体验

从 GitHub 导入一个完整的团队包（角色 + 工作流 + 协作规则），零配置就能在项目中运行。

### 1.3 关键约束

- 项目与团队套件 **1:1 绑定**，生命周期内不可切换（避免状态机断裂、通信关系悬空）
- 如需其他团队，创建新项目
- 现有 Mario 6 人组自动包装为「默认团队套件」，向下兼容

---

## 2. 数据模型

### 2.1 TeamPack 核心结构

```typescript
interface TeamPack {
  id: string
  specVersion: 'team-pack/0.1'
  name: string                    // kebab-case, e.g. "engineering-trio"
  displayName: string             // "工程三件套"
  description: string
  version: string                 // semver
  source?: {
    type: 'github' | 'preset'
    url?: string
    importedAt: string
  }

  // 必填：角色列表
  roles: TeamPackRole[]

  // 必填：协作模式
  teamMode: 'pipeline' | 'parallel' | 'hub_spoke' | 'custom'

  // 可选：高级配置（teamMode=custom 时必填）
  workflow?: WorkflowDefinition
  communicationMatrix?: CommunicationMatrix
  teamRules?: TeamRules
  sharedContext?: string[]
}

interface TeamPackRole {
  id: string                      // 包内唯一，如 "planner"
  displayName: string
  roleCardId?: string             // 绑定到本地 RoleCard（导入后填充）
  soul: string                    // SOUL.md 路径或内联内容
  required: boolean
  description: string
}

interface WorkflowDefinition {
  type: 'state_machine'
  states: WorkflowState[]
}

interface WorkflowState {
  name: string
  role: string                    // 对应 TeamPackRole.id
  transitions: { to: string; condition: string }[]
}

interface CommunicationMatrix {
  [roleId: string]: {
    canSendTo: string[]
    canReceiveFrom: string[]
    canEscalateTo?: string[]
  }
}

interface TeamRules {
  maxIterations?: number          // 反馈循环上限
  escalationTimeoutHours?: number
  requireEvidence?: boolean
  autoAssign?: boolean
}
```

### 2.2 team_mode 内置行为

| Mode | 任务流转逻辑 | 适用场景 |
|------|-------------|----------|
| `pipeline` | 角色按定义顺序依次接力，前一个输出是后一个输入 | 规划→实现→审查 |
| `parallel` | 第一个角色（coordinator）分发子任务，其余角色并行执行，coordinator 汇总 | 调研团队、多模块并行开发 |
| `hub_spoke` | 中心角色按需调用周边专家，专家返回结果给中心 | PM + 多领域专家 |
| `custom` | 完全按 workflow.states 定义的状态机流转 | 复杂流程（类 Edict 三省六部） |

### 2.3 存储

```sql
-- 新增 team_packs 表
CREATE TABLE team_packs (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,            -- JSON serialized TeamPack
  is_preset INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 0,  -- 当前项目激活的套件
  created_at TEXT,
  updated_at TEXT
);

-- projects 表新增字段
ALTER TABLE projects ADD COLUMN team_pack_id TEXT REFERENCES team_packs(id);
```

---

## 3. 用户旅程

### 3.1 项目初始化流程（改造后）

```
创建项目
  ↓
填写项目基本信息（名称、描述）
  ↓
┌─────────────────────────────────────┐
│  选择团队套件                         │
│                                      │
│  ⭐ 默认团队（Mario 6人组）           │
│  📦 工程三件套                        │
│  📦 产品需求团队                      │
│  📦 内容营销团队                      │
│  📦 全栈团队                         │
│  📦 研究团队                         │
│  ─────────────────────               │
│  🔗 从 GitHub 导入...                │
│  📂 从已导入的套件中选择...           │
└─────────────────────────────────────┘
  ↓
预览团队阵容（角色卡片 + 协作模式图示）
  ↓
确认 → 进入项目
```

### 3.2 旅程触点

| 触点 | 行为 |
|------|------|
| **项目初始化** | 选择团队套件（必选，一次性绑定） |
| **项目设置** | 查看当前套件信息（只读） |
| **套件库管理** | 全局入口：导入/删除/预览套件（不绑定具体项目） |
| **任务分配** | 按当前项目绑定的套件 teamMode 规则流转 |
| **看板视图** | 按套件角色分列，体现流转关系 |

---

## 4. 导入管道

### 4.1 流程

```
用户粘贴 GitHub URL
  ↓
shallow clone（depth=1, timeout 30s）
  ↓
目录结构探测：
  ├── 找到 pack.json?   → 解析为 TeamPack
  ├── 找到 soul.json?   → 单角色，包装成单人 TeamPack (pipeline)
  ├── 找到多个 SOUL.md? → 多角色，推断 teamMode (parallel)
  ├── 找到 .github/agents/*.md? → 解析 YAML frontmatter
  └── 都没有?           → 报错 "未识别的格式"
  ↓
安全扫描（精简版 SoulScan）：
  - Prompt 注入模式检测（"忽略之前的指令"、"你现在是..."）
  - 敏感信息检测（API Key、Token、JWT）
  - 危险指令检测（eval, exec, rm -rf, child_process）
  ↓
格式转换 → 内部 TeamPack 结构
  ↓
预览确认（显示角色列表 + teamMode + 安全警告项）
  ↓
用户确认 → 写入 SQLite 套件库
```

### 4.2 格式兼容策略

| 来源格式 | 识别方式 | 转换规则 |
|----------|----------|----------|
| 我们的 pack.json | `specVersion: "team-pack/0.1"` | 直接解析 |
| SoulSpec 单角色 | 有 `soul.json` | 包装成单角色 TeamPack |
| SoulSpec 多角色目录 | 多个子目录含 `soul.json` | 推断为 parallel teamMode |
| Edict 风格 | 有 `SOUL.md` + 权限矩阵文件 | 映射为 custom teamMode |
| GitHub Copilot Agents | `.github/agents/*.md` | 解析 YAML frontmatter |
| SKILL.md 格式 | 目录含 SKILL.md 文件 | 提取角色定义，推断 teamMode |

---

## 5. 预置团队套件

### 5.1 套件列表

| 套件 | 角色 | teamMode | 来源参考 |
|------|------|----------|----------|
| **默认团队** | Mario(规划) + Luigi(前端) + Toad(后端) + Peach(代码审查) + DK(架构审查) + Yoshi(QA) | hub_spoke | 现有系统 |
| **工程三件套** | Planner + Coder + Reviewer | pipeline | 现有 spec |
| **产品需求团队** | PM + UX Researcher + Analyst | pipeline | claude-skills / Product-Manager-Skills |
| **内容营销团队** | Strategist + Writer + Editor + SEO | pipeline | gtm-agents / agency-agents |
| **全栈团队** | PM + Frontend + Backend + QA + Reviewer | pipeline | 现有 spec |
| **研究团队** | Researcher + Analyst + Writer | parallel | openclaw-multi-agent-kit |

### 5.2 产品需求团队 Pipeline

```
PM（需求定义 + 优先级排序）
  → UX Researcher（用户验证 + 场景分析）
  → Analyst（数据论证 + 可行性评估）
  → PM（输出最终 PRD）
```

### 5.3 内容营销团队 Pipeline

```
Strategist（选题 + 内容策略）
  → Writer（内容创作）
  → Editor（润色 + 质量把关）
  → SEO（优化 + 分发建议）
```

### 5.4 研究团队 Parallel

```
Researcher ──┐
             ├──→ Writer（汇总成文）
Analyst ─────┘
```

---

## 6. PromptComposer 集成

### 6.1 新增 TeamPackLayer

插入位置：TeamLayer 之后，ProtocolLayer 之前。

```
User Prompt 层序：
  SkillLayer
  ToolLayer
  TeamLayer         ← 现有：花名册表格
  TeamPackLayer     ← 新增：协作规则注入
  ProtocolLayer
  HistoryLayer
  TaskContextLayer
  A2ALayer
  UserMessageLayer
  BehaviorLayer
```

### 6.2 TeamPackLayer 输出内容

根据 teamMode 注入不同的协作指令：

| teamMode | 注入内容 |
|----------|----------|
| `pipeline` | 「你是流水线第 N 步。上游是 X（负责 Y），下游是 Z（负责 W）。完成后将结果传递给下游。」 |
| `parallel` | 「你是并行执行者之一。Coordinator 是 X。完成后回报给 Coordinator。不要等待其他并行角色。」 |
| `hub_spoke` | 中心角色：「你可以调用以下专家：[列表]。按需发起咨询。」<br>周边专家：「你被 X 调用。回答完毕后返回结果，不要主动发起其他工作。」 |
| `custom` | 注入完整状态机定义 + 当前所处状态 + 可用转换条件 |

---

## 7. 协作编排层

### 7.1 TeamModeEngine

```typescript
interface TeamModeStrategy {
  assignTask(task: Task, roles: TeamPackRole[]): string   // 返回被分配的 roleId
  getNextRole(currentRole: string, result: TaskResult): string | null
  canCommunicate(from: string, to: string): boolean
  buildPromptContext(role: string): string                 // 生成 TeamPackLayer 内容
}

// 四种策略实现
class PipelineStrategy implements TeamModeStrategy { ... }
class ParallelStrategy implements TeamModeStrategy { ... }
class HubSpokeStrategy implements TeamModeStrategy { ... }
class CustomStateMachineStrategy implements TeamModeStrategy { ... }
```

### 7.2 任务流转规则

- **Pipeline**: 任务进入时分配给第一个角色，完成后自动流转到下一个
- **Parallel**: Coordinator 收到任务后拆分子任务，分发给所有并行角色，全部完成后 Coordinator 汇总
- **Hub-Spoke**: 中心角色收到任务后自行决定调用哪些专家
- **Custom**: 严格按状态机转换表执行

---

## 8. 整体架构

```
┌─────────────────────────────────────────────────┐
│                  用户界面                         │
├─────────────────────────────────────────────────┤
│  项目初始化         套件库管理       GitHub 导入   │
│  (选择套件)         (预览/删除)      (URL→解析)   │
└──────────┬──────────────┬──────────────┬────────┘
           │              │              │
           ▼              ▼              ▼
┌─────────────────────────────────────────────────┐
│               TeamPack 服务层                     │
├─────────────────────────────────────────────────┤
│  TeamPackStore     ImportPipeline    SecurityScan │
│  (CRUD + 绑定)    (clone→探测→转换)  (规则引擎)  │
└──────────┬──────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────┐
│               协作编排层                          │
├─────────────────────────────────────────────────┤
│  TeamModeEngine                                  │
│  ├── PipelineStrategy                            │
│  ├── ParallelStrategy                            │
│  ├── HubSpokeStrategy                           │
│  └── CustomStateMachineStrategy                  │
│                                                  │
│  → 决定任务分配、流转、通信权限                    │
└──────────┬──────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────┐
│         PromptComposer (现有 + TeamPackLayer)     │
└──────────┬──────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────┐
│         Agent Runtime (现有, 不动)                │
└─────────────────────────────────────────────────┘
```

---

## 9. 导入后角色映射规则

导入的 TeamPack 中每个角色的 `soul` 内容会被转换为本地 RoleCard 并写入 `role_cards` 表：

1. 解析角色的 SOUL.md 内容，映射到 RoleCard 的 8 个维度（能映射的字段填充，无法映射的留默认值）
2. 生成的 RoleCard id 格式：`{packId}-{roleId}`（如 `engineering-trio-planner`）
3. 回写 `TeamPackRole.roleCardId` 指向新建的 RoleCard
4. 标记为 `isPreset: false`（用户可编辑微调）
5. 如果用户删除了套件，关联的 RoleCard 一并清理

---

## 10. 设计约束

1. **不侵入 Agent Runtime** — 套件是上层编排概念，执行层不感知
2. **向下兼容** — 现有 6 Agent 自动包装为默认 TeamPack，老项目不受影响
3. **安全优先** — 外部导入必过安全扫描，不通过不入库
4. **最小 UI** — 初始化选择 + 套件库列表 + 导入弹窗，三个界面
5. **项目绑定不可切换** — 避免运行时状态不一致
6. **分层复杂度** — team_mode 预设覆盖 80% 场景，custom 不封顶高级需求

---

## 11. 社区来源参考

用于预置套件的 SOUL 内容和后续推荐导入列表：

| 项目 | 适合场景 | 地址 |
|------|----------|------|
| claude-skills | 产品团队、营销团队、C-Level | https://github.com/alirezarezvani/claude-skills |
| gtm-agents | 销售、营销、客户成功 | https://github.com/gtmagents/gtm-agents |
| Product-Manager-Skills | PM 全流程 | https://github.com/deanpeters/Product-Manager-Skills |
| agency-agents | 12 部门 147 角色 | https://github.com/msitarzewski/agency-agents |
| awesome-openclaw-agents | 25 分类 192 角色 | https://github.com/mergisi/awesome-openclaw-agents |
| openclaw-multi-agent-kit | 生产级团队模板 | https://github.com/raulvidis/openclaw-multi-agent-kit |
