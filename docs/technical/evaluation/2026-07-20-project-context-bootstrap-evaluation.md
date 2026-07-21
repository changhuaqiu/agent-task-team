# Project Context Bootstrap Evaluation

- Change ID: `CE-20260720-project-context-bootstrap`
- Evaluation level: C
- Status: accepted（组件 C 级 + 2 条真实 Agent live verification；质量提升结论仍需 E 级成对实验）
- Code/spec revision: base `b9aaa67828336e71a65de853c89f734dbb5a9742` + working tree / `docs/archive/specs/project-context-bootstrap/`
- Evaluator revision: `project-context-benchmark-v1` + `project-context-live-e2e-v1`

## Why

旧链路只向 Agent 提供项目标题和物理路径。每个新 Agent 或交接接收方都需要重新枚举目录、发现规范、定位入口、读取开发命令并判断相关文档；同一路径的并行工作项目也不可见。

本变更要验证的不是“多生成了一套文档”，而是：

1. 共享结构事实是否只建立一次；
2. 热路径是否从递归发现降为有限 freshness check；
3. 任务相关入口是否能在小预算内保持可用召回；
4. 第二个 Agent 是否能复用同一 revision；
5. 其他 conversation 的私有轨迹是否仍不可见。

## What changed

候选方案实现六层 Project Context、机器可读 Code Topology、request-aware capsule、workstream 最小冲突摘要和 ContextManager contributor。所有生成物位于 `.ath/context/`，owner docs 和源代码不被覆盖，目录可删除重建。

live E2E 还发现并修复了一个 Project Context 之外、但会让真实首轮派发失效的冷启动问题：客户端曾在账户与当前 Team Pack 尚未完成解析时提前设置 `hasHydrated=true`。现在账户、选中 conversation、Team Pack、active roles 与 runtime profile 构成同一水合门，完成后才允许进入可交互态。

回退方式：移除 contributor 与创建链初始化，删除生成型 `.ath/context/`；业务数据库和 owner docs 不受影响。

## Industry evidence

