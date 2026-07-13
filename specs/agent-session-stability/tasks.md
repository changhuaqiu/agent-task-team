# 实施任务拆解 — Agent Session 稳定性

> 简单改动：移除 4 处失败 seal。每项完成同步更新 `docs/wiki/04-backend-daemon.md`（session 行为）。

- [ ] T1 移除 `daemon.ts:981` bridge 连接失败的 `sessionRepo.seal(..., 'failed')`
- [ ] T2 移除 `daemon.ts:1051` bridge 错误的 seal
- [ ] T3 移除 `daemon.ts:1235` `final.status !== 'completed'` 的 seal（核心，claude 失败/超时）
- [ ] T4 移除 `daemon.ts:1262` backend error catch 的 seal
- [ ] T5 `:583` `sealByConversation('replaced')` 保留（确认未被误改）
- [ ] T6 build 通过（无类型错误）
- [ ] T7 验证：@ 同一 agent 多次（人为触发失败/超时），查 DB `agent_session.cli_session_id` 不变
- [ ] T8 验证：claude --resume 该 session，上下文连续
- [ ] T9 更新 `docs/wiki/04-backend-daemon.md` session 生命周期说明（失败保持 active）
