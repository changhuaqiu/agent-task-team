# GitHub Issue Agent Hook

**状态**：active
**日期**：2026-07-20
**依赖**：`specs/autonomous-delivery-loop/`、`specs/system-control-plane/`

## 1. 目标

为当前项目增加一个 GitHub Issue 驱动的 Agent 自动入口：

```text
GitHub issues.opened
  -> 验签与仓库/标签策略
  -> 幂等创建项目会话
  -> 编译 GoalContract
  -> 创建 DeliveryRun
  -> 现有 plan_goal / Task Graph 拆解
  -> 派发、评审、验证与交付
```

GitHub Issue 是外部需求来源，不直接拥有内部任务状态。`Conversation`、`DeliveryRun` 和 Task Graph 继续分别拥有项目协作、交付运行和任务事实。

## 2. 用户场景

仓库维护者在 GitHub 创建 Issue 后，不需要再回到平台复制标题、描述或手工提醒规划 Agent。系统验证事件后自动建立一次项目交付，并让当前团队按既有自主交付流程拆解和推进。

成功标准：

- 合法的 `issues.opened` 在一次请求内得到可追踪的 `conversationId` 和 `deliveryRunId`。
- GitHub 重试同一 delivery，或重复发送同一仓库 Issue，不会创建第二个项目、Run 或根任务。
- Issue 正文和验收清单进入规划上下文，规划 Agent 基于它创建 Task Graph。
- 非法签名、错误仓库、错误标签和不支持的事件不会触发 Agent。
- 默认授权允许在指定项目目录内改代码，但不允许 push、创建 PR 或自动合并；维护者必须通过环境变量显式扩大授权。

## 3. 范围

### P0 包含

- Pages Router webhook 端点：`POST /api/integrations/github/issues`
- `ping` 和 `issues.opened` 事件
- GitHub `X-Hub-Signature-256` HMAC-SHA256 原始请求体验签
- 请求体大小限制、事件头和 delivery ID 校验
- 精确仓库白名单与可选触发标签
- Issue 正文和 Markdown checklist 到 `GoalContract` 的确定性编译
- GitHub Issue、Conversation、DeliveryRun 的持久映射和双重幂等
- 复用 `AutonomousDeliverySupervisor.start/advance`
- `gh` CLI webhook 安装脚本
- 单元测试、端点测试、迁移测试和设计文档

### P0 不包含

- GitHub App 安装流程、OAuth 或多租户凭据中心
- Issue 编辑后自动重规划
- Issue 关闭后自动取消 Run
- 从 Agent 执行结果自动关闭 Issue或回写评论
- 任意仓库自动克隆或动态选择本地目录
- 绕过现有 Task Graph 直接由 webhook 创建子任务

## 4. 配置契约

必填：

- `GITHUB_ISSUE_WEBHOOK_SECRET`：GitHub webhook secret
- `GITHUB_ISSUE_WEBHOOK_REPOSITORY`：精确的 `owner/repo`
- `GITHUB_ISSUE_WEBHOOK_PROJECT_PATH`：已存在的本地绝对项目目录

可选：

- `GITHUB_ISSUE_WEBHOOK_TEAM_PACK_ID`
- `GITHUB_ISSUE_WEBHOOK_TRIGGER_LABEL`：设置后，只有包含该标签的 Issue 才触发
- `GITHUB_ISSUE_WEBHOOK_SKIP_LABEL`：默认 `agent:skip`
- `GITHUB_ISSUE_TRUSTED_ASSOCIATIONS`：默认 `OWNER,MEMBER,COLLABORATOR`
- `GITHUB_ISSUE_ALLOW_PUSH`：默认 `false`
- `GITHUB_ISSUE_ALLOW_PULL_REQUEST`：默认 `false`
- `GITHUB_ISSUE_ALLOW_AUTO_MERGE`：默认 `false`
- `GITHUB_ISSUE_REQUIRE_REVIEW`：默认 `true`
- `GITHUB_ISSUE_REQUIRE_WEB_E2E`：默认 `false`
- `GITHUB_ISSUE_REQUIRE_MERGE`：默认 `false`
- `GITHUB_ISSUE_MAX_ATTEMPTS`：默认 `3`
- `GITHUB_ISSUE_MAX_REPAIR_CYCLES`：默认 `2`
- `GITHUB_ISSUE_STALL_TIMEOUT_MS`：默认 `900000`

