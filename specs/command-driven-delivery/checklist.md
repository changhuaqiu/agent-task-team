# 命令驱动的交付内核验收清单

## 架构

- [ ] 只有 CommandService 可以改变项目交付事实。
- [ ] 所有 Agent Invocation 在 WorkContract 签发前经过同一 DispatchAdmission；无 Task 的协调请求不能默认进入 implement。
- [ ] WorkContract 冻结 Agent Definition 职责、revision 与能力，规划型 Agent 的代码修改授权为 false。
- [x] 结构化 MCP 是 Agent 主路径，CLI 是通用接口与逃生仓，两者共用 handler。
- [ ] Runtime observation 与 domain fact 在类型、存储和投影上分离。
- [ ] `runtime.completed` 不会完成 Task、Delivery 或 Release。

## 正确性

- [ ] 每个写命令都返回 applied/duplicate/rejected/conflict/delivery_unknown 之一。
- [ ] UI、MCP 与 CLI 对 `work.create`、`review.create` 使用同一 registry handler 和等价回执。
- [ ] UI 与 CLI 对 `agent.create` / `agent.update` 使用同一 CommandService handler；更新有 revision conflict，失败保留草稿。
- [ ] Review 是独立持久对象，Task `in_review` 只作为投影/等待状态，不能替代 Review identity。
- [ ] canonical ObjectReference 可在消息、对象列表和详情之间稳定往返，非法或跨 Project 引用 fail closed。
- [ ] 幂等、revision、authority epoch、attempt 和 fencing 在写入前校验。
- [x] 终态 outcome 最多接纳一次；文本和进程退出不能替代 outcome。
- [x] ACP runtime 的 canonical 与 server-namespaced lifecycle tool 只有在结构化 receipt 被接纳后才满足终态出口。
- [ ] Task 完成需要当前 artifact revision 的质量回执。
- [x] Task 进入 `in_review` 后可由 durable replay 幂等得到当前 artifact revision 的唯一 code-review Gate 与 reviewer 工作。
- [x] 评审期间 Task revision 变化会取消旧 Gate/reviewer authority；未授权、自评或 stale artifact 的 Gate outcome 在占用终态槽前被拒绝。
- [x] 成功写工具自动形成 working Artifact；Outcome evidence 将同一 ref 提升为 registered，失败/读取/越界工具不进入 Ledger。
- [ ] 外部非幂等写结果不明时不会盲目重试。

## 产品体验

- [x] 用户无需先创建“交付”即可进入 Project、查看工作事实并立即与 Agent 协作。
- [x] 活动状态与 Work/Review 命令事实已用折叠活动和正式事实卡区分；Artifact/Release 事实卡随对应命令接入继续扩展。
- [x] Workspace 镜头和 Project 对象详情使用同一 Project/WorkItem/Artifact/Review 投影。
- [x] 主界面不暴露 runtime、channel、fencing、bridge、Worker 等实现术语；诊断详情只使用次级连接说明。
- [x] Agent 继承本机默认运行配置时不显示“未绑定账号”，创建与协作入口使用一致的默认配置心智。
- [x] Agent 创建默认只显示身份与职责；Harness/模型按选择展开，高级配置可折叠，存在未保存改动时不能静默关闭。
- [x] Agent 显式并行度与实例名称池进入真实 ACP worker pool；Profile 的 Runtime/Instances 只显示 observed state。
- [x] Settings 只提供模型账号、运行环境和共享 Skills；Agent 创建/资料/项目成员面板不存在角色素材，Team 只引用真实 Agent Definition。
- [x] 生产路由中不存在 RoleCard 导入、Team 成员能力覆盖或 Agent Skill 独立写端点；Team create/update/delete/deploy 统一产出 receipt/event，Runtime Profile 与在线 Evaluation 也不再暴露 RoleCard。
- [x] “添加项目”先浏览和搜索已有 Project，创建表单继承搜索词与当前作用域。
- [x] Project、Work、Review、Agent、Skill Import、Automation 与 Release 创建器进入同一命令协议；失败保留输入，成功后刷新权威对象。
- [x] Automation 创建后默认关闭；启用/更新带 revision，运行历史来自持久 AutomationRun，不由页面制造。
- [x] 同一 Automation/source event 或 schedule window 只产生一个 Run；自身事件不匹配用户 Trigger；重启可恢复 pending Run。
- [x] Automation 幂等键绑定完整命令信封；Run 冻结定义 revision 与动作；延迟事件按事件时刻选择有效定义版本，普通编辑不丢事件。
- [x] 运行记录可展开逐步状态、时间、输出与错误；永久失败可重试同一 Run，AgentInbox 容量等临时失败由 durable dispatcher 重放，attempt 耗尽会落为可见失败而非永久 running。
- [x] 自动化通知进入 Project 协作流；Agent action 进入既有 AgentInbox，不在事件 handler 内直接启动 Runtime。
- [x] Automation 只能调用注册的 Product Command；同一 Run/step 重放得到同一 CommandReceipt，不直接修改 Work/Review/Artifact/Gate/Release 表。
- [x] 人工决定在数据库中保持 pending/approved/denied，批准从下一 step 恢复、拒绝取消 Run；页面可真正操作且重启不丢失。
- [x] Automation Definition 可复制/导入，导入先校验并默认关闭，不能导入 Project identity、revision、Run、Decision 或凭据。
- [x] Release 创建只冻结当前 Project 的正式 Work/Review；发布时重新验证 Work done 与 Review approved/closed，并用 revision 防止覆盖。
- [x] 回复关系持久化为 `replyToMessageId/threadRootId`，不再从引用文本推断；Inbox 按同一 Thread root 聚合。
- [x] Work 的依赖与产物投影遇到非数组旧值时 fail-soft，Project 对象页不会因单条异常数据整体崩溃。
- [x] Project“产物”页与 Agent briefing 读取同一 Artifact Ledger，不再读取 Task 旧 artifacts JSON 或展示工具日志。

## 验证

- [x] MCP/CLI receipt 等价测试通过。
- [ ] 端到端任务提交、评审、修改、通过与发布流程通过。
- [ ] 真实桌面流程完成“创建 WorkItem → 创建独立 Review → 打开 Review → 记录决定”，并逐项点击验证。
- [x] Runtime 无 outcome、transport failure、Worker replacement、session load 与 retry/fencing 定向流程通过。
- [x] Human/A2A/Workflow/Gate 在 WorkContract 前共用 `DispatchAdmission`；Agent Definition revision 和能力已冻结进合同。
- [x] “未分配 Work + @Mario 开始处理”真实服务链只生成 planning grant，且 Claude ACP planning turn 强制使用无工具执行的 `plan` Session Mode。
- [x] `work_handoff` 暴露显式 branches Schema，Agent 只提交一个公共幂等键；ACP Adapter 产生 A2A canonical payload，合法分派不再因重复身份字段缺失被拒绝。
- [x] TypeScript、Vitest、build 和真实桌面/Web 页面验证通过。
