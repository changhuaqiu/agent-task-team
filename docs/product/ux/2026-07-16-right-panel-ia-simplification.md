# 项目右面板信息架构精简决策

> Status: Implementation in progress（2026-08-16 已完成 5→2 与“需要关注”，地图视图模型仍待下沉）
> Date: 2026-07-16
> 决策类型：业务 / UX 信息架构变更（`docs/standards/business.md` §5）+ 技术架构方向（`docs/standards/technical.md` §5）
> 关联文档：`docs/product/ux/2026-05-15-group-chat-task-flow.md`、`docs/technical/execution/group-chat-task-graph.md`

## 一、用户问题

用户反馈：项目右侧栏 tab 太多、感觉散。经代码与信息架构核查，确认根因不是“功能不够”，而是**把同一个领域的多种投影平铺成了多个一级 tab**，制造了假的信息架构。

现状右面板有 5 个一级 tab（`src/components/project/ProjectRightPanel.tsx:132-138`）：

| Tab | 数据来源 | 是否独立对象 |
| --- | --- | --- |
| 看板 | `tasks` 按 `status` 分列 | 否，是 Task 的投影 |
| 地图 | `/api/task-graph` 远程 + 本地 `tasks` 兜底 | 否，是同一 `tasks` 的关系投影 |
| 待办 | `tasks` 过滤 `blocked/in_review/proposed/ready` 取前 6（`buildNextItems`） | 否，**是看板的子集** |
| 风险 | `blockers` | 半独立，但量小 |
| 调试 | observability spans | 是，属诊断 |

证据级冗余：待办 tab 的数据 100% 是看板那批任务的子集过滤（`ProjectRightPanel.tsx:20-28`），不提供任何看板没有的信息，只是换了一种排列。

## 二、业务目标

- 回到用户主任务：用户来右面板只为一件事——**当前会话进展如何？我下一步该做什么？哪里卡住了？**
- 落实 `business.md` §2「少即是多」「主任务清晰」「渐进披露」。
- 消除“用 tab 制造的假 IA”：待办/风险本属同一关注点，地图本属同一对象的不同视角，不应占用一级位置。

## 三、采用方案：5 tab → 2 tab（任务主视图 + 调试）

### 目标信息架构

```text
右面板
├── 任务（主视图）
│   ├── 「需要关注」区（吸收原“待办” + “风险”）
│   │     阻塞 / 待评审 / 可开始 / 风险 统一成“下一步行动清单”
│   └── 视图切换（非独立 tab）：看板 · 列表 · 关系图
│         └─ 同一 Task[] 的三种投影，默认看板
└── 调试（诊断，默认收起/次级入口）
      └─ observability spans
```

### 各原 tab 去向

| 原 tab | 去向 | 理由（对齐规范） |
| --- | --- | --- |
| 看板 | 主视图默认模式 | 主任务载体（主任务清晰） |
| 待办 | 并入「需要关注」区 | 纯冗余投影，子集过滤（少即是多） |
| 风险 | 并入「需要关注」区 | 与待办同属“需要人介入”，合并后一处看全卡点 |
| 地图 | 降为视图切换项 | 关系图是看板的另一投影，不该占一级位置；`MiniKanban` 已有 `ViewMode` 机制（`MiniKanban.tsx:29`），加“关系图”为第四模式是自然扩展（渐进披露） |
| 调试 | 唯一独立次级 tab | 独立诊断对象，默认下沉（渐进披露） |

### 关键产品决策

1. **「需要关注」区是新的真实信息聚合**，不是待办的搬运。它把“阻塞 + 待评审 + 可开始 + 风险”统一成“下一步行动清单”，直击用户主问题。
2. **视图切换复用看板既有 `ViewMode`**：`MiniKanban` 已支持 `status / agent / list`（`MiniKanban.tsx:29`），新增“关系图”模式，而非新建 tab。
3. **`selectedTaskId` 作为跨视图选中键保留**——这是合理共享，不是耦合。各视图只通过自己的视图模型暴露选中态，不直接摸 store。
4. **调试保留为唯一独立 tab**——真正的独立对象（observability），符合“次级入口”定位。

## 四、放弃的方案

| 方案 | 为什么放弃 |
| --- | --- |
| 5 → 3（合并待办，地图/调试留独立 tab） | 地图交互虽重，但它是看板的投影，留独立 tab 仍保留了“假 IA”的一半 |
| 5 → 4（仅合并待办） | 只消除了最明显冗余，风险/地图的一级占用问题仍在，用户“散”的感受不会根治 |
| 给三个视图建独立 store | 它们共享领域是**正确**的，强行拆 store 会制造同步噩梦（违反事实源清晰） |
| 消除地图的双数据源（本地兜底 / 远程） | 这是真实业务约束（远程不可达时的降级），方案只把它**集中到一个 adapter**，不是消除 |

## 五、对技术与 UX 的约束

