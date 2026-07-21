# 知识索引

本文件是 `docs/knowledge/` 的统一索引。新增或更新知识条目时，必须同步更新本索引。

## 状态说明

- `draft`：初步判断，可参考但不能作为强制门禁。
- `verified`：已有证据支撑，可作为默认执行依据。
- `proven`：长期复用稳定，可升级为规范、模板或门禁。
- `deprecated`：已被替代，只保留历史参考。

## 索引表

| ID | 标题 | 类型 | 层级 | 成熟度 | 标签 | 权威位置 |
| --- | --- | --- | --- | --- | --- | --- |
| `KG-001` | 知识资产需要分层、类型、成熟度和引用闭环 | `model` | `team` | `verified` | `knowledge-governance`, `standards`, `iteration` | `docs/standards/knowledge-governance.md` |
| `KG-002` | 重要变更必须形成可复测的前后评测证据链 | `process` | `team` | `verified` | `change-evaluation`, `evidence`, `harness` | `docs/technical/evaluation/README.md` |
| `KG-003` | live Agent E2E 必须核对控制面证据，不能只看回复 | `pitfall` | `technical` | `verified` | `live-e2e`, `harness`, `hydration`, `daemon` | `docs/technical/execution/project-context-bootstrap.md` |

## KG-001: 知识资产需要分层、类型、成熟度和引用闭环

- `type`: `model`
- `layer`: `team`
- `maturity`: `verified`
- `status`: `active`
- `tags`: `knowledge-governance`, `standards`, `iteration`
- `applicable_phases`: `planning`, `implementation`, `review`, `iteration-close`
- `owner_doc`: `docs/standards/knowledge-governance.md`
- `created_at`: `2026-05-13`
- `updated_at`: `2026-05-13`

## 结论

项目知识不能只靠零散文档或聊天记录维持。可复用知识必须具备：

- 分层：明确适用范围。
- 类型：明确它是模型、决策、规范、反模式、流程还是证据。
- 成熟度：明确可信程度。
- 证据：能追溯来源。
- 索引：能被 Agent 按需发现。
- 淘汰机制：过时知识不继续指导新工作。

## 证据

- 用户提供参考文章：`https://zhuanlan.zhihu.com/p/2032094280060252204`
- 项目规范入口：`docs/standards/README.md`
- 知识治理规范：`docs/standards/knowledge-governance.md`

## 适用边界

适用于项目内长期协作规范、工程经验、产品原则和可复用流程。不适用于一次性命令输出、短期讨论过程或没有复用价值的聊天片段。

## KG-002: 重要变更必须形成可复测的前后评测证据链

- `type`: `process`
- `layer`: `team`
- `maturity`: `verified`
- `status`: `active`
- `tags`: `change-evaluation`, `evidence`, `harness`
- `applicable_phases`: `planning`, `implementation`, `review`, `iteration-close`
- `owner_doc`: `docs/technical/evaluation/README.md`
- `created_at`: `2026-07-20`
- `updated_at`: `2026-07-21`

## 结论

每项修改都要能回答 Why、What、Industry、Measure 和 Decision。局部变更至少留下可重复验证；性能、上下文、Harness、工作流和重要 API/UX 变更必须有前后基线、原始数据与局限；任何“Agent 更好”的结论必须升级为固定数据集和冻结 ApplicationSnapshot 的 E 级成对实验。行业材料解释为什么选择方案，但不能替代本项目测量结果。

## 适用场景

- 修改 Harness、上下文编译、检索、缓存、工作流、API 行为或重要用户路径。
- 提议优化 RoleCard、Skill、Prompt、团队协作策略或 Agent 成功率。
- 需要决定保留、回滚或继续实验一项工程变更。

## 不适用场景

- 不能用 C 级 I/O、token proxy 或 Recall@K 直接声称真实 Agent 任务质量提升。
- 不能为了获得更好数字而省略失败样本、冷启动成本或 freshness 漏检风险。

## 证据

- 规范：`docs/technical/evaluation/README.md`
- 首个 C 级记录：`docs/technical/evaluation/2026-07-20-project-context-bootstrap-evaluation.md`
- 原始 artifact：`docs/technical/evaluation/data/project-context-bootstrap-benchmark.json`
- live artifact：`docs/technical/evaluation/data/project-context-live-e2e-20260721.json`
- 自动化：`src/server/project-context/project-context-benchmark.test.ts`
- live 收集器：`scripts/collect-project-context-live-e2e.mjs`

## 执行动作

- 设计前确定评测级别、旧基线、候选方案、指标和成功阈值。
- 实现中保存可重跑命令与机器可读原始数据。
- instrumentation 必须包围完整用户可观察事务；分阶段实现要在返回边界合并一次计数，不能遗漏 preflight，也不能重复累计。
- 交付时并列报告收益、代价、未覆盖风险和复测触发条件。

