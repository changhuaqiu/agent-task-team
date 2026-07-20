# 项目上下文初始化（Project Context Bootstrap）

> 状态：active
> 日期：2026-07-20
> 关联模块：`src/server/project-context/`、`src/server/harness/context-planner.ts`、`src/pages/api/project-context.ts`、`src/pages/api/mutations.ts`、`src/components/project/ProjectCreateDialog.tsx`
> 依赖规格：`context-manager/`（唯一注入网关）、`a2a-possession-contract/`（任务交接语义不变）
> 长期设计：`docs/technical/execution/project-context-bootstrap.md`
> 产品决策：`docs/product/business/2026-07-20-project-context-bootstrap.md`

## 1. 问题

项目当前只把 `conversation.project_path` 作为执行 cwd 和两行 prompt 标签使用。创建项目不会为真实代码目录建立可复用的上下文入口，导致每个 Agent 在首次接到任务或 A2A 交接后都要自行递归搜索目录。

同一物理目录还可能同时承载多个进行中的工作项目。侧栏虽然按路径分组，但 harness 不知道这些并行工作项目存在，既无法复用共享代码库知识，也无法提前提示修改范围冲突。

## 2. 目标

建立一个位于项目发现与 ContextManager 之间的深模块，使调用方通过一个 `prepare()` interface 获得：

1. 对所选目录的确定性识别：现有代码库、新目录、已有上下文或包含多个独立代码库的容器目录。
2. 一次初始化、跨任务复用的分层知识入口。
3. 同一代码库下当前工作项目的最小冲突摘要，同时保持聊天、任务和私有轨迹按 conversation 隔离。
4. 基于当前请求的渐进式知识选择，不把整个目录或全部文档注入 prompt。
5. 可追溯的上下文 revision、fingerprint、来源路径和 I/O 诊断数据。
6. A2A 接收方通过 ContextManager 自动获得同一 revision 的共享代码库上下文，不依赖上游复制全量资料。

## 3. 非目标

- 不自动改写代码库已有的 `README.md`、`AGENTS.md`、`CLAUDE.md`、`docs/` 或 `specs/`。
- 不做向量数据库、embedding 检索或编译器级精确全量符号图；首版 Topology 是有界、可追溯的启发式代码图。
- 不把其他 conversation 的聊天、任务详情、Agent 轨迹或交接正文共享到当前 conversation。
- 不替代 ContextManager、Task Graph、A2A handoff packet 或 Git worktree。
- 不宣称确定性 I/O 代理评测等价于真实 LLM 质量评测。

## 4. 核心对象

| 对象 | 含义 | 事实源 |
| --- | --- | --- |
| Codebase | 规范化后的物理代码目录 | `conversation.project_path` + 文件系统 |
| Workstream | 同一代码库中的一次目标/会话 | `conversation` 表；`.ath/context/workstreams/*.json` 为可重建投影 |
| Project Context | 代码库共享的紧凑、版本化事实 | `.ath/context/manifest.json` |
| Knowledge Entry | 指向已有权威文档的元数据索引 | manifest 中的 catalog；原文件仍是权威事实源 |
| Context Capsule | 针对当前请求选出的紧凑注入内容 | `project-context` ContextContributor |

## 4.1 六层代码项目知识模型

代码项目不得退化为“一棵目录树 + 若干 Markdown”。共享上下文按稳定性、权威来源和消费方式分为六层：

| 层 | 回答的问题 | 权威来源 | 典型刷新 | 注入方式 |
| --- | --- | --- | --- | --- |
| L0 范围与身份 | 这是哪个代码库、边界在哪里、当前 revision 是什么 | 规范化 root、root marker、manifest | root/schema 变化 | 每轮固定，极短 |
| L1 规范与约束 | 必须怎样做、绝不能做什么 | 当前用户指令、`AGENTS.md`/override、`docs/standards/`、活动 spec、路径级 instructions | 指令文件或活动 spec 变化 | 最近作用域优先；硬约束 required |
| L2 架构与代码 Topology | 从哪里进入、模块如何连接、修改影响哪里 | source tree、package manifest、import/export、owner architecture docs | 结构、入口或依赖变化 | 全图落盘；按请求生成小型 repo map |
| L3 开发与运行 | 如何安装、构建、测试、检查和启动 | package scripts、构建清单、开发文档、CI 配置 | manifest/CI/开发文档变化 | 可信命令 + source，不推测命令 |
| L4 当前工作与交接 | 现在要达成什么、谁在同一代码区工作、接手哪一版 | 当前 conversation、Task/A2A、workstream 投影 | 每次工作项目状态变化 | 当前 workstream + 最小冲突信号 |
| L5 知识与证据 | 哪些 ADR、领域事实、经验和验证证据与本任务相关 | owner docs、ADR、`docs/wiki/`、受治理的 `docs/knowledge/`、receipt 引用 | owner doc 或 catalog 变化 | Top-K 路径/摘要/理由，按需展开 |