### UX 约束

- 页面主体展示用户当前正在处理的对象（`business.md` §4）。
- 「需要关注」区在视图切换之上，永远可见，不随视图模式隐藏。
- 视图切换为轻量 segmented control，不是 tab；切换不丢失选中态。
- 调试 tab 默认收起，需主动展开；诊断信息不压过主流程。
- 文案保持用户语言，不暴露 `edge / artifact / proof / runtime` 等内部词。

### 技术约束（边界收敛，`technical.md` §2）

- **事实源不变**：`Task[]` 仍是 `taskHubStore` 的单一事实源。本方案只重组投影层，不动领域事实源。
- **容器瘦身为纯壳**：`ProjectRightPanel` 应从 ~330 行收敛到 ~80 行，只负责开合 + tab 切换 + 渲染当前视图，不再内联数据派生。
- **视图表示不泄漏到容器**：地图视图模型（`TaskGraphMapView`、edge type、artifact kind）当前内联在容器（`ProjectRightPanel.tsx:86-130`），必须下沉到地图自己的视图层；容器不再 import 这些类型。
- **状态机单一事实源**：状态 vocabulary、repository 迁移和无需证据的浏览器动作均由 `src/shared/task-status.ts` 提供；`MiniKanban`、`KanbanContextMenu` 与 `TaskDetailPanel` 共同引用。
- **双数据源集中化**：地图的本地兜底 / 远程合并逻辑集中到一个 `useMapViewModel`，容器不感知。
- **不引入新框架/新全局状态/新依赖**（`technical.md` §3）。
- **`taskHubStore.ts`（2554 行）拆分不在本轮范围**，作为独立后续项。

### 渐进披露边界

- 地图（关系图）作为视图模式默认折叠/可选，不在主视图首屏强占空间。
- 「需要关注」区超过 N 条时折叠为摘要，点击展开。

## 六、影响边界（受影响文件）

本轮精简触及（最终实现时以 plan 为准）：

- `src/components/project/ProjectRightPanel.tsx`——重写 tab 结构（`tabs` L132-138、各 `TabsContent` L192-324），收敛为任务 + 调试。
- `src/components/project/MiniKanban.tsx`——扩展 `ViewMode` 支持关系图（吸收 `TaskGraphMap` 作为渲染模式之一）。
- 新增「需要关注」区组件——吸收 `buildNextItems`（L20-28）+ 风险渲染（L281-318）。
- 地图数据编排 `localGraph`（L86-130）随 `TaskGraphMap` 一起下沉到视图层。
- `MiniKanban` / `KanbanContextMenu` / `TaskDetailPanel` 引用 `src/shared/task-status.ts`，不再各自维护迁移表。

原决策明确**不**在当时轮次；当前由 `specs/frontend-architecture-refactor/` 继续推进：

- `taskHubStore.ts` 责任收缩。
- 任何 server / API / schema 变更（纯前端 IA 重组，不动数据层）。

## 七、成功标准（验收）

- 右面板一级 tab 从 5 降到 2（任务 + 调试）。
- 待办与风险的信息在「需要关注」区一处可见，不再有独立 tab。
- 地图作为看板的视图模式可达，切换不丢失 `selectedTaskId`。
- `ProjectRightPanel` 不再 import `TaskGraphMapView` 等地图视图内部类型。
- Task 状态与直接动作政策只有 `src/shared/task-status.ts` 一处定义。
- 现有测试（`TaskGraphMap.test.tsx`、`KanbanCard.test.tsx`、`kanban-integration.test.tsx`）通过或相应更新。
- 调试 tab 可达且默认不压过主流程。

## 八、决策记录要素（规范符合性）

- **背景**：用户反馈右面板 tab 过多、散。
- **决策**：5 tab → 2 tab，任务视图内聚合「需要关注」+ 视图切换，调试下沉。
- **替代方案**：5→3、5→4、独立 store、消除双数据源（见第四节，均放弃并记录原因）。
- **后果**：主任务更清晰，诊断信息下沉；代价是 MiniKanban 需吸收关系图模式，视图层改动集中。
- **退出 / 迁移条件**：若关系图模式因复杂度失控导致看板组件臃肿，则回退为“地图保留为独立 tab”（即降级到 5→3 方案），并在本文档记录回退原因。

## 九、与既有 IA 的关系

本决策是对 `2026-05-15-group-chat-task-flow.md`「信息架构」一节的**演进**，不推翻其“群聊是现场，任务图是白板”原则：

- 该文档“当前落地”部分提到“项目右侧栏新增‘地图’页签”。本决策将“地图”从独立页签改为任务视图内的视图模式，是对该落地的精简，**不改变任务图作为白板的定位**。
- 「需要关注」区吸收了该文档“当前态摘要”的思想（进行中 / 阻塞 / 下一步建议），把它从松散的文本摘要升级为可操作的“下一步行动清单”。
