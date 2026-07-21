# GitHub Issue Agent Hook 技术设计

**状态**：Accepted
**日期**：2026-07-20
**关联规格**：`specs/github-issue-agent-hook/`

## 决策

在 GitHub webhook transport 与现有自主交付模块之间新增一个深模块 `GitHubIssueAgentIngress`。它的外部 interface 只接收已经验签并解析的事件以及部署配置，返回 `accepted | duplicate | ignored` 和稳定映射；事务、幂等、Conversation 创建和 GoalContract 编译隐藏在实现中。

```text
GitHub
  -> POST /api/integrations/github/issues
     -> raw body reader
     -> HMAC verifier
     -> GitHubIssueAgentIngress.handle()
        -> trigger policy
        -> lazy shared Socket.IO / daemon / Harness initialization
        -> GoalContract compiler
        -> github_issue_ingress + Conversation + DeliveryRun (one transaction)
     -> Supervisor.advance() after commit
        -> plan_goal
        -> Task Graph
        -> Harness / Review / Verification / Delivery
```

## Seam 与职责

### Webhook adapter

负责：

- 读取最大 1 MiB 原始请求体
- HMAC-SHA256 验签
- 读取 GitHub event/delivery headers
- JSON 解析与 HTTP 状态映射
- 获取共享 Socket.IO/Supervisor

不负责：

- 创建 Conversation、Task 或 DeliveryRun
- 解释 Issue 是否应该触发
- 拆解任务
- 推导授权

### GitHubIssueAgentIngress

负责：

- 校验 GitHub Issue payload 的最小结构
- 精确仓库 allowlist、action、状态和 label 策略
- 编译带来源事实的 GoalContract
- 在一个 SQLite 事务中 claim ingress、创建 Conversation、启动 DeliveryRun 并回写映射
- 对 delivery ID 和 repository/issue identity 幂等

### AutonomousDeliverySupervisor

职责不变：

- 从 GoalContract 创建 DeliveryRun
- 通过 `plan_goal` 创建根任务
- 触发 Coordinator/Planner 拆解 Task Graph
- 推进派发、评审、验证、恢复和最终交付

### 共享运行时初始化

`ensureProjectSocketRuntime()` 是 `/api/socketio`、`/api/daemon/init` 和 GitHub webhook 的唯一 Socket.IO/daemon 初始化入口。webhook 先完成验签、事件策略和重复映射查询，只有新的合法 Issue 才惰性初始化运行时。这样服务器重启后的第一条请求可以直接来自 GitHub，不依赖浏览器预先访问页面；ignored 和 duplicate 事件不会无意义启动执行平面。

## 为什么 seam 放在这里

GitHub 是 true external dependency，transport 和 payload 会变化；自主交付是项目内部稳定能力。把 seam 放在“可信外部 Issue -> GoalContract”之间，可以让 route 保持浅薄，让所有业务不变量集中在一个模块，并通过 fake Supervisor 与内存 SQLite 从同一 interface 测试。

删除该模块后，仓库策略、幂等、事务和编译逻辑会重新散落到 route、Conversation repository 和 Supervisor 调用方，因此该模块具有实际深度和维护 locality。

## 数据模型

`github_issue_ingress` 是外部来源映射事实，不复用 `autonomous_delivery_receipt`：

- Receipt 证明某个 Run 内部动作发生过。
- Ingress 证明哪个外部 Issue 创建了哪个 Conversation/Run，并在 Run 创建前就需要幂等 claim。

唯一约束：

- `delivery_id`
- `(repository_full_name, issue_number)`

仓库名在写入 ingress 前统一转为小写，使数据库唯一约束与大小写不敏感的仓库 allowlist/查询语义一致。

外键：

- `conversation_id -> conversation(id) ON DELETE CASCADE`
- `delivery_run_id -> autonomous_delivery_run(id) ON DELETE CASCADE`

## GoalContract 来源扩展

`GoalContract.source` 是可选来源事实：

```ts
type GoalSource = {
  kind: 'github_issue';
  externalId: string;
  url: string;
  title: string;
  description: string;
  repository: string;
  issueNumber: number;
  labels: string[];
  sender: string;
};
```

手工 UI 创建的旧合同不需要该字段，保持兼容。`plan_goal` 在字段存在时把来源链接、正文和标签写入根任务描述，让 Planner 获得完整需求上下文。

## 配置与部署

运行时通过 `GITHUB_ISSUE_WEBHOOK_*` 环境变量配置 secret、唯一仓库、本地项目路径、Team Pack、标签策略、可信 author association 和授权。`GITHUB_ISSUE_TRUSTED_ASSOCIATIONS` 默认是 `OWNER,MEMBER,COLLABORATOR`。

注册 webhook：