分层方法不是文件名约定，而是五条机械规则：

1. 每条事实必须有 `layer`、`source`、`authority`、`freshness` 和 `scope`。
2. 项目已有事实只索引不复制；生成物永远不是第二事实源。
3. 冲突优先级遵循仓库既有治理：当前用户指令 → `AGENTS.md` → standards → active specs → wiki/technical/product docs → knowledge。
4. 稳定层先加载、易变层后加载；硬约束不可因预算裁掉，Topology 和知识按请求裁剪。
5. Agent 先消费 capsule，再读被引用的 owner doc，仍不足时才做窄范围搜索。

### 4.2 Topology 契约

Topology 不是目录罗列。机器索引至少包含：

- 入口点与项目清单；
- 模块路径、语言、类型和导出符号；
- 可解析的 import/dependency 边；
- 模块入度、出度和 entrypoint 标记；
- 解析精度、截断与未解析依赖诊断。

首版对 TypeScript/JavaScript 和 Python 做启发式提取，对其他语言保留 manifest/目录级模块。启发式结果必须标记 `precision='heuristic'`，不得伪装成编译器精确事实。

请求侧 repo map 采用确定性排序：词项相关性 + entrypoint boost + 入度中心性 + 路径稳定排序。在字符预算内只呈现相关模块、导出符号和邻接边；完整 `topology.json` 不进入 prompt。

## 5. 场景契约

### 5.1 已有代码库且没有项目上下文

- 首次创建工作项目时扫描一次目录。
- 在真实代码目录的 `.ath/context/` 下创建生成型索引。
- 已有文档只建立引用，不复制、不覆盖。
- 后续 Agent 先得到入口、拓扑、命令和相关文档路径，再按需读取。

### 5.2 同一代码库已有其他进行中工作项目

- 复用同一个 Project Context manifest。
- 为新 conversation 新增独立 workstream 投影。
- 当前 Agent 只获得其他 active workstream 的标题、状态和短目标摘要，用于识别冲突；不得获得其消息、任务或私有轨迹。
- 当前 conversation 的 goal、task、history 继续遵循 `context-manager` 的 project scope。

### 5.3 空目录或尚未形成代码库

- 允许初始化，分类为 `empty`。
- 项目上下文只包含当前目标、约束、可用指令入口和“尚无代码结构”的显式事实。
- Agent 不得把宿主目录误当作代码库继续向上扫描。

### 5.4 容器目录中存在多个独立代码库

- 当所选目录自身不是代码库，但下层发现多个独立项目根时返回 `ambiguous_workspace`。
- 不猜测目标项目，不创建 conversation。
- UI 提示用户选择具体代码项目目录；不新增第二套项目类型选择器。

## 6. 存储布局

```text
<codebase>/.ath/context/
├── manifest.json
├── topology.json
├── INDEX.md
├── project/
│   ├── overview.md
│   ├── architecture.md
│   ├── topology.md
│   └── development.md
├── knowledge/
│   └── catalog.md
└── workstreams/
    ├── INDEX.md
    └── <safe-conversation-id>.json
```

所有文件均为生成型 read model：

- 人工权威文档仍位于代码库原位置。
- 生成文件使用原子替换写入；初始化不得覆盖非生成型文档。
- `manifest.json` 带 `schemaVersion`、`revision`、`sourceFingerprint`、`freshnessInputs`、六层 catalog 和扫描诊断。
- `topology.json` 保存完整有界代码图，`project/topology.md` 是为人和 Agent 准备的摘要投影。
- `.ath/context/` 可删除后重建；删除不影响 conversation、Task Graph 或原始文档。

