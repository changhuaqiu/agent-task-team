# 前端与架构重构规格

> Status: active
> Date: 2026-08-16
> Branch: `codex/frontend-architecture-refactor`

## 1. 目标

把当前以群聊和浏览器 Store 为中心的工作区，重构为以“项目中的一次交付”为中心的用户体验；同时完成 WebUI
被动投影、Human Command 单入口和服务端控制面的架构收敛。

产品决策以 `docs/product/ux/2026-08-16-delivery-workspace-refactor.md` 为准，技术设计以
`docs/technical/execution/frontend-control-plane-convergence.md` 为准。

## 2. 冻结决策

1. 项目是工作目录，交付是目标、验收、范围和授权；Conversation 仅作为现有数据兼容来源，不再作为用户概念。
2. 主视图展示交付阶段、验收、当前工作和需要处理；团队聊天和运行细节下沉。
3. 右侧一级入口为任务和调试；看板、列表、关系图是同一 Task 集合的视图模式。
4. WebUI 自动消费者只更新展示投影；所有自动执行和恢复由服务端 owner 完成。
5. 建立 `DeliveryWorkspaceProjection` 和 `HumanCommandGateway` 两个深 Module；不新增第二个全局事实 Store。
6. 浏览器最终不得发出 `terminal:start`，任务 mutation 不得自动调用 `dispatchToAgent`。
7. 外部项目只作为研究参考，Implementation、视觉和文案独立完成；不得去除复制代码本应保留的许可声明。
8. 团队活动以 Invocation 回复为单位：同一次调用不裂泡，不同调用不按 Agent 合并；系统活动与 Agent 正文分面渲染。工具名称与目标始终可见，长回复正文可渐进展开，结构化证据和阻塞不随正文折叠。
9. 所有角色共用一份用户可见回复契约：聊天正文先用用户语言交付结果，最多补充三项必要证据、风险或待办；工具、命令、文件路径和控制面术语留在 Trace/调试层。角色卡只能改变语气和专业判断，不能把聊天改成内部报告。

## 3. 范围

包含：

- 首页 Shell、项目/交付导航、交付主视图、任务/调试面板和活动区的信息架构重构；
- 交付只读投影及其 selector/测试；
- Human Command Interface、Web API Adapter 和测试 Adapter；
- `taskHubStore` / `taskStore` / `daemonStore` 的责任收缩；
- Daemon executor-only 收敛所需的接口迁移和架构门禁；
- 对应产品文档、技术文档、wiki、架构图、测试和迁移记录。

不包含：

- 复制任何外部参考项目的源码、品牌或资产；
- 为追随参考项目切换框架、引入 Redis 或增加新的运行 backend；
- 在本规格中直接冻结新的 Delivery 数据表；若兼容映射不足，先补数据模型决策再迁移；
- 重做账号、角色卡、Skill 和评估领域本身。

## 4. 依赖与冲突规则

- 依赖 `specs/system-control-plane/` 的 DispatchGateway、Task Authority 与运行健康事实。
- 遵守 `docs/technical/execution/webui-passive-project-projection.md`；若发生冲突，以“浏览器不是自动化 owner”为硬约束。
- 遵守自主交付产品契约；群聊基线只在团队活动展示层继续有效，不再定义自主交付的顶层 IA。
- 与账号、角色卡、Skill、评估活动规格只通过公开 Interface 集成，不修改其领域事实。

## 5. 实施顺序

必须按 `tasks.md` 的 Phase 依赖推进。每个 Phase 先更新相应长期文档，再实现、测试和删除旧路径。不得同时保留
两个可产生同一执行事实的 owner。

## 6. 退出条件

- `checklist.md` 全部通过；
- 交付工作区的关键浏览器 E2E 通过并有截图/报告证据；
- 浏览器没有自动执行 owner，React/store 中不存在 `terminal:start` emitter；
- 任务变化只通过服务端 Command owner 触发后续工作；
- Daemon 只消费已裁决命令并报告生命周期；
- 当前事实回写 `docs/wiki/`，失效设计归档，活动规格迁入 `docs/archive/specs/`。

## 7. 风险控制

- 所有重构在独立 worktree 和命名分支进行；只显式 stage 本规格相关路径。
- Conversation -> Delivery 兼容层只能存在于投影边界，必须记录 producer、consumer 和退出条件。
- 每个 Phase 保持可构建、可测试、可人工验收；不得用长期 feature flag 保存旧 owner。
- 若当前服务端缺少某个 Human Command，先补服务端 owner 和 receipt，再删除浏览器写路径。
