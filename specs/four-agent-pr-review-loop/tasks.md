# 实施任务

## Phase 1：事实源与契约

- [ ] T1 定义 PR/review/merge receipt 类型、reason code 和 provider verifier seam
- [ ] T2 扩展 Task Action / Artifact 类型并实现原子记录服务
- [ ] T3 将 `in_review`、评审决定与 `done` 接到回执门禁
- [ ] T4 为 head SHA 变化实现 approval invalidation

## Phase 2：Agent 工具与流程

- [ ] T5 为 Git Collaboration Skill 增加结构化 `collaboration_record_pr` / `collaboration_record_review` 工具
- [ ] T6 更新 Mario、DK、Luigi、Peach 的角色约束和 TeamPack workflow
- [ ] T7 接通 PR 提交→Peach wakeup、REJECT→Luigi wakeup、merge→Mario closure

## Phase 3：聊天卡片

- [ ] T8 实现开发交付卡
- [ ] T9 实现代码评审卡
- [ ] T10 实现合并闭环卡
- [ ] T11 卡片支持打开真实 PR/review、查看 task 和显示 stale/failed 状态

## Phase 4：验证

- [ ] T12 receipt/gate/rejection/stale 单元与集成测试
- [ ] T13 Web E2E 验证三类卡片和失败状态
- [ ] T14 在真实 GitHub PR 上完成 Luigi 提交、Peach 评论、修复和重审
- [ ] T15 四个真实 Agent runtime 完成一次从规划到闭环的协作演练
- [ ] T16 生产构建、全量测试、独立复审与长期文档同步
