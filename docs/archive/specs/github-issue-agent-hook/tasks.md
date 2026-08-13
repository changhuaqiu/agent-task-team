# Tasks

- [x] 冻结 GitHub Issue 触发、配置、安全、幂等和 GoalContract 编译契约。
- [x] 增加 `github_issue_ingress` schema、迁移和 repository。
- [x] 实现 webhook 原始请求体验签和 payload 校验。
- [x] 实现 Issue -> GoalContract 编译与触发策略。
- [x] 实现事务化 GitHub Issue Agent 入口模块。
- [x] 实现 `/api/integrations/github/issues`。
- [x] 让自主交付根任务包含 GitHub Issue 来源上下文。
- [x] 增加 `gh` CLI webhook 安装脚本。
- [x] 增加单元、API 和迁移测试。
- [x] 收敛 Socket.IO/daemon 共享初始化，保证 webhook 冷启动不依赖 UI。
- [x] 运行类型检查、针对性测试和构建。
- [x] 完成独立代码评审并修复 Important/Minor 问题。
- [x] 部署公网 HTTPS 端点并运行远程 hook 安装器。

## 验证证据

- `pnpm exec vitest run ...`：14 个受影响测试文件、70 项通过；包含 API 层缺失签名 `401`、超限请求体 `413` 和数据库双重唯一约束验证。
- `pnpm exec tsc --noEmit`：通过。
- 受影响文件 ESLint：通过。
- `pnpm build`：通过，构建产物包含 `/api/integrations/github/issues`。
- `node --check scripts/install-github-issue-hook.mjs`：通过。
- `git diff --check`：通过。
- 全量 `pnpm test`：1211/1212 通过；唯一失败来自并行基线的旧 migration fixture，它从 schema 17 直接迁移但没有版本 39 所需的 `skill_revision` 表。另有 3 个既存 store 测试的异步相对 URL 警告，与本规格无关。
- 远程 Hook `654705248`：active，仅订阅 `issues`，SSL verification 开启，最后响应 `202 OK`。
- 真实 Issue [#62](https://github.com/changhuaqiu/agent-task-team/issues/62)：自动创建
  Conversation `conversation-0001784552935483-000006-55165d0c` 与 Delivery Run
  `delivery-0001784552935483-000007-cf268e09`，拆出 3 个边界任务；根任务、子任务、
  review receipt、verification receipt 与 Delivery Run 均已完成。
- 生产入口 `https://8.145.44.153/api/integrations/github/issues`：Nginx 只暴露精确路径，
  Let’s Encrypt IP SAN 证书启用，其他 HTTPS 路径返回 `404`。
- OpenCode 无人值守运行仅允许访问当前 Conversation 的外部 workspace；相关配置、
  工作目录元数据修复与生产构建均已部署。
