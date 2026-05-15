# 知识治理规范

本规范定义项目知识如何进入、组织、验证、引用和淘汰。目标是把迭代中产生的判断、经验和约束沉淀为可复用资产，而不是把聊天记录或临时总结堆进仓库。

参考来源：

- 用户提供的文章：`https://zhuanlan.zhihu.com/p/2032094280060252204`

## 1. 知识分层

项目知识按作用范围分为五层：

| 层级 | 说明 | 默认落位 |
| --- | --- | --- |
| `personal` | 单个用户或协作者偏好，只在明确适用时使用 | 不默认进入仓库；必要时进入 `docs/knowledge/` 并标注范围 |
| `team` | 项目团队协作规则、评审规则、交付规则 | `AGENTS.md`、`docs/standards/`、`docs/knowledge/` |
| `project` | 本项目的业务对象、系统事实、架构边界、运行方式 | `docs/wiki/`、`docs/technical/`、`docs/product/`、`specs/` |
| `domain` | 可跨项目复用的业务或产品方法 | `docs/knowledge/` |
| `technical` | 可跨项目复用的工程经验、排障经验、技术原则 | `docs/knowledge/`、`docs/technical/` |

判断落位时优先选择最小有效范围。不要把一次性上下文升级成全局规则。

## 2. 知识类型

沉淀知识必须标注类型：

| 类型 | 用途 |
| --- | --- |
| `model` | 对象模型、心智模型、系统模型或业务模型 |
| `decision` | 已做出的架构、产品或流程决策 |
| `guideline` | 后续执行必须遵守的规则或建议 |
| `pitfall` | 已踩坑或高风险反模式 |
| `process` | 可重复执行的流程、检查清单或工作法 |
| `evidence` | 支撑其他知识的事实、实验结果或案例 |

同一条知识可以有主类型和辅助标签，但必须只有一个主类型。

## 3. 成熟度

知识不默认等于真理，必须标注成熟度：

| 成熟度 | 含义 | 使用方式 |
| --- | --- | --- |
| `draft` | 来自单次观察、讨论或初步判断 | 可参考，不可作为强制门禁 |
| `verified` | 已有代码、测试、文档、用户反馈或多次案例支撑 | 可作为默认执行依据 |
| `proven` | 已长期复用，且有稳定正反馈或防止过事故 | 可升级为规范、门禁或模板 |
| `deprecated` | 已被替代或不再适用 | 只保留历史参考，不再指导新工作 |

成熟度只能基于证据提升，不能因为写入文档而自动提升。

## 4. 知识条目必填字段

每个结构化知识条目必须包含：

- `id`：稳定 ID，不复用。
- `title`：一句话标题。
- `type`：主类型，取值见第 2 节。
- `layer`：作用层级，取值见第 1 节。
- `maturity`：成熟度，取值见第 3 节。
- `tags`：便于检索的标签。
- `applicable_phases`：适用阶段，例如 `planning`、`implementation`、`review`、`handoff`、`debugging`、`iteration-close`。
- `summary`：可独立理解的结论。
- `evidence`：至少一个来源锚点；如果没有证据，只能保持 `draft`。
- `owner_doc`：权威文档位置。
- `created_at` / `updated_at`：日期。
- `status`：`active`、`superseded`、`archived`。

推荐模板见 `docs/knowledge/templates/knowledge-entry.md`。

## 5. 引用和消费规则

Agent 使用知识时必须遵守：

- 先读 `docs/knowledge/catalog.md`，再按标签或领域打开具体条目。
- 不把整个知识库一次性塞进上下文。
- 对 `draft` 知识保持怀疑，不把它当作强制规范。
- 遇到知识冲突时，优先级为：用户当前指令 > `AGENTS.md` > `docs/standards/` > 相关 `specs/` > `docs/wiki/` / `docs/technical/` / `docs/product/` > `docs/knowledge/`。
- 如果某条知识被本轮工作实际使用，最终交付应简要说明引用了哪个文档。

## 6. 入库门禁

一条知识进入 `docs/knowledge/` 前必须满足：

- 能复用：不是只对当前对话有意义。
- 有边界：说明适用范围和不适用范围。
- 有证据：至少有一个文档、代码、测试、事故、用户反馈或外部参考来源。
- 可执行：能指导下一次分析、设计、实现或验证。
- 不重复：与已有知识不重复；如重复，应更新原条目。

## 7. 知识 Lint 规则

后续可脚本化检查以下问题：

- 缺必填字段。
- `verified` / `proven` 没有证据。
- `deprecated` 条目仍被规范引用。
- 同一主题存在多个 owner doc。
- 知识条目没有被 `docs/knowledge/catalog.md` 收录。
- 条目声称当前实现事实，但未链接到 `docs/wiki/`、`docs/technical/`、`specs/` 或代码证据。

在脚本落地前，人工评审也必须按这些规则检查。

## 8. 升级和淘汰

- `draft -> verified`：需要至少一个可追溯证据或一次成功复用。
- `verified -> proven`：需要跨迭代稳定复用，或已经进入规范/模板/测试门禁。
- `active -> superseded`：新条目或新决策替代旧条目时使用，必须写明替代者。
- `superseded -> archived`：旧条目只剩历史价值时归档。

知识淘汰不是删除记忆，而是停止让过时知识继续指导新工作。