无必填配置、项目目录不存在、目录不是绝对路径、自动合并未同时允许 push/PR 或要求 merge 但未允许自动合并时，端点返回可解释的配置错误，不创建任何业务对象。

## 5. 事件契约

支持的事件：

- `ping`：验签后返回健康响应，不创建业务对象。
- `issues` 且 `action=opened`：进入触发策略。

忽略并返回 `200`：

- 其他事件或 Issue action
- 仓库不匹配
- 缺少所需触发标签
- 含跳过标签
- Issue 作者与仓库的关系不在可信列表
- Issue 状态不是 `open`

拒绝：

- 缺少/错误签名：`401`
- 缺少事件头、delivery ID 或 payload 结构错误：`400`
- Supervisor/Socket 运行时未就绪：`503`

成功创建返回 `202`；重复 delivery 或重复 Issue 返回 `200`，并返回原有映射。

## 6. GoalContract 编译

- `goal`：`解决 GitHub Issue #<number>：<title>`
- `source`：保存仓库、Issue number/node ID、URL、标题、正文、标签和发起者等来源事实
- `acceptanceCriteria`：
  1. 优先提取正文中的未完成 Markdown checklist；
  2. 没有 checklist 时生成一条确定性标准：完成并验证 Issue 描述的预期结果；
  3. 始终追加“保留与 Issue 对应的实现和验证证据”。
- `scope.repository`：精确 `owner/repo`
- `scope.projectPath`：配置的本地目录
- `scope.conversationId`：幂等创建的项目会话

`plan_goal` 必须把来源链接和 Issue 正文放入根任务描述。任务拆解仍由现有 Coordinator/Planner Agent 通过 Task Graph 完成。

## 7. 持久化与幂等

新增 `github_issue_ingress`：

- `id`
- `delivery_id UNIQUE`
- `repository_full_name`
- `issue_number`
- `issue_node_id`
- `issue_url`
- `action`
- `payload_digest`
- `conversation_id`
- `delivery_run_id`
- `status`
- `received_at`
- `processed_at`

并设置 `UNIQUE(repository_full_name, issue_number)`。

创建映射、Conversation 和 DeliveryRun 必须在同一 SQLite 事务中完成。事务失败时不得留下半成品。`advance()` 在事务提交后异步触发，由 GitHub retry 和现有周期 reconcile 兜底。

## 8. 安全约束

- Next.js body parser 必须关闭；只能对原始字节验签后解析 JSON。
- 使用 `timingSafeEqual` 比较 `sha256=<hex>`，不得记录 secret、签名或完整原始 payload。
- 请求体最大 1 MiB；超限返回 `413`。
- 本地项目路径必须是已存在的绝对目录。
- 仓库使用大小写不敏感的精确匹配，不支持通配符。
- 默认只接受仓库 Owner、Member 和 Collaborator 创建的 Issue；公开仓库若要允许其他作者，必须显式扩大 `GITHUB_ISSUE_TRUSTED_ASSOCIATIONS`。
- webhook 接收不需要 GitHub token；安装脚本只通过已认证的 `gh` CLI 注册 hook，不把 secret 写入命令行、日志或仓库。
- 默认不授权外部 Git 写动作；所有授权由配置显式扩大。

## 9. 退出条件

- 规格、长期产品/技术文档和代码一致。
- 迁移可重复执行，唯一约束可阻止重复入口。
- 编译、验签、策略、事务幂等和 API 路由均有测试。
- 针对性测试、类型检查与构建通过，或交付中明确记录非本改动导致的阻塞。
