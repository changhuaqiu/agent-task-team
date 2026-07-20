# GitHub Issue 驱动的自主交付

**状态**：Accepted
**日期**：2026-07-20
**关联规格**：`specs/github-issue-agent-hook/`

## 用户问题

目前 GitHub Issue 和项目内的自主交付是两套入口。维护者已经在 Issue 中写过标题、背景和验收要求，仍需回到平台重复创建项目、复制内容并手工唤醒 Agent。

## 产品决策

GitHub Issue 可以成为一次自主交付的来源，但不成为内部任务系统本身：

- GitHub Issue 表达外部需求及协作链接。
- 平台项目会话表达团队围绕该需求的协作空间。
- DeliveryRun 表达一次从目标到最终结果的持续交付承诺。
- Task Graph 表达 Agent 拆解后的任务、依赖、负责人和质量门。

维护者创建符合策略的 Issue 后，系统自动创建项目并开始交付。主流程不再要求用户复制 Issue 内容或指定下一个 Agent。

## 用户可见行为

- 项目标题保留 `#Issue编号 + Issue标题`，可以从平台定位回 GitHub。
- Issue 正文和验收清单作为规划上下文，不把 webhook、delivery ID、receipt 等内部概念暴露在主体验。
- 重复事件只显示同一个项目，不产生多个看似相同的工作区。
- 默认允许 Agent 在指定本地项目中实现，但外部 push、PR 和 merge 均关闭；仓库管理员通过部署配置明确授权后才开放。
- 需要控制触发范围时，管理员配置一个 GitHub label；普通用户只需要在 Issue 上使用该标签。
- 公开仓库不会默认让任意外部作者触发本地 Agent；默认仅接受 Owner、Member 和 Collaborator，管理员可显式扩大可信关系。

## 不采用的方案

- webhook 直接创建所有子任务：这会把需求理解和任务拆解硬编码进 transport，并绕过现有规划 Agent。
- 把 GitHub Issue 当作 Task Graph：GitHub Issue 缺少项目内的 Agent owner、依赖、证据门和执行恢复事实。
- 默认自动 push/建 PR/合并：Issue 创建者并不天然授权所有外部写动作。

## 成功标准

- 创建一次 Issue 后，正常路径不再需要第二次人工输入。
- 同一 Issue 始终映射到同一个项目和交付运行。
- Agent 的拆解、实现、评审、验证仍使用现有自主交付契约和证据门。
- 配置或授权不足时，系统给出最小、可执行的管理员错误，不产生半成品项目。