## 风险和反例

- 只写“测试通过”无法证明为什么改或效果如何。
- 只比较 warm path 会隐藏 cold init 成本。
- 只统计核心算法而遗漏 inspect/hydration 等前置 I/O，会制造虚假的效率收益。
- 只引用业界最佳实践会把外部权威误当成本项目证据。

## 引用记录

- 2026-07-20：Project Context Bootstrap 以 C 级 benchmark、对抗测试和评审修复验证该流程。
- 2026-07-21：空目录/已有代码目录真实 Agent 验证保留负对照、逐例 span/prompt/response 证据与机器可读 artifact。

## KG-003: live Agent E2E 必须核对控制面证据，不能只看回复

- `type`: `pitfall`
- `layer`: `technical`
- `maturity`: `verified`
- `status`: `active`
- `tags`: `live-e2e`, `harness`, `hydration`, `daemon`, `observability`
- `applicable_phases`: `implementation`, `review`, `debugging`, `iteration-close`
- `owner_doc`: `docs/technical/execution/project-context-bootstrap.md`
- `created_at`: `2026-07-21`
- `updated_at`: `2026-07-21`

## 结论

“页面出现 Agent 回复”或“invocation succeeded”都不能证明目标 Harness context 已进入模型。live E2E 必须使用全新服务进程和隔离数据目录，并同时核对 supplied/conversation/manifest path identity、runtime hydration、invocation prompt、`context.assemble` snapshot 的精确 fragment/evidence、持久化 tool-use 消息、磁盘事实与 Agent 结构化回答。客户端 cold start 还必须以 single-flight 覆盖整条 hydration 链路，否则 React Strict Mode 的重叠调用可能让较慢结果在门已打开后覆盖 Team Pack 或 active roles。

Next.js 开发态热更新可能保留挂在 Socket.IO server 上的旧 daemon 单例；此时 API 路由可以生成新 Project Context，但 daemon 仍使用旧 contributor 集合。客户端若在 accounts/Team Pack 解析前提前 hydrated，也会让首条任务在 Harness 前失败；若只等待而没有超时，又会永久卡在 skeleton。readiness gate 中每个被等待的远程依赖（包括容易遗漏的 Agent roster）都必须有 15 秒超时、可见错误和重试动作。

生成型 manifest 也必须视为不可信输入：topology digest 只能证明 topology 未变，不能证明 freshness、instruction、knowledge、command 或它们的 owner path 仍有 provenance。磁盘恢复必须先通过独立的完整 manifest digest checkpoint，再做完整 schema、仓库内相对路径、freshness 对应、no-link ancestor 与 realpath containment 验证；否则 command/summary/applyTo 等派生字段可脱离 owner source 冒充 explicit/trusted 内容。

## 适用场景

- 修改 ContextManager contributor、Harness planner、daemon 初始化、Team Pack/runtime 解析或客户端 hydration。
- 验证空目录/已有项目初始化、真实账号执行或跨 Agent 交接。
- 对外声称某段上下文已被真实 Agent 消费。

## 不适用场景

- 纯函数和确定性 scanner 单测不要求启动真实模型；它们仍应作为更快的组件回归层。
- 两条 live probe 不能替代固定 TestSuiteRevision 与 ApplicationSnapshot 的 E 级任务质量实验。

## 证据

- 权威设计：`docs/technical/execution/project-context-bootstrap.md`
- 评测记录：`docs/technical/evaluation/2026-07-20-project-context-bootstrap-evaluation.md`
- 正负例 artifact：`docs/technical/evaluation/data/project-context-live-e2e-20260721.json`
- 冷启动回归：`src/__tests__/store/server-hydration-runtime.test.ts`
- 证据收集器：`scripts/collect-project-context-live-e2e.mjs`

## 执行动作

- live E2E 使用 fresh daemon + 独立 `ATH_DATA_DIR`，不得依赖热更新后的旧进程。
- 用户输入探针禁止工具和目录扫描，避免模型从旁路重新发现答案。
- 对每个场景逐项核对 path binding、manifest、prompt anchors、精确 project-context ref/evidence、span + durable tool-use 证据和回答字段；任一缺失即失败。
- 将失败样本与 candidate 一并保留，不能只截图成功回复。

## 风险和反例

- Agent 可能把通用 conversation 标题误称为 Project Context；只有目标 fragment/prompt anchor 能区分。
- 真实模型时延和 token 包含 CLI、Team Pack skills 与生成成本，不能直接归因于 Project Context。

## 引用记录

- 2026-07-21：Project Context live E2E 首次发现首轮 hydration 缺陷和 stale daemon 无 capsule 负例，并据此建立控制面四方交叉验证；合并终审进一步补齐 Agent roster/body parsing 全生命周期 timeout、manifest owner-path fail-closed 与独立 integrity checkpoint。