```powershell
$env:GITHUB_ISSUE_WEBHOOK_URL='https://example.com/api/integrations/github/issues'
$env:GITHUB_ISSUE_WEBHOOK_SECRET='<same-secret-as-server>'
node scripts/install-github-issue-hook.mjs
```

自动化部署也可以设置 `GITHUB_ISSUE_WEBHOOK_SECRET_FILE`，让安装器从权限受限且
只包含 secret 的文件读取；该方式优先于直接环境变量，避免 secret 进入 shell
历史。两种方式都只通过 `gh api --input -` 的 stdin 传递 secret。

脚本从当前 git remote 推导 `owner/repo`，先用 `gh auth status` 验证认证，再分页读取全部现有 hook；相同 URL 存在时更新，否则创建只订阅 `issues` 的 active webhook。secret 通过子进程 stdin 传入 JSON，不出现在 argv。

服务必须拥有 GitHub 可访问的 HTTPS URL。安装脚本不负责部署、反向代理、隧道或证书。

### 持久 Linux 主机部署剖面

当接收端部署在没有域名的持久 Linux 主机时，采用以下运行拓扑：

- Nginx 只把精确路径 `/api/integrations/github/issues` 反向代理到监听
  `127.0.0.1` 的 Next.js 服务，不公开 Socket.IO、管理 API 或项目 UI。
- 使用受信任的短期 IP 地址证书提供 HTTPS，并通过 systemd timer 自动续期和
  reload Nginx；不关闭 GitHub 的 SSL verification。
- Next.js 服务由独立的非登录系统用户和 systemd 托管；应用源码、Agent 工作仓库
  和 `ATH_DATA_DIR` 分离，SQLite、account metadata 与 credential 文件持久化，
  credential 文件权限为 `0600`。
- `ATH_WORKSPACES_ROOT` 必须显式指向可写的持久目录，不能回落到只读发布目录；
  即使执行 cwd 来自 Git worktree，session/GC 元数据仍写入该 workspace root。
- 如果主机已有受保护的 localhost OpenAI-compatible 模型网关，则通过现有
  OpenCode custom provider 配置接入。网关 key 只在主机本地写入
  `ATH_DATA_DIR/credentials.json`，不进入 Git、进程参数、Nginx 日志或部署产物。
- Webhook Conversation 必须绑定一个已配置 account 的 Team Pack；否则
  `plan_goal` 虽能创建根任务，但 Harness 无法形成可执行 runtime profile。
- GitHub Hook secret 在部署时随机生成，只写入权限为 `0600` 的 systemd
  EnvironmentFile，并通过 GitHub API 的 stdin body 注册，不出现在命令参数或日志。

这个部署剖面保持 GitHub transport、GoalContract 编译、自主交付和模型提供方之间
的既有 seam：公网只增加一个窄 Webhook 入口，模型网关仍是 localhost 依赖，
不为部署方便绕过 Harness 或 Supervisor。

### 无人值守 OpenCode 权限

Webhook 触发的 Agent 运行在 Git worktree 中，但共享任务看板和团队日志位于
`ATH_WORKSPACES_ROOT/<conversation-id>/`。OpenCode 会把该目录判断为 execution cwd
之外的 external directory；无人值守 ACP 运行无法处理交互式权限询问。

运行时生成的 OpenCode 配置必须只对当前 Conversation 的共享 workspace 添加
`external_directory` allow 规则。项目 worktree 内的工具继续使用 OpenCode 默认权限，
`.env` 等默认拒绝规则保持不变，也不允许用全局 auto-approve 代替精确目录授权。
这样 Planner 可以读取并更新绝对 `TASKS.md` 路径，同时不会获得其他 Conversation
或主机目录的额外访问权。

## 错误与可观察性

HTTP 响应使用稳定 reason code：

- `signature_missing`
- `signature_invalid`
- `payload_too_large`
- `event_headers_missing`
- `payload_invalid`
- `configuration_invalid`
- `runtime_unavailable`

忽略结果包含不敏感的 reason：

- `event_unsupported`
- `action_unsupported`
- `repository_not_allowed`
- `trigger_label_missing`
- `skip_label_present`
- `author_not_trusted`
- `issue_not_open`

日志只记录 delivery ID、仓库、Issue number、映射 ID 和 reason code，不记录 secret、签名或完整正文。

## 替代方案与后果

- 使用 GitHub Actions 直接调用内部 Task API：会绕过 GoalContract/Supervisor，并要求暴露更多内部 interface。
- 轮询 GitHub Issues：延迟高、需要 GitHub token、浪费 API quota；P0 采用 webhook。
- 直接复用 DeliveryReceipt：无法在 Run 创建前建立外部幂等，也混淆 ingress provenance 与 run action evidence。

未来扩展 Issue edited/closed、评论回写或多仓库 GitHub App 时，应复用该 ingress interface，增加明确事件策略和 adapter，不把分支判断堆回 API route。