| 来源 | 可迁移做法 | 本项目差异 |
| --- | --- | --- |
| [用户给出的阿里云 Harness 实践](../../interview/industry-reference/2026-07-20-alibaba-prompt-to-harness.md) | 上下文分层防线、确定性系统搬运、执行证据与评测闭环；不能靠更长 Prompt 掩盖上下文噪音 | 本项目落点是代码项目启动、repo map、owner docs 与跨 Agent 交接，不复制其企业流程树形编排 |
| [OpenAI Codex / AGENTS](https://openai.com/index/unrolling-the-codex-agent-loop/) | 从项目根到 cwd 逐层加载指令并限制总量 | 本项目还要显式 catalog、revision 和跨 Agent 复用 |
| [Claude Code memory](https://docs.anthropic.com/zh-CN/docs/claude-code/memory) | 项目/局部分层记忆与导入 | 本项目不把生成索引作为新的指令事实源 |
| [Aider repository map](https://aider.chat/docs/repomap.html) | 在小 token 预算内按相关性/图中心性选择代码地图 | 首版使用可追溯的启发式 parser，不声称编译器精度 |
| [Sourcegraph code navigation](https://sourcegraph.com/docs/code-navigation) | 定义/引用/依赖关系优于目录树，并区分精确与搜索路径 | 本地离线首版只提供 TS/JS 静态边和仓库内 Python module 的 heuristic graph |
| [Backstage TechDocs](https://backstage.io/docs/features/techdocs/creating-and-publishing/) | docs-as-code，owner docs 与生成/发布视图分离 | `.ath/context` 是本地运行 read model，不做发布站点 |

访问日期：2026-07-20。直接链接见产品和技术设计文档。

## Method

benchmark 使用固定临时代码库 fixture，比较：

- baseline：每个 Agent 独立递归枚举、读取候选规范/文档/源码头部并构造目录上下文；
- candidate cold：首次 `prepare(initialize)`；
- candidate warm：后续 N 次 `prepare(load)`；
- handoff：第二个 conversation/Agent 使用相同 codebase；
- stale：修改 freshness input 后自动刷新。

baseline 是在同一 fixture 上执行“每个 Agent 递归枚举并读取所有候选源文件/文档”的合成旧路径，用于建立可重复的上界代理；它不是生产环境历史 trace，也不能证明旧 Agent 每次都会把全部已读字符原样发送给模型。candidate 则调用真实 `ProjectContextService.prepare()` 实现。candidate 的 diagnostics 以完整调用为边界，合并 cache signature、前置 inspect 与 lock 内 load/scan 的实际 I/O/metadata checks；不得只取后半段计数。同一 service 的 warm handoff 可复用已验证内存索引，进程重启后的首次磁盘恢复不属于该 warm 样本。

主要指标：

- `entriesVisited`、`filesRead`、`bytesRead`；
- capsule 字符数与 `ceil(chars / 4)` token proxy；
- 相关 owner doc `Recall@K`；
- cold/warm/stale duration 中位数；
- context revision 是否复用；
- sibling projection 是否只含白名单字段。

成功阈值在运行前冻结：

- warm `filesRead` 相比 baseline 至少下降 80%；
- warm `bytesRead` 相比 baseline 至少下降 80%；
- fixture 查询 `Recall@5 = 1.0`；
- handoff 使用相同 shared revision，且输出中不存在 message/task/trajectory 字段；
- owner docs 内容 hash 前后不变。

运行命令：

```bash
pnpm run eval:project-context
```

原始数据：[`data/project-context-bootstrap-benchmark.json`](data/project-context-bootstrap-benchmark.json)

- artifact repository blob SHA-256（LF normalized）：`06b9ca1ec9fc88884e3d298470530319e75d2cd679ef5dc5bea47ba908f545ce`
- canonical payload digest（写在 artifact 内）：`e143343bd209f4cfc537e258b3bd8b188c94c6890ff077b6177dd2ff35a1b555`
- 环境：Windows x64、Node v24.14.0、Intel i5-13600KF、20 logical CPUs
- fixture：246 个源码模块、241 条依赖边、42 个知识文档
- 重复：8 次 Agent/任务接手

### 真实 Agent live verification

在独立 `ATH_DATA_DIR` 和全新 Next.js 服务进程中，先调用与创建 UI 相同的生产 `conversation.create` mutation 初始化真实目录，再通过真实浏览器页面打开项目并向已绑定 Claude OAuth 账号的 Mario 发出探针。探针明确禁止调用工具、读取/扫描目录和修改文件，因此回答只能来自该次 Harness prompt；本轮没有把 Windows FolderPicker 本身列入验收范围。

逐例 oracle 不信任 Agent 自述，而是交叉核对四类事实：

1. 磁盘 `.ath/context/manifest.json`；
2. `invocation` 的 engine、状态、prompt hash 与 token usage；
3. `context.assemble` span 中未裁剪的 `fragment:project-context:*` layer；
4. Agent 对 project name、kind、revision、topology/command/父目录约束的结构化回答。

空目录和已有代码目录必须分别通过全部 20 项检查，包括真实 engine/account、conversation/manifest/supplied root 的 canonical identity、完整 context span、精确 conversation-scoped fragment ref 与 evidence refs、持久化 tool-use 消息、observation tool span、场景 manifest 契约、prompt 锚点与回答一致性。另保存两种真实负例：首次冷启动在 Harness 前被拒绝且没有 invocation；旧开发进程的 daemon 单例没有 Project Context contributor，虽然 invocation 成功，但 span 中没有 project-context layer，prompt 没有生成 capsule，Agent 将通用项目标题误认为 Project Context。

可复跑收集命令：

```bash
pnpm run eval:project-context:live -- \
  --db <fresh-ath-data-dir>/data.db \
  --blank-conversation <id> --blank-project <path> \
  --existing-conversation <id> --existing-project <path> \
  --baseline-db <baseline-data.db> --baseline-conversation <id> \
  --out docs/technical/evaluation/data/project-context-live-e2e-20260721.json
```

原始数据：[`data/project-context-live-e2e-20260721.json`](data/project-context-live-e2e-20260721.json)

- artifact repository blob SHA-256（LF normalized）：`015b467d1ad64225512fe37d1045cb0c3dd93dedf8b52f8b78b2405c26557549`
- canonical payload digest：`1f0db07c313196d2e0dd2e8492d5ab463c48672cd54fec0c0fdb4b98f351a669`
- 环境：Windows x64、Node v24.14.0、隔离服务、真实 Claude OAuth execution

## Baseline vs candidate

### 单次路径

| 指标 | 旧基线：每个 Agent 全量发现 | Candidate cold | Candidate warm 中位数 | warm 相对基线 |
| --- | ---: | ---: | ---: | ---: |
| entries / metadata checks | 305 | 314 | 315 | **+3.28%**（root freshness + checkpoint signatures，见局限） |
| files read | 290 | 289 | 2 | **-99.31%** |
| bytes read | 148,165 | 148,146 | 602 | **-99.59%** |
| prompt chars | 156,721 | 3,045 | 2,978 | **-98.10%** |
| estimated tokens (`ceil(chars/4)`) | 39,181 | 762 | 745 | **-98.10%** |
| wall duration | 80.651 ms | 285.470 ms | 20.607 ms | **-74.45%** |

冷初始化要读取与旧基线相近的源内容，还额外生成模块/符号/依赖图、ownership、六层投影和独立 manifest integrity checkpoint，因此本次运行耗时比旧式单次发现高 **253.96%**。这个成本只在首次或 stale refresh 发生，且时间指标受机器负载影响。

合并终审发现初版 diagnostics 漏计前置 inspect I/O。修正后第一次诚实重跑得到 warm 5 files / 60,562 bytes，bytes 相对 baseline 只下降 59.13%，明确未达到冻结的 80% 阈值；没有通过降低阈值掩盖失败。随后将同一 service 已完整验证的内存索引用于 preflight：只有 ownership/manifest/checkpoint 文件签名未变才跳过大 manifest 的重复分类读取，签名 metadata checks 仍计数，进程重启首次恢复仍完整读取。最终冻结 fixture 得到 2 files / 602 bytes，完整调用边界断言与全部 7 个阈值通过。耗时不能作精确优化归因，因此只保留最新同轮对比。

### 8 次接手的摊销结果

| 指标 | 旧基线总计 | Candidate（1 cold + 7 warm） | 变化 |
| --- | ---: | ---: | ---: |
| entries / metadata checks | 2,440 | 2,519 | **+3.24%** |
| files read | 2,320 | 303 | **-86.94%** |
| bytes read | 1,185,320 | 152,360 | **-87.15%** |
| prompt chars | 1,253,768 | 24,054 | **-98.08%** |
| estimated tokens | 313,442 | 6,014 | **-98.08%** |
| duration | 857.063 ms | 431.247 ms | **-49.68%** |

### 质量和边界门

| 门 | 结果 | 证据 |
| --- | --- | --- |
| Knowledge `Recall@5` | **1.0（5/5）** | auth、database、accessibility、deployment、testing 查询均召回预期 owner doc |
| Handoff revision reuse | **通过** | 第二 workstream `cacheHit=true`，shared revision 保持 1 |
| Workstream privacy | **通过** | sibling 仅含 schemaVersion、conversationId、title、goalSummary、status、createdAt、updatedAt |
| Stale refresh | **通过** | 修改 source 后 cache miss，revision `1 → 2` |
| Owner docs integrity | **通过** | 5 个 owner docs 前后 SHA-256 全部不变 |
| 冻结阈值 | **7/7 通过** | 原始 artifact 的 `thresholds` 全为 true，含完整 prepare diagnostics 边界门 |
| 生成目录链接逃逸 | **阻断** | `.ath` 指向外部目录时初始化失败，外部没有生成文件 |
| 并发/checkpoint 完整性 | **通过** | 两个独立 service instance 串行发布；持锁后重读 DB 保留两个并发 workstream；篡改 topology 后 digest 校验触发重建 |
| manifest provenance | **fail closed** | manifest 完整 SHA-256 由独立 checkpoint 最后发布；只篡改 command、knowledge summary、instruction applyTo 或删除 checkpoint 均拒绝恢复 |
| freshness 正确性 | **fail closed** | root 新增源码触发刷新；1,610 个目录超过上限时标记 incomplete，后续 load 不命中 warm cache |
| 生成物 ownership | **阻断覆盖** | 无 marker 的预存 `INDEX.md` 被 inspect/initialize 拒绝，`OWNER FILE` 内容不变 |
| 规范作用域与注入边界 | **通过** | `applyTo` 同时过滤规范/Top-K；20 条约束不丢失；workstream 控制字符被净化并包入 untrusted envelope |
| 创建补偿回滚 | **通过** | 模拟 workstream 发布后失败，DB row、JSON 投影和 index 标签均清除 |

### 真实浏览器与 Agent 结果

| 场景 | 初始化事实 | Harness 证据 | Agent 回答 | 结果 |
| --- | --- | --- | --- | --- |
| 前置负例：客户端运行配置未水合 | Project Context 已生成，但首轮未进入 Harness | 系统返回“角色未绑定可用账号或执行引擎”；到下一次 human turn 前 invocation 数为 `0` | 无 Agent 回答 | **失败被结构化保留** |
| 负对照：无 capsule 的旧 daemon | invocation 成功，但不是有效 Project Context candidate | project-context layer `0`；生成 capsule heading 缺失 | 把 conversation 标题当项目名，revision/modules/command 均缺失 | **失败被正确捕获** |
| 空目录 | `empty`；revision 1；0 模块；0 命令；初始化 1.943 ms | path 三方一致；精确 capsule ref；project-context 188 tokens；无两类工具证据；prompt 锚点完整 | `blank-project / empty / r1 / 0 / NONE / 不允许父目录扫描` | **20/20 通过** |
| 已有代码目录 | `codebase`；11 模块；15 边；19 命令；初始化 127.824 ms | path 三方一致；精确 capsule ref；project-context 1,140 tokens；无两类工具证据；prompt 锚点完整 | `agent-task-hub / codebase / r1 / 11 / npm run build` | **20/20 通过** |

两条 candidate invocation 均使用真实 `claude` engine，状态为 `succeeded`。端到端时长分别为 29.450 秒和 42.742 秒；该时长包含队列、CLI 启动和模型生成，样本仅各 1 次，**不用于声称延迟改善**。live 验证证明的是“初始化产物确实进入真实 Agent prompt 且能被正确消费”，效率结论仍来自前述确定性 cold/warm benchmark。

冷启动水合缺陷的前后结果同样保留在 live artifact：修复前页面首条消息被 `no_runtime_profile` 拒绝，从该 human turn 到下一 human turn 之间 invocation 数为 0；修复后两个隔离项目均解析到绑定账号并启动真实 invocation。`server-hydration-runtime.test.ts` 固定了 `hasHydrated` 必须等待 accounts + Team Pack 的回归门，验证 Strict Mode 风格的重叠调用只能复用同一个 single-flight Promise，并覆盖 fetch 永久 pending、headers 已返回但 JSON body 永久 pending、Team Pack 失败时退出 skeleton、显示错误且可重试恢复。

### 自动化验证

- `ProjectContextService`：22 个 interface tests，覆盖初始化、Topology、cache、stale、empty、single/multiple root、workstream 隔离及上述对抗边界。
- Topology：2 个 tests，覆盖 NodeNext runtime extension 与 Python 仓库内绝对 module。
- API/创建链：5 个 tests，覆盖 inspect 只读、创建初始化、ambiguous 回滚、投影发布后补偿和并发双创建。
- Contributor：2 个集成 tests，覆盖同 revision 交接与无路径禁止 host scan。
- Project Context + ContextManager + Harness + mutation 相关回归：78 个通过，1 个 benchmark 在普通回归中按设计跳过；benchmark 由独立命令通过。
- 全仓 Vitest 最终复测：1,238 个通过、2 个既有失败、1 个按设计跳过；失败是缺少 `skill_revision` 表的迁移夹具和依赖真实 Claude ACP 的 handoff repro。既有 Store 测试另有 3 个相对 URL 未 mock 的 unhandled rejection。本变更新增的 1,610 目录压力用例在全仓并行负载下通过。
- 冷启动 runtime gate 定向回归：`server-hydration-runtime.test.ts` 6/6 通过；覆盖正常原子水合、state 与 Team Pack 两阶段的并发 single-flight、accounts/agents fetch 永久 pending、state body 永久 pending 的 15 秒超时、Team Pack reject 后错误展示与成功重试。
- manifest 对抗回归新增 9 项：四类 freshness/instruction/knowledge/command source 越界或非规范化路径、owner source 根外 junction、command/summary/applyTo 派生字段篡改和 checkpoint 缺失全部 fail closed。
- 最新主干集成回归：Project Context、ContextManager/Harness 与冷启动 runtime gate 共 46 个通过，1 个 benchmark 在普通回归中按设计跳过；新增模块、API、UI、Harness、脚本和测试的定向 ESLint 与 `git diff --check` 通过。
- live evidence collector：空目录与已有代码目录 2/2 case、40/40 checks 通过；交换 supplied project paths 时进程 exit 1，两场景 path binding 均失败；注入一条持久化 `tool_use` 消息时 exit 1。
- live artifact 结构化保留 `no_runtime_profile`/0 invocation 前置负例和 stale daemon/0 project-context fragment 负对照，不再只依赖评测叙述。
- 最新主干干净集成分支的全仓 `tsc --noEmit` 通过；原共享工作区中的 5 个未提交 voice/microphone 错误未进入本次 MR。
- Next production build 使用 `next build --webpack` 完成编译、TypeScript、7 个静态页面生成和路由收集。临时 worktree 的默认 Turbopack 构建因测试专用 `node_modules` junction 指向项目根外而在编译前被拒绝，不归因于候选代码。
- 全文件 ESLint 扫描仍暴露主干 `mutations.ts` / `taskHubStore.ts` / `agentStore.ts` 的 68 个既有 `no-explicit-any` 错误；本轮新增模块和直接新增代码的定向 ESLint 通过，不将基线技术债伪装成本次回归。
- 独立代码复审作为合并门：前序评审关闭 root freshness、链接逃逸、并发投影和 hydration single-flight 等 blocker；合并终审又发现响应 body 生命周期、manifest 派生字段 provenance 和 warm diagnostics 漏计三类 Important，分别以 body-pending 回归、独立完整 manifest checkpoint、完整 prepare 计数与 cache-signature 优化修复。每轮都保留失败数字、问题、修复与复测痕迹，只有最新 head 复审为 0 Critical / 0 Important 才允许合并。

## 局限与反证

1. `entriesVisited` 没有改善：warm path 为捕获未提交源码和根目录新增文件，会对有限 `freshnessInputs` 做 metadata stat，并额外验证 cache checkpoint signature；在 305 条 fixture 上与递归枚举数相当，8 次摊销反而多 3.24%。当前收益来自“不读内容、不重复推入 prompt”，不是避免所有 metadata I/O。
2. duration 受 OS page cache、杀毒软件和机器负载影响，因此只作次要指标；files/bytes/prompt chars 是主要确定性证据。
3. token 是字符/4 代理，不是 Provider 账单 token。
4. `Recall@5` 只有 5 个手工冻结查询，证明 owner 入口选择，不证明真实任务代码质量。
5. Topology 为 heuristic，解析 TS/JS 静态模块边、NodeNext runtime extension 和仓库内可确认的 Python module；路径别名、动态加载、第三方包语义、跨语言调用仍需 Agent 打开源文件验证。
6. 两条 live probe 证明真实注入链路可用，但不是代表性任务集，也没有冻结 baseline/candidate ApplicationSnapshot。要声称真实 Agent 成功率、代码质量或交接质量提高，仍须在现有 Agent Evaluation System 中做 E 级 paired experiment。
7. 负对照来自热更新前 daemon 单例，不等价于正式历史版本的 ApplicationSnapshot；它只证明 collector 能识别“Agent 启动了但 capsule 没进去”的假成功。
8. live invocation token 和时长包含 Team Pack skills、CLI 启动及模型生成，不能归因于 Project Context；artifact 保留原值用于审计，不做性能归因。
9. warm 指标代表同一长期运行 service 内的 Agent/任务交接；进程重启或另一进程首次接手会完整读取约 60 KB 的 manifest/ownership/checkpoint，再建立已验证内存索引，不能把 602 bytes 外推到该冷进程恢复场景。

## Decision

**接受本次 C 级变更，并接受真实链路可用性结论。**

理由：所有确定性门均通过；热路径与 8 次摊销的读取、上下文体积和时间改善显著；两个真实目录场景也证实 capsule 进入实际 Harness prompt 并被真实 Agent 正确消费。冷成本、metadata 访问未改善、heuristic 精度以及 live 样本不足均被显式暴露，没有被平均数掩盖。

保留条件：

- `project-context-benchmark-v1` 进入后续相关修改的回归命令；
- 改动 scanner、ranker、capsule budget、workstream 白名单或 manifest schema 时必须生成新的 Change Evaluation Record 或引用本 Change ID 复测；
- 改动客户端 hydration、Team Pack 解析、daemon contributor 注册或 context report schema 时，必须重跑 `project-context-live-e2e-v1`；
- 后续优化 freshness 时，目标是减少 metadata checks，但不得以漏掉工作树变更换取漂亮数字；
- 完成 E 级实验前，对外可以声称“组件 I/O/上下文代理指标改善”和“空/已有代码两条真实注入链路通过”，不能宣称“Agent 任务质量或成功率提高”。
