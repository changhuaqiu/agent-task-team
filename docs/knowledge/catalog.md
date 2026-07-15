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
