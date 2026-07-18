# 实施任务

## Phase 1：事实源与契约

- [x] T1 定义 PR/review/merge receipt 类型、reason code 和 provider verifier seam
- [x] T2 扩展 Task Action / Artifact 类型并实现原子记录服务
- [x] T3 将 `in_review`、评审决定与 `done` 接到回执门禁
- [x] T4 为 head SHA 变化实现 approval invalidation

## Phase 2：Agent 工具与流程

- [x] T5 为 Git Collaboration Skill 增加结构化 `collaboration_record_pr` / `collaboration_record_review` / `collaboration_record_merge` 工具
- [x] T6 更新 Mario、DK、Luigi、Peach 的角色约束和 TeamPack workflow
- [x] T7 接通 PR 提交→Peach wakeup、REJECT→Luigi wakeup、merge→Mario closure

## Phase 3：聊天卡片

- [x] T8 实现开发交付卡
- [x] T9 实现代码评审卡
- [x] T10 实现合并闭环卡
- [x] T11 卡片支持打开真实 PR/review、查看 task 和显示 stale 状态

## Phase 4：验证

- [x] T12 receipt/gate/rejection/stale/merge 单元与集成测试
- [x] T13 Web E2E 验证三类卡片和失败状态
- [x] T14 在真实 GitHub PR 上完成 Luigi 提交、Peach 评论、修复和重审
- [x] T15 四角色 runtime 完成一次真实规划、按需架构判断、Luigi 执行与 Peach 评审演练
- [ ] T16 生产构建、全量测试、独立复审与长期文档同步
- [x] T17 runtime worktree、TASKS.md、watcher 与 completion barrier 收敛到同一精确 HEAD 工作目录
- [x] T18 通过逐 invocation、loopback、短期授权 MCP 向 ACP 注册真实平台工具
- [x] T19 Git-backed task 的 TASKS.md `in_review` / `done` 绕过被拒绝并回写权威状态
