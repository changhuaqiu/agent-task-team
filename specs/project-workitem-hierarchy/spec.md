# Project 工作项分层规格

> Status: active
> Date: 2026-08-31
> Branch: `codex/project-workitem-hierarchy`

## 目标

将 Project 从单一聊天房间纠正为长期工作容器，使每个 Issue、变更或改进拥有独立工作项作用域、任务树、活动和交付事实；
旧 Project 无需重建，GitHub Issue 进入已有 Project，Renderer 默认展示 Project 概览与工作项层级。

产品决策见 `docs/product/ux/2026-08-31-project-workitem-hierarchy.md`，技术设计见
`docs/technical/execution/project-workitem-scope.md`。

## 冻结契约

1. Project、WorkItem、Task、Artifact/Review 是四个不同层级；Conversation 只作为内部活动/执行 scope。
2. 新建工作必须原子创建独立 workstream 与根 Task，不能继续写入 Project workspace Conversation。
3. Project 默认页没有聊天输入器；只有工作项详情和明确的历史项目讨论能发送消息。
4. Project 活动是跨工作项只读聚合，任何活动都能追溯到工作项或明确标记为 Project 历史讨论。
5. GitHub Issue 按仓库路径复用 Project；每个 Issue 创建或复用一个 workstream 工作项。
6. 旧 Project workspace Task 投影为 legacy 工作项，用户无需重建；不得复制或丢弃历史消息、任务和证据。
7. 交付件按贡献角色分列，每个角色列内按业务类别组织；工作项详情只展示 `workId` 匹配的交付件。
8. 工作项完成与 Project 汇总继续遵守 authority、Artifact 与 Review/Gate 证据门。

## 范围

- Project 工作项读模型与兼容迁移；
- `work.create` 原子 workstream；
- GitHub Issue Project 归属；
- Project 概览、工作项列表/详情、独立活动与角色交付；
- 相关 API、store/selector、单元、集成、浏览器和桌面构建验证。

不在本规格内重新设计 Runtime、Task Authority 或 Artifact Ledger owner。

## 退出条件

- `checklist.md` 全部通过；
- 新旧项目均可进入工作项层级，两个工作项的消息和 Task Graph 作用域隔离；
- GitHub Issue 重复事件不重复创建 Project 或工作项；
- 相关测试、typecheck、生产 build 与桌面 EXE 验证通过；
- 长期产品/技术文档和 STORY 已同步。

