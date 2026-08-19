# 前端与架构重构任务

> Status: active

## Phase 0：审计与契约

- [x] 检查外部参考的真实源码、架构文档、许可证和商标边界。
- [x] 盘点当前首页 IA、Store 消费者、任务写入、派发与 Daemon 调用链。
- [x] 更新产品 UX 决策和技术架构设计。
- [x] 建立活动规格、任务和验收清单。
- [x] 为现状关键流程补充基线截图和浏览器行为记录。

## Phase 1：交付工作区投影与 IA

- [x] 阅读本仓库 Next.js 版本对应的 App Router、Layout、Client Component 和状态保留指南。
- [x] 定义 `DeliveryWorkspaceView` 和纯 `DeliveryWorkspaceProjection`。
- [x] 为项目隔离、空态、当前工作、需要处理和活动摘要补投影测试；验收项随 Delivery snapshot 接入补齐。
- [x] 把侧栏重构为 Project -> Delivery，并统一用户文案。
- [x] 把自主交付摘要提升为中心主视图，团队消息下沉为活动区。
- [x] 把右面板从 5 个一级 tab 收敛为任务与调试，任务内部提供看板/列表/关系图模式。
- [x] 保证草稿、选中工作项和面板状态在水合与切换时符合产品契约。
- [x] 删除未选交付时隐式创建/选择 Conversation 的活动提交回退，并覆盖项目隔离测试。
- [x] 将用户关注收敛到 manual blocker 与 `waiting_human`，并阻止关系图迟到响应跨交付覆盖。
- [x] 让交付摘要按 Task 权威状态校正滞后的运行阶段，并将 `in_review` 计入当前工作。
- [x] 删除按连续 Agent 合并并折叠历史的活动分组，改为跨并行事件稳定聚合同一 Invocation。
- [x] 将 Task 通知、自动唤醒和系统控制变化改为独立活动提示；保持工具 Trace 摘要可见、过程说明默认折叠、最终结论直接展示。
- [x] 将已完成 Trace 的最近工具名称和目标直接投影到收起态，并把超长 Agent 正文改为原位渐进展开；工具、任务和证据卡不随正文隐藏。
- [x] 将全角色用户可见回复收敛为“结果先说、必要说明不超过三项、技术细节进入 Trace”，并消除预设角色卡中与该契约冲突的表达。
- [x] 让流式气泡与运行状态按 Invocation 收尾和恢复；活动时保留最新聚合正文、空泡用持久化正文兜底，终态后展示完整持久化正文；迟到的上一轮正文、工具、完成、警告、空闲和退出事件不得夺回或关闭下一轮回复。
- [x] 完成组件测试与浏览器 E2E。

## Phase 2：Human Command 单入口

- [x] 将无显式 mention 的默认入口成员选择迁到服务端 Team Runtime；无初始角色时使用已校验 roster，无成员时返回可见冲突。
- [x] 定义 Command、CommandReceipt、幂等键和失败语义。
- [x] 实现 Web API Adapter 与内存测试 Adapter。
- [x] 迁移交付补充要求到 `HumanCommandGateway`，删除浏览器 `message.append -> a2a.human_handoff` 双调用。
- [ ] 迁移任务动作到 `HumanCommandGateway`。
- [ ] 迁移交付操作到 `HumanCommandGateway`。
- [x] 将 optimistic Task domain write 改为 pending command + 带 revision 的服务端权威投影确认。
- [x] 删除 `taskStore` 中任务变化后自动调用 `dispatchToAgent` 的路径。
- [x] 添加展示事件不得调用 Command Interface 的静态架构测试。

## Phase 3：浏览器退出派发控制

- [x] 让所有用户派发通过服务端 Command owner、Agent Inbox 和 DispatchGateway。
- [x] 删除浏览器运行配置选择、busy queue、强制派发和自动重试 owner。
- [x] 删除 React/store 的 `terminal:start` emitter 和相关兼容类型。
- [ ] 收缩 `taskHubStore` 为展示投影、水合、订阅和少量跨路由 UI 状态。
- [ ] 验证浏览器断线、多标签页和重连不会改变自动执行结果。

## Phase 4：Daemon executor-only 与收尾

- [x] 提取并验证 Daemon ExecutionAdapter 的最小 Interface。
- [x] 删除 Daemon transport 中重复的业务 policy、任务推进和恢复判断；恢复与 closure policy 迁入服务端 owner。
- [x] 完成本地 daemon 的 directed admission、原子进程占位与 no-ACK/unreachable 测试；非本地执行明确 fail closed。
- [x] 更新当前架构图、`docs/wiki/02-frontend.md`、`docs/wiki/04-backend-daemon.md`。
- [x] 删除失效 UI、事件、类型、测试和文档；不保留无退出条件的兼容层。
- [x] 执行 typecheck、相关测试、全量测试、build 和浏览器回归。
- [x] 按迭代知识规范完成当前事实沉淀并更新 STORY（仅记录已验证效果）；因仍有显式后续项，规格保持 active，不提前归档。
