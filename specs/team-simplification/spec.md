# 团队精简：6 人组 → 4 人组 + 移除其他团队

> 状态：草案（draft）｜ 关联：`src/store/agentStore.ts`、`src/data/presetTeamPacks.ts`、`src/lib/agent-context/layers/`、`src/components/task-hub/`、`src/app/globals.css`

## 1. 目标

将默认团队从 6 人精简到 4 人（前后端合并、评审+测试合并），移除 engineering-trio 和 research-team 两个团队套件的全部数据/提示词/前端/代码。降低系统复杂度，保持当前稳定性。

## 2. 新 4 人组定义

| Agent ID | 名字 | Emoji | Theme HSL | 角色 | 职责 |
|---|---|---|---|---|---|
| `mario` | Mario | ⭐ | `0 72% 51%` | 项目统筹 | 任务分解、依赖排列、协调升级 |
| `dk` | DK | ⚙️ | `25 70% 35%` | 架构工程 | 架构评审、schema/安全/性能边界 |
| `luigi` | Luigi | ⚡ | `130 60% 40%` | 全栈开发 | 前后端实现、API 契约、数据模型 |
| `peach` | Peach | 🌸 | `330 70% 60%` | 质量保障 | 代码评审 + 集成测试 + 验收 |

### 移除的角色
- `toad`（后端开发）→ 合并进 luigi
- `yoshi`（QA 测试）→ 合并进 peach

### Luigi 新 Persona（全栈开发）

> 前端后端一把抓的务实工程师。接 Mario 的任务单，从前端组件到后端 API 全链路交付。接口契约自己定义、自己实现、自己联调，不需要分拆给两个人。用工程化的方式管理复杂度——类型安全、测试先行、增量提交。

### Peach 新 Persona（质量保障）

> 代码评审和测试验收一把抓的质量守门人。审查代码质量、安全、回归风险，然后亲自做集成测试验证。评审不通过直接打回 Luigi；架构问题升级给 DK。一个人管 review_gate + test_gate 两个阶段，确保交付完整。

## 3. Workflow 变化

### 旧（6 人，5 阶段）
```
planning(mario) → implementing(luigi+toad 并行) → review_gate(peach) → test_gate(yoshi) → done
```

### 新（4 人，4 阶段）
```
planning(mario) → implementing(luigi) → quality_gate(peach 评审+测试) → done
                       ↑ DK 按需介入架构 ←┘
```

review_gate + test_gate 合并为 quality_gate（Peach 一个人做评审+测试）。

## 4. 改动范围（5 层）

### 4.1 数据层
- **`src/store/agentStore.ts`**：AGENT_ROSTER 从 6 个删到 4 个（移除 toad、yoshi 定义）
- **`src/data/presetTeamPacks.ts`**：
  - default-team workflow 改 4 人（luigi 独立 implementing、peach 兼管 quality_gate）
  - 删除 engineering-trio、research-team 整个定义
  - 更新 workflow stages：implementing luigi 独立、review_gate+test_gate 合并 quality_gate
- **`src/server/seed-team-packs.ts`**：只 seed default-team 4 人
- **DB 已有数据**：删除 engineering-trio / research-team 的 team_pack + team_pack_role

### 4.2 提示词层
- **`src/lib/agent-context/layers/roleLayer.ts`**：
  - planner 分支：从泛化"前端角色/后端角色"改为"实现任务给 Luigi"（只有 1 个 dev）
  - code_reviewer 分支：合并 qa 职责（评审通过后自己做集成测试）
  - arch_reviewer 分支：泛化已改，调整引用为"反馈给 Luigi"
  - qa 分支：删除（合并进 code_reviewer）
- **`src/lib/agent-context/layers/teamPackLayer.ts`**：
  - HARNESS_STAGE_GUIDANCE 改 4 人（mario/dk/luigi/peach）
  - 删除 toad/yoshi guidance
  - workflow 描述改 4 人（"Luigi 独立 implementing"代替"Luigi/Toad 并行"；quality_gate 代替 review_gate+test_gate）
- **`src/lib/agent-context/layers/collaborationLayer.ts`**：检查并更新硬编码引用

### 4.3 前端层
- **`src/app/globals.css`**：删除 toad/yoshi 的 CSS 变量（`--agent-toad*`、`--agent-yoshi*`）
- **`src/components/task-hub/PixelAvatar.tsx`**：删除 toad/yoshi 像素头像 + theme map
- **`src/components/task-hub/ChatMessageItem.tsx`**：AVATAR_THEME_CLASSES 删除 toad/yoshi
- 其他引用 toad/yoshi 的组件：清理

### 4.4 代码清理
- 全局搜索 `toad`、`yoshi`、`engineering-trio`、`research-team`、`researcher`、`analyst`、`writer`、`planner`(非 category)、`coder`(非 category)、`reviewer`(非 category)：删除或替换
- 测试文件：更新引用（`seed-team-packs.test.ts`、`team-runtime.test.ts` 等）
- DB seed 逻辑：只 seed default-team

### 4.5 Spec 清理
- `docs/product/business/2026-05-17-default-team-collaboration-template.md`：更新为 4 人组当前事实
- 已删除的 spec（前一步清理的 a2a-v2 等）不涉及

## 5. 不改
- ACP 运行时协议、ContextManager 上下文语义和 agent session 稳定性实现
- DB 的 agent_session / chat_message / conversation（历史数据保留）
- BudgetGuard、ContextManager 的公共契约
- team pack 系统**机制**（创建/选择/切换代码保留，只是默认只有 1 个团队）
- 用户自建的 conversation/teamPack（保留运行时数据）

## 6. 验收指向

详见 `checklist.md`。核心：
1. 项目 build 通过，无 toad/yoshi/engineering-trio/research-team 残留引用
2. 4 人组（mario/dk/luigi/peach）在 UI 正确显示（头像/theme/名字）
3. workflow 4 阶段（planning → implementing → quality_gate → done）
4. 测试全绿（更新后的测试）
