# Checklist

## 行为

- [x] `ping` 验签成功且不创建 Conversation/Run。
- [x] 合法 `issues.opened` 返回 `202` 和稳定映射。
- [x] 同一 delivery 重试返回原映射。
- [x] 同一仓库 Issue 的不同 delivery 不创建第二个 Run。
- [x] 不支持的 event/action 返回 ignored。
- [x] 触发标签和跳过标签按配置生效。
- [x] 默认拒绝不可信 author association，显式配置后才放行。
- [x] Issue 正文、URL、标签和验收清单进入 GoalContract/根任务。
- [x] `advance()` 在事务提交后触发。
- [x] 冷启动 webhook 可以初始化共享 Socket.IO、daemon 和 Platform Harness。

## 安全

- [x] 错误或缺失签名返回 `401`。
- [x] 原始请求体超过 1 MiB 返回 `413`。
- [x] 仓库白名单不匹配不触发。
- [x] 无效本地路径不触发。
- [x] 默认不允许 push、PR 和 merge。
- [x] 日志、响应和测试 fixture 不包含真实 secret。

## 数据与恢复

- [x] `delivery_id` 唯一。
- [x] `(repository_full_name, issue_number)` 唯一，仓库名持久化前归一化。
- [x] Conversation、DeliveryRun 和 ingress 映射同事务创建。
- [x] 迁移重复执行安全。
- [x] 服务重启后可从映射和 DeliveryRun 继续 reconcile。

## 验证

- [x] 编译器测试通过。
- [x] 验签和原始 body 限制测试通过。
- [x] repository/processor 幂等测试通过。
- [x] API route 测试通过。
- [x] 数据库迁移测试通过。
- [x] TypeScript 类型检查通过。
- [x] 生产构建通过。
- [x] 真实 GitHub `issues.opened` delivery 返回 `202`。
- [x] 真实 Issue 自动创建 Conversation、Delivery Run 和至少两个子任务。
- [x] Planner、实现角色和质量角色完成自动分派与流转。
- [x] Review/Verification receipts 通过，Delivery Run 状态为 `completed`。
- [x] Nginx 只暴露 webhook 精确路径，TLS IP SAN 与自动续期定时器生效。
- [x] 服务重启后应用、Nginx、证书续期与 Hermes 独立服务均保持 active。