## 7. 外部 interface

```ts
interface ProjectContextService {
  prepare(input: ProjectContextPrepareInput): Promise<ProjectContextResult>;
}

type ProjectContextPrepareInput =
  | { mode: 'inspect'; projectPath: string }
  | {
      mode: 'initialize' | 'load' | 'refresh';
      projectPath: string;
      conversation: { id: string; title: string; goal?: string; status?: string };
      requestText?: string;
    };
```

interface 保持单一；目录发现、扫描、fingerprint、知识排序、投影写入与 capsule 编译均隐藏在 implementation 内。测试只从 `prepare()` 的可观察结果验证行为。

## 8. 初始化与刷新

1. `inspect` 只读，不写文件。
2. `initialize` 在创建 conversation 时执行；不存在 manifest 时全量建立，存在时只注册/更新 workstream。
3. `load` 是 harness 路径；先用 manifest 的有限 `freshnessInputs` 做 O(k) 检查。未变化时直接命中缓存。
4. fingerprint 过期或 schema 不兼容时，`load` 自动执行一次受限刷新。
5. `refresh` 显式重建共享索引，但保留 workstream 投影。
6. 扫描跳过 `.git`、`.ath`、`node_modules`、构建产物、依赖缓存和符号链接，并受最大深度、条目数、文档数和单文件读取上限约束。

## 9. 渐进式加载

Context Capsule 固定包含：

- 代码库身份和 context revision。
- 当前工作项目的标题与目标摘要。
- 生效顺序明确的必读规范与硬约束入口。
- 面向当前请求的紧凑 repo map 和可信命令。
- 同目录其他 active workstream 的最小冲突摘要。
- 依据 `requestText` 排序后的少量 Knowledge Entry。

Capsule 不包含完整文档或源代码。Agent 只有在 capsule 不足时才读取被列出的具体文件，并在仍不足时做窄范围搜索。

## 10. ContextManager 接线

- 新增 server-side `project-context` contributor。
- contributor 对有路径和无路径 conversation 都返回一个 required fragment：
  - 有路径：返回版本化 capsule。
  - 无路径：返回“未绑定代码目录，不得扫描宿主目录”的明确约束。
- 项目上下文 fragment 使用当前 `conversationId` 作为 scope；跨 conversation 获取的只允许是同路径 active workstream 的冲突摘要。
- 正常 user/workflow/review/A2A dispatch 均经同一 contributor。
- evaluation snapshot 路径继续使用冻结 application snapshot，不读取可变的本地项目上下文。

## 11. 错误契约

| reason code | 含义 | 用户下一步 |
| --- | --- | --- |
| `project_path_missing` | 输入路径为空 | 选择代码目录 |
| `project_path_not_found` | 目录不存在 | 重新选择有效目录 |
| `project_path_not_directory` | 路径不是目录 | 选择目录而不是文件 |
| `ambiguous_workspace` | 容器目录下有多个独立代码库 | 选择具体代码项目目录 |
| `project_context_unreadable` | manifest 或来源不可读 | 检查权限后重试/刷新 |
| `project_context_write_failed` | 初始化投影失败 | 检查 `.ath` 写权限 |
| `project_context_schema_unsupported` | manifest 版本不兼容 | 显式刷新 |

错误必须包含 reason code、可读消息和候选项目根（适用时）。

## 12. 评测契约

评测必须同时覆盖：

1. 两类用户核心场景和 ambiguous/empty 边界。
2. 冷启动成本与 N 次 Agent/任务复用后的摊销成本。
3. 目录条目访问数、文件读取数、读取字节、注入字符/估算 token。
4. 相关文档 `Recall@K`。
5. 第二个 Agent 接手时是否无需递归扫描即可获得相同 revision、当前 workstream 和相关入口。
6. 结果区分确定性代理指标与真实模型质量，记录局限。

评测 fixture、命令、原始数据和报告必须进入仓库。

## 13. 退出条件

- 所有 checklist 项满足。
- 长期产品/技术文档与当前实现一致。
- 目标场景、兼容路径和失败路径均有自动化测试。
- 评测脚本可重复执行，报告包含实施前后量化对比与局限。
- 稳定知识完成迭代沉淀判断后，本 spec 迁入 `docs/archive/specs/` 并在 `specs/README.md` 标记 implemented。
