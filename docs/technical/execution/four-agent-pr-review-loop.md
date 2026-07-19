# 四 Agent PR 交付与评审技术设计

> 状态：基础闭环已实现，真实合并演练中

## 背景

现有 Task Graph 用 `implementation_evidence` 和 `delivery_evidence` 控制 `in_review`/`done`，但证据字段仍可由调用者直接提供；Task Action/Artifact 能表达 review/url，却没有 Git provider 回执模型。聊天已有 TaskActionCard seam，可扩展为交付卡，但不得把 UI metadata 变成事实源。

## 决策

引入一个深模块 `EngineeringCollaborationService`：

```ts
interface EngineeringCollaborationService {
  recordPullRequest(input: PullRequestSubmission): Promise<PullRequestReceipt>;
  recordReview(input: ReviewSubmission): Promise<ReviewReceipt>;
  recordMerge(input: MergeSubmission): Promise<MergeReceipt>;
}
```

服务依赖窄接口 `GitProviderVerifier` 读取 provider 当前事实。生产 GitHub adapter 优先使用 `gh`；测试注入内存 verifier。调用者不能提交 provider actor、state、head SHA 等权威字段，只能提交 task/URL 和本轮本地测试证据。

每次成功记录在一个数据库事务内完成：

1. 校验 task、actor、TeamPack gate authority；
2. 从 provider 读取 PR/review/merge；
3. 追加 Task Action；
4. 添加 Task Artifact；
5. 写入带结构化 `collaborationCard` metadata 的 chat message 并绑定 task/action；
6. 通过现有 task mutation/wakeup 边界推进状态；
7. 追加 proof event。

Git Collaboration Skill 暴露三个结构化入口：`collaboration_record_pr`、`collaboration_record_review`、`collaboration_record_merge`。它们直接进入同一个服务边界；Agent 不能用普通状态更新模拟 provider 回执。

生产 Agent 身份和 conversation scope 来自 daemon/Harness 的已绑定 invocation，服务把同一 `io` coordinator 注入通知边界以提交 wakeup。HTTP receipt endpoint 只供开发/E2E；生产环境默认返回 404，即使显式启用也只接受 loopback，避免请求体中的 `actorAgentId` 成为远程身份源。

真实运行时的文件入口同样必须收敛：daemon 先以用户当前 `projectPath` 的精确 `HEAD` 创建会话 worktree，再把该会话 Task Graph 首次投影到实际 worktree 的 `.ath/TASKS.md`。Agent 执行目录、prompt 中的绝对任务路径、task watcher 和 turn-completion 同步都引用这个目录。不得从陈旧本地 `main` 创建会话分支，也不得把 sibling scratch 目录写进 prompt 后要求受限 runtime 跨边界编辑。

平台工具通过 loopback-only Streamable HTTP MCP 暴露给 ACP。每次 invocation 使用随机 bearer token 和随机 MCP server name，服务端从 token 恢复可信的 conversation、agent、task 与通知上下文，只暴露该角色上下文中实际允许的工具，并在 turn 完成后撤销 token。ACP 的 session new/load 都必须携带同一 MCP server 配置，保证首次派发与恢复会话行为一致。权限处理器先从已映射的精确 `mcp.<随机 server>.<白名单工具>` 事件登记一次性 tool call id，再只对相同 call id 的 MCP 审批选择 `allow_once`；shell、文件编辑和任何其他 MCP server 仍使用全局 deny/allow-once 策略，不能因为平台注册而扩大运行时权限。

MCP HTTP handler 是平台 mutation 的唯一执行入口，daemon 收到的 namespaced `tool_use` 只进入聊天和 observability，不做第二次执行。操作额度以随机 grant key 计数，并在 token revoke 时清理，避免跨 invocation 污染或并发会话互相耗尽额度。

Git-backed task 的 `.ath/TASKS.md` 是兼容投影而非质量门写入口。文件同步若尝试把权威状态推进到 `in_review` 或 `done`，服务端记录 gate rejection、发出同步错误，并把文件状态回写为 Task Graph 当前值；PR/review/merge 状态只由结构化协作回执原子推进。

保护同时覆盖反向降级：Task Graph 一旦由当前 verified receipt 进入 `in_review` 或 `done`，旧文件里的 pending/in_progress/rejected 等状态不能覆盖它。task 与 receipt 工具从 invocation grant 接收同一个 runtime task path，并在返回前把权威 DB 状态投影到该文件，因此 completion barrier 不会读取 sibling scratch 或旧状态。

页面 hydration 只读取 Task Graph/API 权威状态，不得为历史 `workspaces/<conversation>` 目录启动第二个 watcher。协作回执事务提交后，runtime 文件投影属于 reconciliation：投影失败必须记录 proof/同步告警，但 MCP 仍返回已提交的权威成功结果，避免调用方重试形成重复 action/card。

worktree manager 把“Git repository root”和“worktree storage root”作为两个参数。repository root 从用户 `projectPath` 的 `git rev-parse --show-toplevel` 得到；storage root 位于平台 workspace，并用 repository root hash 隔离。这样任意用户仓库都在自己的 Git 上创建分支，同时不会与其他仓库的同名 conversation 冲突。

