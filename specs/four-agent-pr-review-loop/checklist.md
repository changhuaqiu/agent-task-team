# 验收清单

## 角色与权限

- [x] Mario、DK、Luigi、Peach 的职责和禁止行为可由运行时上下文证明
- [x] 低风险跳过 DK 也有显式 `not_required` 证据
- [x] reviewer Agent 与 implementer Agent 不能相同
- [x] 未配置 merge authority 时系统停在等待用户合并

## 权威回执

- [x] PR receipt 来自 provider 验证，不来自聊天解析
- [x] review receipt 指向真实 GitHub review/comment URL
- [x] review receipt 绑定精确 head SHA
- [x] 新 commit 会使旧 approval stale
- [x] merged/main evidence 齐全前不能 done

## UX

- [x] 开发交付卡可见 PR、commit、checks、测试和风险
- [x] 代码评审卡可见结论、真实评论、blocker 和测试
- [x] 合并闭环卡可见 merge SHA 和 main 复验
- [x] 卡片可跳转到 task 和 GitHub
- [x] 错误状态给出用户可执行的下一步

## 端到端

- [x] Luigi 创建真实 PR 后聊天自动出现开发交付卡
- [x] Peach 基于该 PR 留下真实评论并出现评审卡
- [x] REJECT 后 Luigi 在同一 PR 修复，Peach 对新 SHA 重审
- [x] GitHub、Task Graph、聊天卡片和 observability 的 task/PR/SHA 一致
- [x] Chrome Web E2E、生产构建和相关测试通过
- [x] 真实 ACP 调用注册 MCP 工具后，Task Graph、runtime TASKS.md 与 Web 页面保持同一权威状态
- [x] runtime 投影失败矩阵证明已接受状态不回滚，并记录结构化 proof 与同步错误
- [x] 真实 Git worktree 集成测试在全量并发压力下使用明确的有界超时且稳定通过
- [x] ACP 并发限制测试始终回收首个运行，且 Windows 临时目录无占用泄漏
