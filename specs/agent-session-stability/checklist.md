# 验收清单 — Agent Session 稳定性

## 核心行为
- [ ] daemon.ts 4 处 `seal(..., 'failed')`（:981/:1051/:1235/:1262）已移除
- [ ] `:583` `sealByConversation('replaced')` 保留（首次 create 防 UNIQUE）
- [ ] `:863` `updateCliSessionId` 未改（cli_session_id 存储正常）
- [ ] `findActiveByConversation` 未改

## id 稳定性
- [ ] @ 同一 agent 多次，`cli_session_id` 不变（查 DB agent_session）
- [ ] 中间人为触发失败/超时，session 仍 active（不 seal）
- [ ] 下次 @ resume 同 session（claude --resume 该 cli_session_id）
- [ ] 上下文连续（agent 记得之前的对话）

## 不破坏
- [ ] build 通过（无类型错误）
- [ ] 首次 @（无 session）正常 create 新
- [ ] 正常完成（completed）的 session 行为不变
- [ ] 现有 session-repo 测试全绿

## 文档
- [ ] `docs/wiki/04-backend-daemon.md` session 生命周期说明已更新（失败保持 active）
