# Agent Session 稳定性（失败不 seal，id 不变）

> 状态：草案（draft）｜ 关联：`src/server/daemon.ts`、`src/server/repositories/session-repo.ts`

## 1. 目标

agent 的 claude session id 在被 @ 多次后**保持不变**，确保 agent 一直在同一个上下文干活。当前：claude 失败/超时 → seal session → 下次 @ 开新 session（id 变、上下文断）。改为：失败保持 active，下次 @ resume 同一 session。

## 2. 根因

`daemon.ts` 有 4 处 `sessionRepo.seal(agentSession.id, 'failed')`：
- `:981` bridge 连接失败
- `:1051` bridge 错误
- `:1235` `final.status !== 'completed'`（claude 失败/超时/cancelled）
- `:1262` backend error（catch）

**失败即 seal** → 下次 @ `findActiveByConversation` 找不到 active（已 sealed）→ 走 create 新 session 分支（`:589`）→ 新 `cli_session_id` → claude 新会话 → **id 变、上下文断**。

DB 印证：mario 在 `conv=8ebfe00c6346` 有 seq 2/3 sealed（failed）+ seq 4 active，每次失败 seal + 下次新 session。

## 3. 改动

移除 4 处 `seal(..., 'failed')`（:981/:1051/:1235/:1262）→ 失败时 session 保持 active，下次 @ resume 同一 session（id 不变）。

**保留不动**：
- `:583` `sealByConversation('replaced')`（首次 create 防 UNIQUE 冲突）
- `:863` `updateCliSessionId`（存储 claude 返回的 session_id，已正确）
- `findActiveByConversation`（逻辑已正确，问题只在它找不到时 create 新——而找不到是因为前面 seal 了）

## 4. 行为

| 情况 | 当前 | 改后 |
|---|---|---|
| claude 正常完成 | active（resume）| 不变 |
| claude 失败/超时 | seal → 下次新 session（id 变）❌ | **保持 active → 下次 resume（id 不变）** ✅ |
| bridge 连接/错误 | seal 'failed' | 保持 active |
| 首次 @（无 session）| create 新 | 不变（:583 防冲突保留）|

## 5. 权衡

- ✅ 失败 session 保持 active，`claude --resume` 续接（id 不变、上下文连续）—— 用户诉求
- ⚠️ `listActive` 会含"上次失败"的 session（UI 可能想标注，YAGNI 先不做）
- ⚠️ 极个别 corrupt session resume 异常——claude session 存对话历史，resume 通常 OK；用户已接受此风险

## 6. 验收指向

详见 `checklist.md`。核心：
1. @ 同一 agent 多次（含失败/超时），`cli_session_id` 不变
2. claude --resume 同 session，上下文连续
3. 4 处 seal 移除，:583/:863/findActive 不破坏