Git-backed conversation 或显式 worktree 派发在 repository root / HEAD 探测失败时必须 fail closed；不得回退到 scratch 或直接在原项目目录执行。

从旧版无 repository hash 的存储布局升级时，同一 Git repository 中可能已经存在并检出 `worktree/<conversation>`。新 manager 必须从 Git worktree registry 识别该会话：分支与新基线相等或存在祖先关系时，把已检出的 worktree 移动到新的 repository-scoped storage；旧 head 落后且工作区干净时只允许 fast-forward，已有会话提交领先时原样保留。旧 worktree 有未提交改动且需要推进基线，或历史分支与当前基线已经分叉时必须 fail closed，不能删除、覆盖用户工作，也不能用同名分支再次执行 `git worktree add -b`。

Task Graph / Harness 是任务状态推进和 Agent 派发的唯一服务端边界。Web 客户端只消费任务投影，不得根据遗留 socket 事件自行把 `pending` 改为 `in_progress`，也不得重复触发 Agent dispatch。daemon 解析出唯一 runtime task path 后把它持久化到 task；Harness 接受 owner dispatch 并推进 `pending → in_progress` 时，在通知页面前同步更新该 runtime `TASKS.md`。watcher 显式接收 conversation identity，并以 conversation + runtime path 共同隔离 watcher/debounce 生命周期，不能从目录 basename 猜测任务域。`TASKS.md` watcher 在完成兼容文件解析、质量门禁和数据库更新后，必须从 Task Graph 重新读取权威任务状态再发布 `task.sync`；原始文件中的过期状态即使被主动 invocation 或 receipt gate 拒绝，也不能通过广播回流并覆盖页面。

## 事实源

- PR/review/merge 的当前事实：Git provider；
- task 生命周期：Task Graph；
- 四角色职责和 gate owner：Team Runtime；
- 卡片展示：持久化 chat message snapshot；
- 转换审计：Task Action + Proof Log。

卡片是 provider 事实的有界快照，不是 provider 的替代事实源。重新评审或合并前必须再次查询 provider。

## 数据与动作

第一阶段复用 `task_action`、`task_artifact_ref`、`chat_message.metadata`，扩展类型：

- actions：`task.pull_request_submitted`、`task.review_recorded`、`task.pull_request_merged`；
- artifacts：`pull_request`、`review`、`merge`；
- metadata：版本化 `collaborationCard` union。

如后续需要查询多个 review、head 失效历史和 provider webhook，再引入专用 receipt table；第一阶段不能把同一事实重复存入多个可写 owner。

## 安全与一致性

- provider CLI 参数使用参数数组，不拼接 shell；
- URL 必须属于 conversation 的 `git_repo_root` remote；
- 不持久化 token、完整 diff 或评论正文，只存有界摘要和 canonical URL；
- review 必须匹配当前 PR head SHA；
- GitHub issue comment 没有原生 commit 绑定，只有评论时间不早于精确 head commit 时间时才可作为该 head 的外部证据；缺时间戳时失败关闭；
- provider review state 与平台质量决定分离：共享 provider 账号可能只能 `commented`，Peach 仍须从可信 invocation 提交 `qualityDecision=pass|reject|comment`；仅 `comment` 不能授权合并；
- 一个 task 首次产生已验证 PR receipt 后，后续回执形成连续交付链：`in_review` / `rejected` 状态只能沿用同一 canonical PR，并且必须出现新的 head SHA；换 PR 以 `pull_request_changed` 失败关闭，原样重报同一 SHA 以 `pull_request_head_unchanged` 失败关闭；
- 回执连续性校验位于 `EngineeringCollaborationService` 的 provider 查询之后、事务写入之前；失败不得新增 Task Action、Artifact、Card 或 Proof，也不得改变任务状态；
- 同一 PR 出现新 head SHA 时可再次记录交付；系统追加 stale 评审投影并保持 `in_review`，旧结论不能用于合并；
- 合并闭环要求当前 head 的 provider-backed review、零 blocker、provider merged receipt 和完整 main 复验证据；
- Git-backed task 的普通 `task_update_status(done)` 还必须找到 `task.pull_request_merged` action，否则即使字符串证据齐全也拒绝；
- draft PR 允许进入评审；checks=`failing` 拒绝，`pending`/`unknown` 保留在卡片上交由质量门禁判断（兼容未配置 CI 的仓库）；
- provider 不可达时失败关闭，不接受调用者自报字段。

## 测试策略

- 纯服务测试：actor authority、repo mismatch、head stale、reject/approve、REJECT 后同 PR 新 head、换 PR、同 SHA 重报和事务回滚；
- API/tool 集成：真实 task/action/artifact/message/proof 一致；
- Harness reconciliation：覆盖 task 不存在的 stale wakeup no-op、runtime path 缺失、任务条目缺失与文件 I/O 异常，并断言权威状态、单一 proof、稳定 failureCause 和 `task.sync_error`；持久化异常文本移除换行并限制为 512 字符；
- ACP hardening：测试使用直接 Node/tsx launcher，并在断言成功或失败时都回收首个运行，避免 launcher 子进程占用临时目录；
- React：三类卡片与 stale/error；
- Playwright：浏览器中提交 receipt、卡片跳转与状态变化；
- 真实演练：测试仓库 PR + GitHub review/comment，并核对 exact task/PR/SHA。
